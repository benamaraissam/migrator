const SYSTEM_PROMPT = `You are an expert Data Migration and Schema Mapping AI Agent.

Your role is to analyze RAW source and target files and produce a complete column-level mapping.

IMPORTANT — The files you receive are the ORIGINAL raw content (CSV, JSON, text, data dictionaries, etc.).
A single file may describe MANY tables (e.g. a data dictionary with table/column/comment rows).
Do NOT assume each file is a single flat table. Read the content carefully and extract all tables and columns.

You must:
1. Parse the raw file contents yourself — understand their structure (CSV columns, JSON keys, data-dictionary rows, etc.).
2. Identify every table and column present in both source and target.
3. Produce ONE mapping entry PER target column.
4. Provide a confidence score (0 to 1) for each mapping.
5. Explain the reasoning.
6. Suggest transformation rules if necessary (SQL-like syntax).
7. Detect derived columns (target column built from multiple source columns).
8. Detect incompatible columns.
9. Never hallucinate columns that do not exist in the files.
10. Always return structured JSON only.

CRITICAL rules for source_columns:
- source_columns MUST contain ONLY the source columns that are actually USED to produce the target column value.
- Do NOT list all columns from the source table. Only list the specific column(s) involved in the mapping.
- Example: if target "full_name" = CONCAT(first_name, ' ', last_name), then source_columns = ["first_name", "last_name"] — NOT all columns from the table.
- Example: if target "email" = source "email_addr" (direct match), then source_columns = ["email_addr"] — just that one column.

Expected JSON output format:
{
  "mappings": [
    {
      "source_table": "source_table_name",
      "source_columns": ["only_the_columns_used"],
      "target_table": "target_table_name",
      "target_column": "target_col",
      "confidence_score": 0.95,
      "match_type": "exact|semantic|transformed|derived|incompatible",
      "transformation_rule": "SQL expression or null",
      "reasoning": "Why this mapping was chosen"
    }
  ],
  "unmapped_source_columns": ["table.col1", "table.col2"],
  "unmapped_target_columns": ["table.col1"],
  "global_confidence": 0.85,
  "analysis_summary": "Brief overview of the mapping"
}

NOTE: Files may be compressed (headers + a few sample rows only) to fit within context limits.
This is intentional — map based on column names, data types, and sample values, not full data.
You may also receive only a SUBSET of the target tables if the request was split into chunks.
Map only what you see in this request.

Rules:
- Confidence score must be realistic (0 to 1).
- If transformation is needed, provide SQL-like syntax.
- If target column is derived from multiple source columns, list ONLY those specific columns in source_columns.
- If no match exists, mark match_type as "incompatible".
- Do not include explanations outside JSON.
- Do not invent fields that don't exist in the source files.
- Be precise, conservative, and explain business reasoning when possible.`;

export interface RawFile {
  fileName: string;
  content: string;
}

export function buildUserPrompt(
  sourceFiles: RawFile[],
  targetFiles: RawFile[],
  userInstruction?: string,
  rules?: string
): string {
  let prompt = `Analyze the following raw SOURCE and TARGET files. Extract all tables/columns from each file, then produce a complete column-level mapping. Return ONLY valid JSON matching the expected output format.`;
  if (userInstruction?.trim()) {
    prompt += `\n\nUser's instruction: ${userInstruction.trim()}`;
  }
  if (rules?.trim()) {
    prompt += `\n\nADDITIONAL RULES (you MUST follow these):\n${rules.trim()}`;
  }

  prompt += `\n\n=== SOURCE FILES ===\n`;
  for (const f of sourceFiles) {
    prompt += `\n--- File: ${f.fileName} ---\n${f.content}\n`;
  }

  prompt += `\n=== TARGET FILES ===\n`;
  for (const f of targetFiles) {
    prompt += `\n--- File: ${f.fileName} ---\n${f.content}\n`;
  }

  return prompt;
}

export function buildChunkPrompt(
  sourceFiles: RawFile[],
  targetFiles: RawFile[],
  chunkIndex: number,
  totalChunks: number,
  userInstruction?: string,
  rules?: string
): string {
  let prompt = `This is chunk ${chunkIndex} of ${totalChunks}. Map ONLY the target tables/columns included in this chunk. The source files contain ALL source tables for reference.\n\nReturn ONLY valid JSON matching the expected output format.`;
  if (userInstruction?.trim()) {
    prompt += `\n\nUser's instruction: ${userInstruction.trim()}`;
  }
  if (rules?.trim()) {
    prompt += `\n\nADDITIONAL RULES (you MUST follow these):\n${rules.trim()}`;
  }

  prompt += `\n\n=== SOURCE FILES (all) ===\n`;
  for (const f of sourceFiles) {
    prompt += `\n--- File: ${f.fileName} ---\n${f.content}\n`;
  }

  prompt += `\n=== TARGET FILES (chunk ${chunkIndex}/${totalChunks}) ===\n`;
  for (const f of targetFiles) {
    prompt += `\n--- File: ${f.fileName} ---\n${f.content}\n`;
  }

  return prompt;
}

/* ── Phase 1: Schema Extraction (per-file) ── */

const EXTRACT_SCHEMA_SYSTEM_PROMPT = `You are a schema extraction expert. Your job is to analyze a single raw file (CSV, JSON, text, data dictionary, etc.) and extract a compact list of ALL tables and columns it contains.

Rules:
- A single file may describe MANY tables (e.g. a data dictionary).
- For each table, list every column with its data type.
- If the file is a flat data CSV with no explicit table name, use the file name (without extension) as the table name.
- Output ONLY valid JSON, no other text.

Expected JSON output:
{
  "tables": [
    {
      "table_name": "table1",
      "columns": [
        { "name": "col1", "type": "VARCHAR" },
        { "name": "col2", "type": "INTEGER" }
      ]
    }
  ]
}`;

function buildExtractSchemaPrompt(file: RawFile): string {
  return `Extract ALL tables and columns from this file. Return ONLY valid JSON.

--- File: ${file.fileName} ---
${file.content}`;
}

/* ── Phase 2: Table Pair Matching ── */

const MATCH_TABLES_SYSTEM_PROMPT = `You are a data migration expert. You are given a compact list of SOURCE tables/columns and TARGET tables/columns.

Your job is to identify which source table(s) map to which target table(s). One source table can map to multiple targets and vice versa.

Rules:
- Match by table name similarity, column overlap, and semantic meaning.
- Every target table should be matched if possible.
- Output ONLY valid JSON, no other text.

Expected JSON output:
{
  "table_pairs": [
    {
      "target_table": "customers",
      "source_tables": ["legacy_customers", "customer_info"],
      "confidence": 0.9,
      "reasoning": "Column names and types overlap significantly"
    }
  ],
  "unmatched_target_tables": [],
  "unmatched_source_tables": []
}`;

interface CompactTable {
  table_name: string;
  columns: { name: string; type: string }[];
}

function buildMatchTablesPrompt(
  sourceTables: CompactTable[],
  targetTables: CompactTable[],
  rules?: string
): string {
  let prompt = `Match source tables to target tables based on schema similarity.\n`;
  if (rules?.trim()) {
    prompt += `\nADDITIONAL RULES (you MUST follow these):\n${rules.trim()}\n`;
  }

  prompt += `\n=== SOURCE TABLES ===\n`;
  for (const t of sourceTables) {
    prompt += `\nTable: ${t.table_name}\n  Columns: ${t.columns.map((c) => `${c.name} (${c.type})`).join(", ")}\n`;
  }

  prompt += `\n=== TARGET TABLES ===\n`;
  for (const t of targetTables) {
    prompt += `\nTable: ${t.table_name}\n  Columns: ${t.columns.map((c) => `${c.name} (${c.type})`).join(", ")}\n`;
  }

  return prompt;
}

/* ── Phase 3: Detailed Column Mapping (per table pair) ── */

const MAP_COLUMNS_SYSTEM_PROMPT = `You are an expert Data Migration and Schema Mapping AI Agent.

You are mapping columns from one or more SOURCE tables to a single TARGET table. You have the full raw file content for only the relevant tables.

You must:
1. Produce ONE mapping entry PER target column.
2. Provide a confidence score (0 to 1) for each mapping.
3. Explain the reasoning.
4. Suggest transformation rules if necessary (SQL-like syntax).
5. Detect derived columns (target column built from multiple source columns).
6. Detect incompatible columns.
7. Never hallucinate columns that do not exist in the files.
8. Return ONLY valid JSON.

CRITICAL rules for source_columns:
- source_columns MUST contain ONLY the source columns actually USED.
- Do NOT list all columns from the source table.

Expected JSON output:
{
  "mappings": [
    {
      "source_columns": ["source_table.col"],
      "target_column": "target_table.col",
      "confidence_score": 0.95,
      "match_type": "exact|semantic|transformed|derived|incompatible",
      "transformation_rule": "SQL expression or null",
      "reasoning": "Why this mapping"
    }
  ],
  "unmapped_source_columns": ["table.col1"],
  "unmapped_target_columns": ["table.col1"],
  "analysis_summary": "Brief overview"
}`;

function buildMapColumnsPrompt(
  sourceContent: { tableName: string; rawContent: string }[],
  targetContent: { tableName: string; rawContent: string }[],
  userInstruction?: string,
  rules?: string
): string {
  let prompt = `Map columns from the SOURCE table(s) to the TARGET table(s). Return ONLY valid JSON.\n`;
  if (userInstruction?.trim()) {
    prompt += `\nUser's instruction: ${userInstruction.trim()}\n`;
  }
  if (rules?.trim()) {
    prompt += `\nADDITIONAL RULES (you MUST follow these):\n${rules.trim()}\n`;
  }

  prompt += `\n=== SOURCE TABLE(S) - Raw Content ===\n`;
  for (const s of sourceContent) {
    prompt += `\n--- Table: ${s.tableName} ---\n${s.rawContent}\n`;
  }

  prompt += `\n=== TARGET TABLE(S) - Raw Content ===\n`;
  for (const t of targetContent) {
    prompt += `\n--- Table: ${t.tableName} ---\n${t.rawContent}\n`;
  }

  return prompt;
}

export {
  SYSTEM_PROMPT,
  EXTRACT_SCHEMA_SYSTEM_PROMPT,
  buildExtractSchemaPrompt,
  MATCH_TABLES_SYSTEM_PROMPT,
  buildMatchTablesPrompt,
  MAP_COLUMNS_SYSTEM_PROMPT,
  buildMapColumnsPrompt,
};

export type { CompactTable };
