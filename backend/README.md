# Migrator – .NET API (Clean Architecture)

ASP.NET Core API for AI-powered schema mapping. Clean Architecture layers:

- **Migrator.Domain** – Entities (`RawFile`, `MappingItem`, `MappingResult`, `Project`, `ProjectShare`)
- **Migrator.Application** – Use cases and contracts (`IMapSchemaService`, `IProjectRepository`, DTOs)
- **Migrator.Infrastructure** – OpenAI integration, EF Core + PostgreSQL, repositories
- **Migrator.API** – Controllers, DI, CORS

## PostgreSQL

Sessions/projects are stored in PostgreSQL. Create the database and set the connection string.

### 1. Create database

```bash
createdb migrator
# or with psql:
psql -U postgres -c "CREATE DATABASE migrator;"
```

### 2. Connection string

Set in `Migrator.API/appsettings.json` or `appsettings.Development.json` (or environment):

```json
"ConnectionStrings": {
  "DefaultConnection": "Host=localhost;Port=5432;Database=migrator;Username=postgres;Password=YOUR_PASSWORD"
}
```

Migrations run automatically on startup. To add a new migration:

```bash
cd backend/src/Migrator.API
dotnet ef migrations add YourMigrationName
```

## Run the API

```bash
cd backend/src/Migrator.API
dotnet run
```

Runs at `http://localhost:5102` (see `Properties/launchSettings.json`). Ensure PostgreSQL is running.

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

Optional: `LLM_BASE_URL`, `LLM_MODEL`, `LLM_MAX_TOKENS`.

### 2. User secrets (recommended for local development)

```bash
cd backend/src/Migrator.API
dotnet user-secrets set "HF_TOKEN" "your-key-here"
```

### 3. appsettings.Development.json

You can set connection string and `HF_TOKEN` in `appsettings.Development.json`. This file is gitignored.

| Variable         | Description                         |
|------------------|-------------------------------------|
| `LLM_API_KEY`    | API key (or use `OPENAI_API_KEY`)  |
| `OPENAI_API_KEY` | Same as above                       |
| `HF_TOKEN`       | Hugging Face token (alternative)   |
| `LLM_BASE_URL`   | Custom endpoint (e.g. Hugging Face) |
| `LLM_MODEL`      | Model name                          |
| `LLM_MAX_TOKENS` | Max tokens (default 128000)        |

## Endpoints

### Mapping
- `POST /api/map-schema` – One-shot mapping (no streaming)
- `POST /api/map-schema-stream` – SSE: `progress`, `token`, `result` / `error`
- `POST /api/refine-mapping` – Refine existing mapping with a user message

### Sessions (stored in PostgreSQL; user identified by cookie `migrator_uid`)
- `GET /api/sessions` – List current user's sessions
- `GET /api/sessions/{id}` – Get one session (full payload)
- `POST /api/sessions` – Create session
- `PUT /api/sessions/{id}` – Update session
- `DELETE /api/sessions/{id}` – Delete session
