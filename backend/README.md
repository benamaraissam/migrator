# Migrator – .NET API (Clean Architecture)

ASP.NET Core API for AI-powered schema mapping. Clean Architecture layers:

- **Migrator.Domain** – Entities (`RawFile`, `MappingItem`, `MappingResult`)
- **Migrator.Application** – Use cases and contracts (`IMapSchemaService`, DTOs)
- **Migrator.Infrastructure** – OpenAI integration, prompts, JSON parsing
- **Migrator.API** – Controllers, DI, CORS

## Run the API

```bash
cd src-dotnet/Migrator.API
dotnet run
```

Runs at `http://localhost:5102` (see `Properties/launchSettings.json`).

## Configuration

The API needs an LLM key. Use **one** of these (in order of precedence):

### 1. Environment variables (recommended for production)

```bash
export LLM_API_KEY="your-key-here"
# or
export OPENAI_API_KEY="your-key-here"
# or (e.g. for Hugging Face)
export HF_TOKEN="your-key-here"
```

Optional: `LLM_BASE_URL`, `LLM_MODEL` (default: `gpt-4o-mini`).

### 2. User secrets (recommended for local development)

```bash
cd src-dotnet/Migrator.API
dotnet user-secrets set "LLM_API_KEY" "your-key-here"
# optional:
dotnet user-secrets set "LLM_BASE_URL" "https://your-llm-endpoint.com/v1"
dotnet user-secrets set "LLM_MODEL" "gpt-4o-mini"
```

### 3. appsettings.Development.json (avoid for real keys)

You can set `LLM_API_KEY`, `OPENAI_API_KEY`, or `HF_TOKEN` in `Migrator.API/appsettings.Development.json`. Prefer env vars or user secrets so the key is not committed.

| Variable         | Description                         |
|------------------|-------------------------------------|
| `LLM_API_KEY`    | API key (or use `OPENAI_API_KEY`)  |
| `OPENAI_API_KEY` | Same as above                       |
| `HF_TOKEN`       | Hugging Face token (alternative)    |
| `LLM_BASE_URL`   | Custom endpoint (e.g. Hugging Face) |
| `LLM_MODEL`      | Model name (default: `gpt-4o-mini`) |

## Endpoints

- `POST /api/map-schema` – One-shot mapping (no streaming)
- `POST /api/map-schema-stream` – SSE: `progress`, `token`, `result` / `error`
- `POST /api/refine-mapping` – Refine existing mapping with a user message

Request/response shapes match the original Node API.
