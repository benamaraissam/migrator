import OpenAI from "openai";
import type { Schema, MappingResult, MappingItem } from "../types.js";
import { buildUserPrompt, SYSTEM_PROMPT } from "../prompts/schema-mapping.js";

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

  // Hugging Face or custom OpenAI-compatible base URL
  if (baseUrl || process.env.HF_TOKEN || process.env.HUGGINGFACE_HUB_TOKEN) {
    return new OpenAI({
      apiKey: key,
      baseURL: baseUrl ?? HUGGINGFACE_BASE_URL,
    });
  }

  return new OpenAI({ apiKey: key });
}

export async function mapSchema(
  sourceSchema: Schema,
  targetSchema: Schema,
  userInstruction?: string,
  rules?: string
): Promise<MappingResult> {
  const client = getClient();
  const userPrompt = buildUserPrompt(sourceSchema, targetSchema, userInstruction, rules);

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
  const target = row.target_column ?? row.target;
  const source = row.source_column ?? row.source ?? row.source_columns;
  const sourceColumns = Array.isArray(source)
    ? source.filter((c): c is string => typeof c === "string")
    : typeof source === "string"
      ? [source]
      : [];
  if (!target || typeof target !== "string") return null;
  return {
    target_column: target,
    source_columns: sourceColumns,
    confidence_score: typeof row.confidence_score === "number"
      ? row.confidence_score
      : typeof row.confidence === "number"
        ? row.confidence
        : 0,
    match_type: isValidMatchType(row.match_type) ? row.match_type : "semantic",
    reasoning:
      typeof row.reasoning === "string"
        ? row.reasoning
        : typeof row.reason === "string"
          ? row.reason
          : "",
    transformation_rule:
      typeof row.transformation_rule === "string"
        ? row.transformation_rule
        : typeof row.transformation === "string"
          ? row.transformation
          : null,
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

You have already produced an initial mapping between SOURCE and TARGET schemas. The user is now providing feedback or questions to improve it.

Your response MUST be valid JSON only, in this exact format:
{
  "mapping": { ...the updated MappingResult... },
  "message": "A brief human-readable reply to the user (explaining changes or answering their question)"
}

Rules:
- Incorporate the user's feedback into the mapping. Only change what they asked about.
- Keep the same JSON structure: mappings[], unmapped_source_columns[], unmapped_target_columns[], global_confidence, analysis_summary.
- Never invent columns. Only use columns that exist in the schemas.
- The "message" field should be 1-3 sentences, friendly and direct.
- If the user asks a question (e.g. "Why did you map X to Y?"), answer in "message" and optionally adjust the mapping if they suggest changes.
- Return ONLY the JSON object, no other text.`;

export interface RefineInput {
  sourceSchema: Schema;
  targetSchema: Schema;
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
  const { sourceSchema, targetSchema, currentMapping, messages, userMessage, rules } = input;

  const model =
    process.env.LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    "meta-llama/Llama-3.2-3B-Instruct";

  let contextBlock = `
SOURCE_SCHEMA:
${JSON.stringify(sourceSchema, null, 2)}

TARGET_SCHEMA:
${JSON.stringify(targetSchema, null, 2)}

CURRENT_MAPPING:
${JSON.stringify(currentMapping, null, 2)}
`;

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
