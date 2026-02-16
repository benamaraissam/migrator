# Schema Mapping Migrator

AI-powered schema mapping for data migration. Maps columns between a **SOURCE** schema and a **TARGET** schema, producing structured JSON with confidence scores, transformation rules, and derived column detection.

## Features

- **Column matching**: Exact, semantic, transformed, derived, and incompatible
- **Confidence scores**: Per-mapping and global (0–1)
- **Transformation rules**: SQL-like expressions when needed
- **Web UI**: Paste schemas, get mappings
- **CLI**: Map schemas from JSON files
- **API**: REST endpoint for integration

## Setup

```bash
npm install
```

**Option A – Hugging Face (recommended if no OpenAI key):**

```bash
export HF_TOKEN=hf_...
export LLM_MODEL=meta-llama/Llama-3.2-3B-Instruct   # or any model on Inference Providers
```

**Option B – OpenAI:**

```bash
export OPENAI_API_KEY=sk-...
export OPENAI_MODEL=gpt-4o-mini
```

**Option C – Custom OpenAI-compatible endpoint:**

```bash
export LLM_BASE_URL=https://your-endpoint.com/v1
export LLM_API_KEY=your_key
export LLM_MODEL=your-model
```

## Usage

### Web UI

```bash
npm run dev
```

Opens the API at `http://localhost:3001` and the frontend at `http://localhost:5173`.

**Input options:**
- **Paste JSON** – Use schema JSON directly in the text areas.
- **Upload files** – Upload one or more CSV, JSON, or TXT files per side; the app infers the schema and merges columns for AI analysis. Supported formats:
  - **CSV** – Headers in first row; types inferred from data.
  - **JSON** – Schema object `{table_name, columns}` or array of objects (schema inferred from keys and sample values).
  - **TXT** – Treated as tab- or comma-separated like CSV.

Use "Load example" to try sample schemas, then click "Map schemas".

### CLI

```bash
npm run map -- examples/source.json examples/target.json
```

### API

```bash
curl -X POST http://localhost:3001/api/map-schema \
  -H "Content-Type: application/json" \
  -d '{"source_schema": {...}, "target_schema": {...}}'
```

## Schema format

**Source / target schema**:

```json
{
  "table_name": "string",
  "columns": [
    {
      "name": "string",
      "data_type": "string",
      "nullable": true,
      "sample_values": ["optional"],
      "description": "optional"
    }
  ]
}
```

**Response** (see `rules.md` for full spec):

```json
{
  "mappings": [
    {
      "target_column": "full_name",
      "source_columns": ["first_name", "last_name"],
      "confidence_score": 0.92,
      "match_type": "derived",
      "reasoning": "...",
      "transformation_rule": "CONCAT(first_name, ' ', last_name)"
    }
  ],
  "unmapped_source_columns": [],
  "unmapped_target_columns": [],
  "global_confidence": 0.945,
  "analysis_summary": "..."
}
```
