import OpenAI from "openai";
import type { MappingResult, MappingItem } from "../types.js";
import {
  buildUserPrompt,
  buildChunkPrompt,
  SYSTEM_PROMPT,
  EXTRACT_SCHEMA_SYSTEM_PROMPT,
  buildExtractSchemaPrompt,
  MATCH_TABLES_SYSTEM_PROMPT,
  buildMatchTablesPrompt,
  MAP_COLUMNS_SYSTEM_PROMPT,
  buildMapColumnsPrompt,
  type RawFile,
  type CompactTable,
} from "../prompts/schema-mapping.js";

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
 * Compression levels:
 * - "light": keep schema files intact, data CSV header+20 rows, JSON 5 objects, text 500 lines
 * - "medium": schema files keep all rows but strip to first 3 CSV columns per row, data CSV header+5, JSON 2 objects, text 100 lines
 * - "heavy": schema files keep all rows stripped, data CSV header+2, JSON 1 object, text 50 lines
 */
type CompressionLevel = "light" | "medium" | "heavy";

function compressFile(file: RawFile, level: CompressionLevel = "light"): RawFile {
  const ext = file.fileName.split(".").pop()?.toLowerCase() ?? "";
  const content = file.content;
  const dataRows = level === "heavy" ? 3 : level === "medium" ? 6 : 21;
  const jsonObjects = level === "heavy" ? 1 : level === "medium" ? 2 : 5;
  const textLines = level === "heavy" ? 50 : level === "medium" ? 100 : 500;

  if (ext === "csv" || ext === "tsv" || ext === "txt") {
    const lines = content.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length <= dataRows) return file;

    if (looksLikeSchemaFile(lines[0])) {
      if (level === "light") return file;

      const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
      const headerCells = lines[0].split(delimiter).map((h) => h.trim().toLowerCase());

      if (level === "heavy") {
        // Keep only essential columns: table, column/field name, type
        const essentialKeywords = ["table", "column", "field", "name", "type", "data_type", "datatype"];
        const essentialIndices = headerCells
          .map((h, i) => essentialKeywords.some((kw) => h.includes(kw)) ? i : -1)
          .filter((i) => i !== -1);
        // If we found essential columns, keep only those; otherwise fall back to trimming cells
        if (essentialIndices.length >= 2) {
          const stripped = lines.map((line) => {
            const cells = line.split(delimiter);
            return essentialIndices.map((i) => (cells[i] || "").trim()).join(delimiter);
          });
          return { fileName: file.fileName, content: stripped.join("\n") + `\n(compressed: kept ${essentialIndices.length} of ${headerCells.length} columns)` };
        }
      }

      // Medium: keep all columns but trim long cell values to 50 chars
      const stripped = lines.map((line) => {
        const cells = line.split(delimiter);
        return cells.map((c) => c.length > 50 ? c.substring(0, 50) + "..." : c).join(delimiter);
      });
      return { fileName: file.fileName, content: stripped.join("\n") };
    }

    const kept = lines.slice(0, dataRows).join("\n");
    return {
      fileName: file.fileName,
      content: kept + `\n... (${lines.length - dataRows} more data rows, ${lines.length} total)`,
    };
  }

  if (ext === "json") {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > jsonObjects) {
        const compressed = JSON.stringify(parsed.slice(0, jsonObjects), null, level === "heavy" ? 0 : 2);
        return {
          fileName: file.fileName,
          content: compressed + `\n// ... (${parsed.length - jsonObjects} more objects, ${parsed.length} total)`,
        };
      }
      if (level !== "light" && !Array.isArray(parsed) && typeof parsed === "object") {
        const compressed = JSON.stringify(parsed, null, level === "heavy" ? 0 : 2);
        return { fileName: file.fileName, content: compressed };
      }
    } catch { /* not valid JSON, treat as text */ }
    const lines = content.split(/\r?\n/);
    if (lines.length > textLines) {
      return { fileName: file.fileName, content: lines.slice(0, textLines).join("\n") + `\n... (truncated from ${lines.length} lines)` };
    }
    return file;
  }

  const lines = content.split(/\r?\n/);
  if (lines.length > textLines) {
    return { fileName: file.fileName, content: lines.slice(0, textLines).join("\n") + `\n... (truncated from ${lines.length} lines)` };
  }
  return file;
}

function compressFiles(files: RawFile[], level: CompressionLevel = "light"): RawFile[] {
  return files.map((f) => compressFile(f, level));
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
  // Use heavy compression for source files when chunking (Tier 3 = last resort)
  const compressed = compressFiles(sourceFiles, "heavy");
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
    const compTf = compressFile(tf, "medium");
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

/* ── Streaming LLM call helpers ── */

async function streamLLMResponse(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.2,
  onToken?: TokenCallback
): Promise<string> {
  const messages = [
    { role: "system" as const, content: systemPrompt },
    { role: "user" as const, content: userPrompt },
  ];

  console.log("\n========== LLM REQUEST ==========");
  console.log("Model:", model);
  console.log("Prompt tokens (est):", estimateTokens(systemPrompt + userPrompt));
  console.log("=================================\n");

  const fmt = getResponseFormat();
  const stream = await client.chat.completions.create({
    model,
    messages,
    temperature,
    stream: true,
    ...(fmt ? { response_format: fmt } : {}),
  });

  let content = "";
  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content;
    if (delta) {
      content += delta;
      onToken?.(delta);
    }
  }

  if (!content) throw new Error("No response from LLM");

  console.log("========== LLM RESPONSE ==========");
  console.log(content.substring(0, 500) + (content.length > 500 ? "..." : ""));
  console.log("==================================\n");

  return content;
}

async function callLLM(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.2,
  onToken?: TokenCallback
): Promise<MappingResult> {
  const content = await streamLLMResponse(client, model, systemPrompt, userPrompt, temperature, onToken);
  return validateResult(extractJSON(content));
}

async function callLLMRaw(
  client: OpenAI,
  model: string,
  systemPrompt: string,
  userPrompt: string,
  temperature = 0.2,
  onToken?: TokenCallback
): Promise<unknown> {
  const content = await streamLLMResponse(client, model, systemPrompt, userPrompt, temperature, onToken);
  return extractJSON(content);
}

/* ═══════════════════════════════════════════════════════════════════════════
   3-Phase Agentic Pipeline (for prompts that exceed context window)
   Phase 1: Extract compact schemas from each file (parallel per-file calls)
   Phase 2: Match source tables → target tables (single call with compact schemas)
   Phase 3: Detailed column mapping per table pair (parallel per-pair calls)
   ═══════════════════════════════════════════════════════════════════════════ */

type TokenCallback = (token: string) => void;
type ProgressCallback = (phase: string, detail: string) => void;

/* ── Phase 1: Extract schemas ── */

async function extractSchemaFromFile(
  client: OpenAI,
  model: string,
  file: RawFile,
  maxTokens: number,
  onToken?: TokenCallback
): Promise<CompactTable[]> {
  // Compress file if needed to fit in a single call
  let content = file.content;
  const promptBase = estimateTokens(EXTRACT_SCHEMA_SYSTEM_PROMPT) + estimateTokens(file.fileName) + 200 + RESPONSE_BUFFER;
  const contentTokens = estimateTokens(content);

  if (promptBase + contentTokens > maxTokens) {
    // Try progressive compression on this single file
    for (const level of ["light", "medium", "heavy"] as CompressionLevel[]) {
      const compressed = compressFile(file, level);
      if (promptBase + estimateTokens(compressed.content) <= maxTokens) {
        content = compressed.content;
        break;
      }
    }
    // If still too big, take what we can
    const available = maxTokens - promptBase;
    if (estimateTokens(content) > available) {
      const chars = available * 4;
      content = content.substring(0, chars) + "\n... (truncated to fit context)";
    }
  }

  const prompt = buildExtractSchemaPrompt({ fileName: file.fileName, content });
  const result = await callLLMRaw(client, model, EXTRACT_SCHEMA_SYSTEM_PROMPT, prompt, 0.2, onToken);

  const obj = result as Record<string, unknown>;
  const tables = Array.isArray(obj.tables) ? obj.tables : [];

  return tables.map((t: Record<string, unknown>) => ({
    table_name: typeof t.table_name === "string" ? t.table_name
      : typeof t.name === "string" ? t.name
      : file.fileName.replace(/\.[^.]+$/, ""),
    columns: Array.isArray(t.columns)
      ? t.columns.map((c: Record<string, unknown>) => ({
          name: String(c.name ?? c.column_name ?? c.column ?? ""),
          type: String(c.type ?? c.data_type ?? c.datatype ?? "UNKNOWN"),
        })).filter((c: { name: string }) => c.name)
      : [],
  }));
}

async function extractAllSchemas(
  client: OpenAI,
  model: string,
  files: RawFile[],
  maxTokens: number,
  onProgress?: ProgressCallback,
  onToken?: TokenCallback
): Promise<CompactTable[]> {
  const allTables: CompactTable[] = [];

  // Process files in parallel batches of 3 to avoid rate limits
  const batchSize = 3;
  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchNames = batch.map((f) => f.fileName).join(", ");
    onProgress?.("extracting", `Extracting schemas from: ${batchNames} (${i + 1}-${Math.min(i + batchSize, files.length)}/${files.length})`);

    const results = await Promise.all(
      batch.map((file) => extractSchemaFromFile(client, model, file, maxTokens, onToken))
    );

    for (const tables of results) {
      allTables.push(...tables);
    }
  }

  console.log(`[Phase 1] Extracted ${allTables.length} tables from ${files.length} files`);
  for (const t of allTables) {
    console.log(`  - ${t.table_name}: ${t.columns.length} columns`);
  }

  return allTables;
}

/* ── Phase 2: Match table pairs ── */

interface TablePair {
  target_table: string;
  source_tables: string[];
  confidence: number;
}

async function matchTablePairs(
  client: OpenAI,
  model: string,
  sourceTables: CompactTable[],
  targetTables: CompactTable[],
  maxTokens: number,
  rules?: string,
  onProgress?: ProgressCallback,
  onToken?: TokenCallback
): Promise<TablePair[]> {
  onProgress?.("matching", `Matching ${sourceTables.length} source tables → ${targetTables.length} target tables`);

  const prompt = buildMatchTablesPrompt(sourceTables, targetTables, rules);
  const promptTokens = estimateTokens(MATCH_TABLES_SYSTEM_PROMPT) + estimateTokens(prompt) + RESPONSE_BUFFER;

  // If the compact schemas still exceed context, chunk target tables
  if (promptTokens > maxTokens) {
    console.log(`[Phase 2] Compact schemas still large (~${promptTokens} tokens), chunking target tables`);
    const allPairs: TablePair[] = [];
    const chunkSize = Math.max(1, Math.floor(targetTables.length * (maxTokens / promptTokens)));

    for (let i = 0; i < targetTables.length; i += chunkSize) {
      const chunk = targetTables.slice(i, i + chunkSize);
      onProgress?.("matching", `Matching tables chunk ${Math.floor(i / chunkSize) + 1} (${chunk.map((t) => t.table_name).join(", ")})`);
      const chunkPrompt = buildMatchTablesPrompt(sourceTables, chunk, rules);
      const result = await callLLMRaw(client, model, MATCH_TABLES_SYSTEM_PROMPT, chunkPrompt, 0.2, onToken);
      const obj = result as Record<string, unknown>;
      const pairs = Array.isArray(obj.table_pairs) ? obj.table_pairs : [];
      allPairs.push(...pairs.map(normalizePair));
    }
    return allPairs;
  }

  const result = await callLLMRaw(client, model, MATCH_TABLES_SYSTEM_PROMPT, prompt, 0.2, onToken);
  const obj = result as Record<string, unknown>;
  const pairs = Array.isArray(obj.table_pairs) ? obj.table_pairs : [];

  const normalized = pairs.map(normalizePair);
  console.log(`[Phase 2] Found ${normalized.length} table pairs`);
  for (const p of normalized) {
    console.log(`  - ${p.source_tables.join(" + ")} → ${p.target_table} (${(p.confidence * 100).toFixed(0)}%)`);
  }

  return normalized;
}

function normalizePair(p: unknown): TablePair {
  const obj = p as Record<string, unknown>;
  return {
    target_table: String(obj.target_table ?? obj.target ?? ""),
    source_tables: Array.isArray(obj.source_tables)
      ? obj.source_tables.map(String)
      : typeof obj.source_table === "string"
        ? [obj.source_table]
        : [],
    confidence: typeof obj.confidence === "number" ? obj.confidence : 0.5,
  };
}

/* ── Phase 3: Map columns per table pair ── */

function extractTableContent(
  files: RawFile[],
  tableName: string,
  allTables: CompactTable[]
): string {
  // Find which file this table came from
  // Strategy: look for a file whose name matches, or search file content for the table name
  const lower = tableName.toLowerCase();

  // 1. Check if a file name matches the table name
  const byName = files.find((f) => {
    const base = f.fileName.replace(/\.[^.]+$/, "").toLowerCase();
    return base === lower || base.includes(lower) || lower.includes(base);
  });
  if (byName) return byName.content;

  // 2. Check file contents for mentions of the table name
  for (const f of files) {
    if (f.content.toLowerCase().includes(lower)) {
      return f.content;
    }
  }

  // 3. Fallback: build a compact representation from the extracted schema
  const table = allTables.find((t) => t.table_name.toLowerCase() === lower);
  if (table) {
    return `Table: ${table.table_name}\nColumns:\n${table.columns.map((c) => `  ${c.name} (${c.type})`).join("\n")}`;
  }

  // 4. Last resort: return all file contents concatenated (shouldn't happen)
  return files.map((f) => f.content).join("\n---\n");
}

async function mapTablePair(
  client: OpenAI,
  model: string,
  pair: TablePair,
  sourceFiles: RawFile[],
  targetFiles: RawFile[],
  sourceTables: CompactTable[],
  targetTables: CompactTable[],
  maxTokens: number,
  userInstruction?: string,
  rules?: string,
  onToken?: TokenCallback
): Promise<MappingResult> {
  // Get raw content for only the relevant tables
  const sourceContent = pair.source_tables.map((name) => ({
    tableName: name,
    rawContent: extractTableContent(sourceFiles, name, sourceTables),
  }));

  const targetContent = [{
    tableName: pair.target_table,
    rawContent: extractTableContent(targetFiles, pair.target_table, targetTables),
  }];

  const prompt = buildMapColumnsPrompt(sourceContent, targetContent, userInstruction, rules);
  const promptTokens = estimateTokens(MAP_COLUMNS_SYSTEM_PROMPT) + estimateTokens(prompt) + RESPONSE_BUFFER;

  // If the pair-level prompt is still too large, compress the raw content
  if (promptTokens > maxTokens) {
    console.log(`[Phase 3] Pair ${pair.source_tables.join("+")} → ${pair.target_table} too large (~${promptTokens}), compressing`);
    const compSourceContent = sourceContent.map((s) => ({
      tableName: s.tableName,
      rawContent: compressFile({ fileName: s.tableName, content: s.rawContent }, "heavy").content,
    }));
    const compTargetContent = targetContent.map((t) => ({
      tableName: t.tableName,
      rawContent: compressFile({ fileName: t.tableName, content: t.rawContent }, "medium").content,
    }));
    const compPrompt = buildMapColumnsPrompt(compSourceContent, compTargetContent, userInstruction, rules);
    return callLLM(client, model, MAP_COLUMNS_SYSTEM_PROMPT, compPrompt, 0.2, onToken);
  }

  return callLLM(client, model, MAP_COLUMNS_SYSTEM_PROMPT, prompt, 0.2, onToken);
}

/* ── Full 3-phase agentic pipeline ── */

async function agenticMapSchema(
  client: OpenAI,
  model: string,
  sourceFiles: RawFile[],
  targetFiles: RawFile[],
  maxTokens: number,
  userInstruction?: string,
  rules?: string,
  onProgress?: ProgressCallback,
  onToken?: TokenCallback
): Promise<MappingResult> {
  console.log("[Agentic] Starting 3-phase pipeline");

  // Phase 1: Extract compact schemas from all files
  onProgress?.("extracting", "Phase 1/3: Extracting schemas from files...");
  const [sourceTables, targetTables] = await Promise.all([
    extractAllSchemas(client, model, sourceFiles, maxTokens, onProgress, onToken),
    extractAllSchemas(client, model, targetFiles, maxTokens, onProgress, onToken),
  ]);

  if (!sourceTables.length || !targetTables.length) {
    throw new Error("Could not extract any tables from the uploaded files");
  }

  // Phase 2: Match source tables → target tables
  onProgress?.("matching", "Phase 2/3: Matching source tables to target tables...");
  const pairs = await matchTablePairs(client, model, sourceTables, targetTables, maxTokens, rules, onProgress, onToken);

  if (!pairs.length) {
    throw new Error("Could not match any source tables to target tables");
  }

  // Phase 3: Map columns for each pair (parallel batches of 2)
  onProgress?.("mapping", "Phase 3/3: Mapping columns for each table pair...");
  const allResults: MappingResult[] = [];
  const pairBatchSize = 2;

  for (let i = 0; i < pairs.length; i += pairBatchSize) {
    const batch = pairs.slice(i, i + pairBatchSize);
    onProgress?.("mapping", `Mapping columns: ${batch.map((p) => p.target_table).join(", ")} (${i + 1}-${Math.min(i + pairBatchSize, pairs.length)}/${pairs.length})`);

    const results = await Promise.all(
      batch.map((pair) =>
        mapTablePair(client, model, pair, sourceFiles, targetFiles, sourceTables, targetTables, maxTokens, userInstruction, rules, onToken)
      )
    );
    allResults.push(...results);
  }

  const merged = mergeResults(allResults);
  console.log(`[Agentic] Pipeline complete: ${merged.mappings.length} mappings from ${pairs.length} table pairs`);
  onProgress?.("done", `Complete: ${merged.mappings.length} mappings from ${pairs.length} table pairs`);

  return merged;
}

/* ── Main entry point: 5-tier progressive strategy ── */

export async function mapSchema(
  sourceFiles: RawFile[],
  targetFiles: RawFile[],
  userInstruction?: string,
  rules?: string,
  onProgress?: ProgressCallback,
  onToken?: TokenCallback
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
    onProgress?.("mapping", "Sending all files to LLM (fits in context)...");
    const userPrompt = buildUserPrompt(sourceFiles, targetFiles, userInstruction, rules);
    return callLLM(client, model, SYSTEM_PROMPT, userPrompt, 0.2, onToken);
  }

  // Tier 2: Light compression
  const lightSource = compressFiles(sourceFiles, "light");
  const lightTarget = compressFiles(targetFiles, "light");
  const lightTokens = estimatePromptTokens(lightSource, lightTarget, userInstruction, rules);
  console.log(`[Token mgmt] Light compressed: ~${lightTokens} tokens`);

  if (lightTokens <= maxTokens) {
    console.log("[Token mgmt] Tier 2 (light): fits after light compression");
    onProgress?.("mapping", "Light compression applied, sending to LLM...");
    const userPrompt = buildUserPrompt(lightSource, lightTarget, userInstruction, rules);
    return callLLM(client, model, SYSTEM_PROMPT, userPrompt, 0.2, onToken);
  }

  // Tier 3: Medium compression
  const medSource = compressFiles(sourceFiles, "medium");
  const medTarget = compressFiles(targetFiles, "medium");
  const medTokens = estimatePromptTokens(medSource, medTarget, userInstruction, rules);
  console.log(`[Token mgmt] Medium compressed: ~${medTokens} tokens`);

  if (medTokens <= maxTokens) {
    console.log("[Token mgmt] Tier 3 (medium): fits after medium compression");
    onProgress?.("mapping", "Medium compression applied, sending to LLM...");
    const userPrompt = buildUserPrompt(medSource, medTarget, userInstruction, rules);
    return callLLM(client, model, SYSTEM_PROMPT, userPrompt, 0.2, onToken);
  }

  // Tier 4: Heavy compression
  const heavySource = compressFiles(sourceFiles, "heavy");
  const heavyTarget = compressFiles(targetFiles, "heavy");
  const heavyTokens = estimatePromptTokens(heavySource, heavyTarget, userInstruction, rules);
  console.log(`[Token mgmt] Heavy compressed: ~${heavyTokens} tokens`);

  if (heavyTokens <= maxTokens) {
    console.log("[Token mgmt] Tier 4 (heavy): fits after heavy compression");
    onProgress?.("mapping", "Heavy compression applied, sending to LLM...");
    const userPrompt = buildUserPrompt(heavySource, heavyTarget, userInstruction, rules);
    return callLLM(client, model, SYSTEM_PROMPT, userPrompt, 0.2, onToken);
  }

  // Tier 5: 3-Phase Agentic Pipeline (Map-Reduce)
  console.log(`[Token mgmt] Tier 5 (agentic): prompt still ~${heavyTokens} tokens after heavy compression, switching to 3-phase pipeline`);
  onProgress?.("extracting", "Files too large for single call. Starting agentic 3-phase pipeline...");

  return agenticMapSchema(
    client, model, sourceFiles, targetFiles, maxTokens,
    userInstruction, rules, onProgress, onToken
  );
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

  // Use progressive compression for refine context to stay within token limits
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
    for (const level of ["light", "medium", "heavy"] as CompressionLevel[]) {
      srcFiles = compressFiles(sourceFiles, level);
      tgtFiles = compressFiles(targetFiles, level);
      const est = estimateTokens(
        JSON.stringify(currentMapping) +
        srcFiles.map((f) => f.content).join("") +
        tgtFiles.map((f) => f.content).join("") +
        messages.map((m) => m.content).join("")
      );
      console.log(`[Token mgmt] Refine ${level} compressed: ~${est} tokens (limit ${maxTokens})`);
      if (est + RESPONSE_BUFFER <= maxTokens) break;
    }
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
