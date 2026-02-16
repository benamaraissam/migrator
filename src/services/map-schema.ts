import OpenAI from "openai";
import type { MappingResult, MappingItem } from "../types.js";
import { buildUserPrompt, SYSTEM_PROMPT, type RawFile } from "../prompts/schema-mapping.js";

const HUGGINGFACE_BASE_URL = "https://router.huggingface.co/v1";

function getClient(): OpenAI {
  const baseUrl = process.env.LLM_BASE_URL;
  const key =
    process.env.LLM_API_KEY ||
    process.env.HF_TOKEN ||
    process.env.HUGGINGFACE_HUB_TOKEN ||
    process.env.OPENAI_API_KEY;

  if (!key) {
    throw new Error(
      "Set HF_TOKEN (Hugging Face), LLM_API_KEY, or OPENAI_API_KEY"
    );
  }

  if (baseUrl || process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN) {
    return new OpenAI({
      apiKey: key,
      baseURL: baseUrl ?? HUGGINGFACE_BASE_URL,
    });
  }

  return new OpenAI({ apiKey: key });
}

export async function mapSchema(
  sourceFiles: RawFile[],
  targetFiles: RawFile[],
  userInstruction?: string,
  rules?: string
): Promise<MappingResult> {
  const client = getClient();
  const userPrompt = buildUserPrompt(sourceFiles, targetFiles, userInstruction, rules);

  const model =
    process.env.LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    "meta-llama/Llama-3.2-3B-Instruct";

  const messages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    { role: "user" as const, content: userPrompt },
  ];

  console.log("\n========== LLM REQUEST ==========");
  console.log("Model:", model);
  console.log("--- System prompt ---");
  console.log(SYSTEM_PROMPT);
  console.log("--- User prompt ---");
  console.log(userPrompt);
  console.log("=================================\n");

  const completion = await client.chat.completions.create({
    model,
    messages,
    response_format: { type: "json_object" },
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) {
    throw new Error("No response from LLM");
  }

  console.log("========== LLM RESPONSE ==========");
  console.log(content);
  console.log("==================================\n");

  const parsed = JSON.parse(content) as MappingResult;
  return validateResult(parsed);
}

const MATCH_TYPES = ["exact", "semantic", "transformed", "derived", "incompatible"] as const;

function isValidMatchType(v: unknown): v is (typeof MATCH_TYPES)[number] {
  return typeof v === "string" && MATCH_TYPES.includes(v as (typeof MATCH_TYPES)[number]);
}

function normalizeMapping(m: unknown): {
  target_column: string;
  source_columns: string[];
  confidence_score: number;
  match_type: string;
  reasoning: string;
  transformation_rule: string | null;
} | null {
  if (!m || typeof m !== "object") return null;
  const row = m as Record<string, unknown>;

  const targetTable = typeof row.target_table === "string" ? row.target_table : "";
  const sourceTable = typeof row.source_table === "string" ? row.source_table : "";

  let target = row.target_column ?? row.target;
  if (!target || typeof target !== "string") return null;

  // Prefix target_column with target_table if not already prefixed
  if (targetTable && !target.includes(".")) {
    target = `${targetTable}.${target}`;
  }

  const source = row.source_column ?? row.source ?? row.source_columns;
  let sourceColumns = Array.isArray(source)
    ? source.filter((c): c is string => typeof c === "string")
    : typeof source === "string"
      ? [source]
      : [];

  const transformationRule =
    typeof row.transformation_rule === "string"
      ? row.transformation_rule
      : typeof row.transformation === "string"
        ? row.transformation
        : null;

  const reasoning =
    typeof row.reasoning === "string"
      ? row.reasoning
      : typeof row.reason === "string"
        ? row.reason
        : "";

  // Filter source_columns: only keep columns actually referenced in
  // the transformation rule or that match the target column name.
  // This fixes LLMs that dump all table columns into source_columns.
  if (sourceColumns.length > 1 && transformationRule) {
    const rule = transformationRule.toLowerCase();
    const filtered = sourceColumns.filter((c) => {
      const bare = c.toLowerCase();
      return rule.includes(bare);
    });
    if (filtered.length > 0) {
      sourceColumns = filtered;
    }
  }

  // If still too many columns and no transformation (direct mapping),
  // a 1-to-1 mapping should only have 1 source column.
  // Try to match by target column name similarity.
  if (sourceColumns.length > 3 && !transformationRule) {
    const tgtCol = ((target as string).includes(".")
      ? (target as string).split(".").pop()!
      : (target as string)).toLowerCase();
    const best = sourceColumns.filter((c) => {
      const bare = (c.includes(".") ? c.split(".").pop()! : c).toLowerCase();
      return bare === tgtCol || bare.includes(tgtCol) || tgtCol.includes(bare);
    });
    if (best.length > 0 && best.length < sourceColumns.length) {
      sourceColumns = best;
    }
  }

  // Prefix source columns with source_table if not already prefixed
  if (sourceTable) {
    sourceColumns = sourceColumns.map((c) =>
      c.includes(".") ? c : `${sourceTable}.${c}`
    );
  }

  return {
    target_column: target as string,
    source_columns: sourceColumns,
    confidence_score: typeof row.confidence_score === "number"
      ? row.confidence_score
      : typeof row.confidence === "number"
        ? row.confidence
        : 0,
    match_type: isValidMatchType(row.match_type) ? row.match_type : "semantic",
    reasoning,
    transformation_rule: transformationRule,
  };
}

function validateResult(raw: unknown): MappingResult {
  if (!raw || typeof raw !== "object") {
    throw new Error("Invalid response: not an object");
  }
  const obj = raw as Record<string, unknown>;
  const rawMappings = Array.isArray(obj.mappings)
    ? obj.mappings
    : Array.isArray(obj.mapping)
      ? obj.mapping
      : [];

  // Normalize and merge mappings with same target (derived columns)
  const byTarget = new Map<
    string,
    {
      target_column: string;
      source_columns: string[];
      confidence_score: number;
      match_type: string;
      reasoning: string;
      transformation_rule: string | null;
    }
  >();

  for (const m of rawMappings) {
    const norm = normalizeMapping(m);
    if (!norm) continue;
    const existing = byTarget.get(norm.target_column);
    if (existing) {
      const mergedSources = [...new Set([...existing.source_columns, ...norm.source_columns])];
      byTarget.set(norm.target_column, {
        ...norm,
        source_columns: mergedSources,
        reasoning: existing.reasoning || norm.reasoning,
        transformation_rule: existing.transformation_rule || norm.transformation_rule,
        confidence_score: Math.max(existing.confidence_score, norm.confidence_score),
      });
    } else {
      byTarget.set(norm.target_column, norm);
    }
  }

  const mappings = Array.from(byTarget.values()) as MappingItem[];
  const computedGlobal =
    mappings.length > 0
      ? mappings.reduce((s, m) => s + m.confidence_score, 0) / mappings.length
      : 0;

  return {
    mappings,
    unmapped_source_columns: Array.isArray(obj.unmapped_source_columns)
      ? obj.unmapped_source_columns
      : [],
    unmapped_target_columns: Array.isArray(obj.unmapped_target_columns)
      ? obj.unmapped_target_columns
      : [],
    global_confidence:
      typeof obj.global_confidence === "number" ? obj.global_confidence : computedGlobal,
    analysis_summary: typeof obj.analysis_summary === "string" ? obj.analysis_summary : "",
  };
}

const REFINE_SYSTEM_PROMPT = `You are an expert Data Migration and Schema Mapping AI Agent engaged in a conversation to refine a schema mapping.

You have already produced an initial mapping from raw SOURCE and TARGET files. The user is now providing feedback or questions to improve it.

Your response MUST be valid JSON only, in this exact format:
{
  "mapping": { ...the updated MappingResult... },
  "message": "A brief human-readable reply to the user (explaining changes or answering their question)"
}

Rules:
- Incorporate the user's feedback into the mapping. Only change what they asked about.
- Keep the same JSON structure: mappings[], unmapped_source_columns[], unmapped_target_columns[], global_confidence, analysis_summary.
- Never invent columns. Only use columns that exist in the raw files.
- The "message" field should be 1-3 sentences, friendly and direct.
- If the user asks a question (e.g. "Why did you map X to Y?"), answer in "message" and optionally adjust the mapping if they suggest changes.
- Return ONLY the JSON object, no other text.`;

export interface RefineInput {
  sourceFiles: RawFile[];
  targetFiles: RawFile[];
  currentMapping: MappingResult;
  messages: { role: "user" | "assistant"; content: string }[];
  userMessage: string;
  rules?: string;
}

export interface RefineOutput {
  mapping: MappingResult;
  message: string;
}

export async function refineMapping(input: RefineInput): Promise<RefineOutput> {
  const client = getClient();
  const { sourceFiles, targetFiles, currentMapping, messages, userMessage, rules } = input;

  const model =
    process.env.LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    "meta-llama/Llama-3.2-3B-Instruct";

  let contextBlock = `\n=== SOURCE FILES ===\n`;
  for (const f of sourceFiles) {
    contextBlock += `\n--- File: ${f.fileName} ---\n${f.content}\n`;
  }
  contextBlock += `\n=== TARGET FILES ===\n`;
  for (const f of targetFiles) {
    contextBlock += `\n--- File: ${f.fileName} ---\n${f.content}\n`;
  }
  contextBlock += `\nCURRENT_MAPPING:\n${JSON.stringify(currentMapping, null, 2)}\n`;

  if (rules?.trim()) {
    contextBlock += `\nADDITIONAL RULES (you MUST follow these):\n${rules.trim()}\n`;
  }

  const chatHistory = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  const fullMessages: { role: "system" | "user" | "assistant"; content: string }[] = [
    {
      role: "system",
      content: REFINE_SYSTEM_PROMPT + "\n\n" + contextBlock,
    },
    ...chatHistory,
    { role: "user", content: userMessage },
  ];

  console.log("\n========== REFINE LLM REQUEST ==========");
  console.log("User message:", userMessage);
  console.log("History length:", messages.length);
  console.log("========================================\n");

  const completion = await client.chat.completions.create({
    model,
    messages: fullMessages,
    response_format: { type: "json_object" },
    temperature: 0.3,
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No response from LLM");

  console.log("========== REFINE LLM RESPONSE ==========");
  console.log(content);
  console.log("=========================================\n");

  const parsed = JSON.parse(content) as { mapping?: unknown; message?: string };
  const mapping = validateResult(parsed.mapping ?? parsed);
  const message = typeof parsed.message === "string" ? parsed.message : "Mapping updated.";

  return { mapping, message };
}
