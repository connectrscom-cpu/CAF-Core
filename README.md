# CAF Core

CAF Core is the new backend platform for the CAF (Content Automation Framework) system.

## What this repo owns

This repo should own:
- CAF’s explicit domain model
- database-first state for core entities
- learning loops
- diagnostics
- structured editorial memory
- performance memory
- APIs / services that gradually centralize business logic outside n8n

## What this repo now contains

| Package | Path | Tech | Purpose |
|---------|------|------|---------|
| **CAF Core API** | `/` (root) | Fastify + Postgres | Decision engine, learning rules, suppression, jobs, state transitions |
| **Review App** | `apps/review/` | Next.js 14 | Human review workbench — reads Sheets + Supabase, dual-writes to Core |
| **Carousel Renderer** | `services/renderer/` | Express + Puppeteer + Handlebars | Renders carousel slide PNGs from templates |
| **Video Assembly** | `services/video-assembly/` | Express + ffmpeg | Stitches images into video, muxes audio, uploads to Supabase |
| **Media Gateway** | `services/media-gateway/` | Express + http-proxy | Single-port proxy that spawns renderer + video-assembly children |
| **Sheets Adapter** | `src/adapters/sheets/` | googleapis | Syncs Runtime / Review Queue tabs into caf_core DB |
| **Supabase Adapter** | `src/adapters/supabase/` | @supabase/supabase-js | Mirrors public.tasks + assets into caf_core DB |

## Where legacy orchestration still lives

Today, major orchestration still lives in n8n workflows, Google Sheets workbooks, and provider-specific service calls. CAF Core integrates with that system during migration.

## Current north star

Turn CAF from:
- a system that produces content

into:
- a system that produces better content over time

That means CAF Core must eventually own:
- explicit state
- diagnostics
- editorial learning
- market learning
- experiment memory

## First milestone

First milestone for this repo:

1. define core schema
2. ingest ContentJobs
3. run DiagnosticAudits
4. store audit results
5. expose them for review UI / ops

## Quick Start

### CAF Core API (port 3847)

```bash
cp .env.example .env          # fill DATABASE_URL at minimum
docker compose up -d           # local Postgres
npm install
npm run migrate
npm run seed:demo              # optional demo project
npm run dev                    # http://localhost:3847/health
```

### Review App (port 3000)

```bash
cd apps/review
npm install
# set NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GOOGLE_* in .env
npm run dev                    # http://localhost:3000
```

### Media Gateway (port 3300 → renderer :3333 + video :3334)

```bash
cd services/renderer && npm install && cd ..
cd services/video-assembly && npm install && cd ..
cd services/media-gateway && npm install
node server.js                 # spawns children automatically
```

### Adapters (CLI sync)

```bash
npm run sync:sheets            # Sheets Runtime + Review Queue → caf_core
npm run sync:supabase          # Supabase tasks + assets → caf_core
```

### Deploy (Fly.io)

Each service has its own `fly.toml` + `Dockerfile`:

| Service | fly.toml | Dockerfile |
|---------|----------|------------|
| CAF Core | `fly.toml` | `Dockerfile` |
| Review App | `apps/review/fly.toml` | `apps/review/Dockerfile` |
| Media Gateway | `services/media-gateway/fly.toml` | `services/media-gateway/Dockerfile` |

**Auth:** set `CAF_CORE_REQUIRE_AUTH=1` and `CAF_CORE_API_TOKEN`; send `x-caf-core-token` or `Authorization: Bearer …` on all routes except `GET /health`.

**Migrations** are tracked in `caf_core.schema_migrations` — safe to re-run `npm run migrate`.

**Primary endpoint:** `POST /v1/decisions/plan` — body: `project_slug`, `candidates[]`. Returns selected jobs, dropped candidates, suppression reasons, and stores a `decision_traces` row unless `dry_run: true`.

See route registrations in [`src/routes/v1.ts`](src/routes/v1.ts).

## Documentation

- **Master checklist (all inputs from you):** [`docs/USER_INPUT_AND_SECRETS.md`](docs/USER_INPUT_AND_SECRETS.md)
- **HTTP API reference:** [`docs/API_REFERENCE.md`](docs/API_REFERENCE.md)
- **Stack + architecture + signal pack → output + publishing metadata (`suggested_*`):** [`docs/CAF_CORE_OVERVIEW_AND_SIGNAL_TO_OUTPUT.md`](docs/CAF_CORE_OVERVIEW_AND_SIGNAL_TO_OUTPUT.md)
- **Secrets and env template:** [`.env.example`](.env.example) — CAF Core + legacy stack variables to fill in your vault.
- **Secrets inventory (reference):** [`ENV_AND_SECRETS_INVENTORY.md`](ENV_AND_SECRETS_INVENTORY.md) — narrative checklist for Vercel/Fly/n8n.
- **Numbered series:** [`01_project_overview.md`](01_project_overview.md) … [`10_migration_strategy.md`](10_migration_strategy.md) — doctrine and pipeline.
- **Domain model:** [`03_domain_model.md`](03_domain_model.md).
- **Rebuild pack (legacy review app slice):** [`CAF-REBUILD-PACK-V1.md`](CAF-REBUILD-PACK-V1.md).
- **Services & DB refs:** [`caf-services-media-renderer-video.md`](caf-services-media-renderer-video.md), [`supabase-schema-architecture.md`](supabase-schema-architecture.md), [`video-assembly.md`](video-assembly.md).
- **Legacy Sheets:** [`google-sheets-architecture-legacy-caf.md`](google-sheets-architecture-legacy-caf.md).
