import OpenAI from "openai";
import type { MappingResult, MappingItem } from "../types.js";
import { buildUserPrompt, buildChunkPrompt, SYSTEM_PROMPT, type RawFile } from "../prompts/schema-mapping.js";

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

/* ── Token estimation & limits ── */

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getMaxTokens(): number {
  const env = process.env.LLM_MAX_TOKENS;
  if (env) {
    const n = parseInt(env, 10);
    if (!isNaN(n) && n > 0) return n;
  }
  return 128000;
}

const RESPONSE_BUFFER = 4000;

function estimatePromptTokens(
  sourceFiles: RawFile[],
  targetFiles: RawFile[],
  userInstruction?: string,
  rules?: string
): number {
  let total = estimateTokens(SYSTEM_PROMPT);
  for (const f of sourceFiles) total += estimateTokens(f.content) + estimateTokens(f.fileName) + 20;
  for (const f of targetFiles) total += estimateTokens(f.content) + estimateTokens(f.fileName) + 20;
  if (userInstruction) total += estimateTokens(userInstruction);
  if (rules) total += estimateTokens(rules);
  total += 200; // prompt framing overhead
  total += RESPONSE_BUFFER;
  return total;
}

/* ── File compression ── */

/**
 * Detect if a CSV/text file looks like a schema definition / data dictionary
 * (each row describes a column, not actual data records).
 * Heuristic: header contains words like "table", "column", "field", "type", "schema".
 */
function looksLikeSchemaFile(firstLine: string): boolean {
  const lower = firstLine.toLowerCase();
  const schemaKeywords = ["table", "column", "field", "type", "schema", "description", "comment", "nullable"];
  const matches = schemaKeywords.filter((kw) => lower.includes(kw));
  return matches.length >= 2;
}

/**
 * Compress a file to reduce token usage. Strategy depends on file type:
 * - Schema/dictionary files: keep ALL rows (each row is a column definition, losing rows = losing columns)
 * - Data CSV/TSV: keep header + first 20 data rows
 * - JSON arrays: keep first 5 objects
 * - Text: keep first 500 lines
 */
function compressFile(file: RawFile): RawFile {
  const ext = file.fileName.split(".").pop()?.toLowerCase() ?? "";
  const content = file.content;

  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length <= 25) return file;

    // If it looks like a schema/dictionary file, keep ALL rows
    if (looksLikeSchemaFile(lines[0])) {
      return file;
    }

    // Data file: keep header + 20 sample rows
    const kept = lines.slice(0, 21).join("\n");
    return {
      fileName: file.fileName,
      content: kept + `\n... (${lines.length - 21} more data rows, ${lines.length} total)`,
    };
  }

  if (ext === "json") {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 5) {
        const compressed = JSON.stringify(parsed.slice(0, 5), null, 2);
        return {
          fileName: file.fileName,
          content: compressed + `\n// ... (${parsed.length - 5} more objects, ${parsed.length} total)`,
        };
      }
    } catch { /* not valid JSON, treat as text */ }
    const lines = content.split(/\r?\n/);
    if (lines.length > 500) {
      return { fileName: file.fileName, content: lines.slice(0, 500).join("\n") + `\n... (truncated from ${lines.length} lines)` };
    }
    return file;
  }

  // Generic text
  const lines = content.split(/\r?\n/);
  if (lines.length > 500) {
    return { fileName: file.fileName, content: lines.slice(0, 500).join("\n") + `\n... (truncated from ${lines.length} lines)` };
  }
  return file;
}

function compressFiles(files: RawFile[]): RawFile[] {
  return files.map(compressFile);
}

/* ── Chunking: split target files into groups paired with all (compressed) source files ── */

interface FileChunk {
  sourceFiles: RawFile[];
  targetFiles: RawFile[];
}

function chunkFiles(
  sourceFiles: RawFile[],
  targetFiles: RawFile[],
  maxTokens: number,
  userInstruction?: string,
  rules?: string
): FileChunk[] {
  const compressed = compressFiles(sourceFiles);
  const chunks: FileChunk[] = [];

  const baseTokens = estimateTokens(SYSTEM_PROMPT)
    + compressed.reduce((s, f) => s + estimateTokens(f.content) + estimateTokens(f.fileName) + 20, 0)
    + (userInstruction ? estimateTokens(userInstruction) : 0)
    + (rules ? estimateTokens(rules) : 0)
    + 300
    + RESPONSE_BUFFER;

  let currentTargets: RawFile[] = [];
  let currentTokens = baseTokens;

  for (const tf of targetFiles) {
    const compTf = compressFile(tf);
    const tfTokens = estimateTokens(compTf.content) + estimateTokens(compTf.fileName) + 20;

    if (currentTargets.length > 0 && currentTokens + tfTokens > maxTokens) {
      chunks.push({ sourceFiles: compressed, targetFiles: currentTargets });
      currentTargets = [];
      currentTokens = baseTokens;
    }

    currentTargets.push(compTf);
    currentTokens += tfTokens;
  }

  if (currentTargets.length > 0) {
    chunks.push({ sourceFiles: compressed, targetFiles: currentTargets });
  }

  // If a single target file still exceeds the limit, we still send it as one chunk
  if (chunks.length === 0) {
    chunks.push({ sourceFiles: compressed, targetFiles: compressFiles(targetFiles) });
  }

  return chunks;
}

/* ── Merge multiple partial MappingResults ── */

function mergeResults(results: MappingResult[]): MappingResult {
  const byTarget = new Map<string, MappingItem>();
  const allUnmappedSource = new Set<string>();
  const allUnmappedTarget = new Set<string>();
  const summaries: string[] = [];

  for (const r of results) {
    for (const m of r.mappings) {
      const existing = byTarget.get(m.target_column);
      if (existing) {
        if (m.confidence_score > existing.confidence_score) {
          byTarget.set(m.target_column, m);
        }
      } else {
        byTarget.set(m.target_column, m);
      }
    }
    for (const c of r.unmapped_source_columns ?? []) allUnmappedSource.add(c);
    for (const c of r.unmapped_target_columns ?? []) allUnmappedTarget.add(c);
    if (r.analysis_summary) summaries.push(r.analysis_summary);
  }

  const mappings = Array.from(byTarget.values());

  // Remove from unmapped lists any columns that ended up mapped
  const mappedTargets = new Set(mappings.map((m) => m.target_column));
  const mappedSources = new Set(mappings.flatMap((m) => m.source_columns));
  for (const t of mappedTargets) allUnmappedTarget.delete(t);
  for (const s of mappedSources) allUnmappedSource.delete(s);

  const globalConfidence =
    mappings.length > 0
      ? mappings.reduce((s, m) => s + m.confidence_score, 0) / mappings.length
      : 0;

  return {
    mappings,
    unmapped_source_columns: [...allUnmappedSource],
    unmapped_target_columns: [...allUnmappedTarget],
    global_confidence: globalConfidence,
    analysis_summary: summaries.join(" "),
  };
}

/* ── Single LLM call helper ── */

async function callLLM(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.2
): Promise<MappingResult> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  console.log("\n========== LLM REQUEST ==========");
  console.log("Model:", model);
  console.log("Prompt tokens (est):", estimateTokens(systemPrompt + userPrompt));
  console.log("=================================\n");

  const fmt = getResponseFormat();
  const completion = await client.chat.completions.create({
    model,
    messages,
    temperature,
    ...(fmt ? { response_format: fmt } : {}),
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No response from LLM");

  console.log("========== LLM RESPONSE ==========");
  console.log(content);
  console.log("==================================\n");

  return validateResult(extractJSON(content));
}

/* ── Main entry point: 3-tier strategy ── */

export async function mapSchema(
  sourceFiles: RawFile[],
  targetFiles: RawFile[],
  userInstruction?: string,
  rules?: string
): Promise<MappingResult> {
  const client = getClient();
  const model =
    process.env.LLM_MODEL ||
    process.env.OPENAI_MODEL ||
    "meta-llama/Llama-3.2-3B-Instruct";
  const maxTokens = getMaxTokens();

  // Tier 1: Try sending everything as-is
  const fullTokens = estimatePromptTokens(sourceFiles, targetFiles, userInstruction, rules);
  console.log(`[Token mgmt] Full prompt: ~${fullTokens} tokens, limit: ${maxTokens}`);

  if (fullTokens <= maxTokens) {
    console.log("[Token mgmt] Tier 1: fits in context, sending as-is");
    const userPrompt = buildUserPrompt(sourceFiles, targetFiles, userInstruction, rules);
    return callLLM(client, model, SYSTEM_PROMPT, userPrompt);
  }

  // Tier 2: Compress files and try again
  const compressedSource = compressFiles(sourceFiles);
  const compressedTarget = compressFiles(targetFiles);
  const compressedTokens = estimatePromptTokens(compressedSource, compressedTarget, userInstruction, rules);
  console.log(`[Token mgmt] Compressed prompt: ~${compressedTokens} tokens`);

  if (compressedTokens <= maxTokens) {
    console.log("[Token mgmt] Tier 2: compressed files fit, sending compressed");
    const userPrompt = buildUserPrompt(compressedSource, compressedTarget, userInstruction, rules);
    return callLLM(client, model, SYSTEM_PROMPT, userPrompt);
  }

  // Tier 3: Chunk by target tables and run in parallel
  const chunks = chunkFiles(sourceFiles, targetFiles, maxTokens, userInstruction, rules);
  console.log(`[Token mgmt] Tier 3: splitting into ${chunks.length} chunks`);

  const chunkResults = await Promise.all(
    chunks.map((chunk, i) => {
      console.log(`[Token mgmt] Sending chunk ${i + 1}/${chunks.length} (${chunk.targetFiles.map((f) => f.fileName).join(", ")})`);
      const userPrompt = buildChunkPrompt(
        chunk.sourceFiles,
        chunk.targetFiles,
        i + 1,
        chunks.length,
        userInstruction,
        rules
      );
      return callLLM(client, model, SYSTEM_PROMPT, userPrompt);
    })
  );

  const merged = mergeResults(chunkResults);
  console.log(`[Token mgmt] Merged ${chunkResults.length} chunk results: ${merged.mappings.length} total mappings`);
  return merged;
}

/**
 * Extract valid JSON from an LLM response that may contain extra text,
 * markdown fences, or other garbage around the actual JSON object.
 */
function extractJSON(raw: string): unknown {
  // 1. Try direct parse first
  try { return JSON.parse(raw); } catch { /* continue */ }

  // 2. Strip markdown code fences
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch { /* continue */ }
  }

  // 3. Find the first { and last } to extract the outermost JSON object
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const candidate = raw.substring(start, end + 1);
    try { return JSON.parse(candidate); } catch { /* continue */ }

    // 4. Try fixing common issues: trailing commas before }
    const cleaned = candidate
      .replace(/,\s*}/g, "}")
      .replace(/,\s*]/g, "]");
    try { return JSON.parse(cleaned); } catch { /* continue */ }
  }

  throw new Error(
    `Failed to extract valid JSON from LLM response. Raw response starts with: "${raw.substring(0, 200)}..."`
  );
}

function getResponseFormat(): { type: "json_object" } | undefined {
  // Some LLMs don't support response_format; set LLM_NO_JSON_MODE=1 to disable
  if (process.env.LLM_NO_JSON_MODE === "1" || process.env.LLM_NO_JSON_MODE === "true") {
    return undefined;
  }
  return { type: "json_object" };
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

  // Use compressed files for refine context to stay within token limits
  const maxTokens = getMaxTokens();
  let srcFiles = sourceFiles;
  let tgtFiles = targetFiles;
  const rawEstimate = estimateTokens(
    JSON.stringify(currentMapping) +
    sourceFiles.map((f) => f.content).join("") +
    targetFiles.map((f) => f.content).join("") +
    messages.map((m) => m.content).join("")
  );
  if (rawEstimate + RESPONSE_BUFFER > maxTokens) {
    console.log(`[Token mgmt] Refine: compressing files (raw ~${rawEstimate} tokens, limit ${maxTokens})`);
    srcFiles = compressFiles(sourceFiles);
    tgtFiles = compressFiles(targetFiles);
  }

  let contextBlock = `\n=== SOURCE FILES ===\n`;
  for (const f of srcFiles) {
    contextBlock += `\n--- File: ${f.fileName} ---\n${f.content}\n`;
  }
  contextBlock += `\n=== TARGET FILES ===\n`;
  for (const f of tgtFiles) {
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

  const fmt = getResponseFormat();
  const completion = await client.chat.completions.create({
    model,
    messages: fullMessages,
    temperature: 0.3,
    ...(fmt ? { response_format: fmt } : {}),
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("No response from LLM");

  console.log("========== REFINE LLM RESPONSE ==========");
  console.log(content);
  console.log("=========================================\n");

  const parsed = extractJSON(content) as { mapping?: unknown; message?: string };
  const mapping = validateResult(parsed.mapping ?? parsed);
  const message = typeof parsed.message === "string" ? parsed.message : "Mapping updated.";

  return { mapping, message };
}
