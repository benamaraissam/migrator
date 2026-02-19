# Migrator – .NET API + Angular (Clean Architecture)

This document describes the **.NET + Angular** variant of the Migrator app.

## Structure

- **Backend:** `src-dotnet/` – .NET 9 solution with Clean Architecture
  - **Migrator.Domain** – Domain entities
  - **Migrator.Application** – Application contracts and DTOs
  - **Migrator.Infrastructure** – LLM (OpenAI) and mapping logic
  - **Migrator.API** – ASP.NET Core Web API

- **Frontend:** `frontend/` – Angular 19 app
  - `src/app/core/services/mapping-api.service.ts` – Calls `/api/map-schema-stream` and `/api/refine-mapping`
  - `src/app/features/migrator/` – Migrator UI (file panels, chat, mapping result)

## Run locally

### 1. API (required)

```bash
cd src-dotnet/Migrator.API
# Set OPENAI_API_KEY or LLM_API_KEY (and optionally LLM_BASE_URL, LLM_MODEL)
dotnet run
```

API listens on **http://localhost:5102**.

### 2. Angular (with proxy to API)

```bash
cd frontend
npm install --legacy-peer-deps   # if not already
ng serve
```

Open **http://localhost:4200**. The dev server proxies `/api` to `http://localhost:5102`.

### 3. Optional: original Node API + Vite

The original stack still works:

```bash
# Terminal 1
npm run dev:api

# Terminal 2
npm run dev:frontend
```

## Clean Architecture (backend)

- **Domain** – No dependencies. Defines `RawFile`, `MappingItem`, `MappingResult`.
- **Application** – Depends on Domain. Defines `IMapSchemaService`, `RefineInput`, `RefineResult`, and request/response DTOs.
- **Infrastructure** – Depends on Application and Domain. Implements `IMapSchemaService` using the OpenAI .NET SDK, prompts, and JSON parsing.
- **API** – Depends on Application and Infrastructure. Registers the service and exposes REST + SSE endpoints.

## Angular frontend

The Angular app currently provides:

- Sidebar with chat log and streaming progress/tokens
- Source and target file upload
- User instruction input and “Send”
- Mapping result table (confidence, mappings list)

You can extend it by porting more of the original Vite UI (rules, session save/load, unified mapping list with filters, export, etc.) into additional Angular components and services.
