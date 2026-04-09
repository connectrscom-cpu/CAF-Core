# CAF Core

CAF Core is the **backend platform** for CAF (Content Automation Framework): a content operating system that turns **signals → candidates → decisions → jobs → drafts → rendering → review → publishing → learning**.

This repo exists because the legacy CAF stack (n8n + Google Sheets + Supabase + Fly services + review UI) can produce outputs, but **too much operational truth and business logic is trapped in flows and spreadsheets**. CAF Core’s job is to centralize the domain model, state, and learning loops while remaining compatible with the legacy control plane during migration.

---

## What CAF Core owns (north star)

- **Domain model + IDs**: preserves the existing text-ID hierarchy (`run_id`, `candidate_id`, `task_id`, `asset_id`) and the state machines around them.
- **Database-first state**: the canonical, queryable history for jobs, drafts, audits, reviews, and metrics.
- **Decisioning**: selection, suppression, routing, and traceability for “why did we pick this”.
- **Learning**:
  - diagnostic learning (why outputs are weak/strong)
  - editorial learning (what humans approve/reject/edit)
  - market learning (what performs after publishing)
- **Interfaces**: APIs + adapters that pull contracts out of n8n nodes and sheet columns into explicit modules.

---

## Repo layout (what’s in here today)

| Package | Path | Tech | Purpose |
|---------|------|------|---------|
| **CAF Core API** | `/` (root) | Fastify + Postgres | Decisions, jobs, learning rules, suppression, state transitions |
| **Review App** | `apps/review/` | Next.js 14 | Human review workbench (reads Sheets + Supabase; dual-writes to Core) |
| **Carousel Renderer** | `services/renderer/` | Express + Puppeteer + Handlebars | Renders carousel slide PNGs from templates |
| **Video Assembly** | `services/video-assembly/` | Express + ffmpeg | Stitches images into video, muxes audio, uploads to Supabase |
| **Media Gateway** | `services/media-gateway/` | Express + http-proxy | Single-port proxy that spawns renderer + video-assembly children |
| **Sheets Adapter** | `src/adapters/sheets/` | googleapis | Syncs Sheets runtime/review state into `caf_core` DB |
| **Supabase Adapter** | `src/adapters/supabase/` | @supabase/supabase-js | Mirrors Supabase tasks + assets into `caf_core` DB |

---

## The operational reality (during migration)

Right now, CAF still runs as a distributed system:

- **n8n**: orchestration and external calls (LLMs, renderers, polling)
- **Google Sheets**: visible control plane (runtime queue, review queue, config)
- **Supabase**: durable tasks/assets tables + hosted media binaries/URLs
- **Fly.io services**: rendering + assembly workers behind stable HTTP endpoints
- **Review App**: human decisions surface

CAF Core integrates into that world by making the system **more explicit and queryable** without breaking the legacy workflows.

---

## Quick start (local dev)

### CAF Core API (port 3847)

```bash
cp .env.example .env           # fill DATABASE_URL at minimum
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

---

## Deploy (Fly.io)

Each deployable service has its own `fly.toml` + `Dockerfile`:

| Service | fly.toml | Dockerfile |
|---------|----------|------------|
| CAF Core | `fly.toml` | `Dockerfile` |
| Review App | `apps/review/fly.toml` | `apps/review/Dockerfile` |
| Media Gateway | `services/media-gateway/fly.toml` | `services/media-gateway/Dockerfile` |

- **Auth**: set `CAF_CORE_REQUIRE_AUTH=1` and `CAF_CORE_API_TOKEN`; send `x-caf-core-token` or `Authorization: Bearer …` on all routes except `GET /health`.
- **Migrations**: tracked in `caf_core.schema_migrations` — safe to re-run `npm run migrate`.

---

## Key API endpoints (today)

- **Health**: `GET /health`
- **Decisioning**: `POST /v1/decisions/plan`
  - body: `project_slug`, `candidates[]`
  - returns: selected jobs, dropped candidates, suppression reasons
  - persists: a `decision_traces` row unless `dry_run: true`

Route registrations live in `src/routes/v1.ts`.

---

## Documentation map (recommended reading order)

- **Start here**: `01_project_overview.md` (why CAF exists; rebuild rationale)
- **How it works today**: `02_current_architecture.md` (ownership & state split)
- **Core entities**: `03_domain_model.md` (Project/Run/SignalPack/Candidate/Job/Draft/Asset/Review/Audit/Metrics/LearningRule)
- **Roadmap gaps → implementable spec**: `CAF_SUMMARY_AND_GAPS.md` (rework + publishing workflow specs)
- **Learning spec**: `07_learning_layer_spec.md` (diagnostic/editorial/market loops)
- **IDs & states**: `08_current_ids_and_state_conventions.md`
- **Integration inventory**: `09_external_integrations.md`, `ENV_AND_SECRETS_INVENTORY.md`
- **API**: `docs/API_REFERENCE.md`
- **Legacy reference**: `google-sheets-architecture-legacy-caf.md`

