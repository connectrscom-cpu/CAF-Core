# CAF Core — Rebuild from documentation

**Purpose:** Step-by-step guide for another team or repository to **stand up a working CAF Core stack** using only this repo's docs and code — without tribal knowledge.

**Prerequisites:** Node.js ≥ 20, Docker (optional, for local Postgres), accounts for OpenAI and any media providers you enable.

**Read first:** [CAF_CURRENT_STATE_CONTEXT_PACK.md](./CAF_CURRENT_STATE_CONTEXT_PACK.md), [EXTERNAL_CONTEXT_PACK.md](./EXTERNAL_CONTEXT_PACK.md), [DOMAIN_MODEL.md](./DOMAIN_MODEL.md), [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md).

---

## What you are building

| Component | Path | Port (default) | Required? |
|-----------|------|----------------|-----------|
| **CAF Core API** | repo root | 3847 | **Yes** |
| **PostgreSQL** | Docker or hosted | 5432 | **Yes** |
| **Review app** | `apps/review` | 3000 | Recommended — production embeds in Core Fly at `/admin/workbench` |
| **Carousel renderer** | `services/renderer` | 3333 | For carousel flows |
| **Video assembly** | `services/video-assembly` | 3334 | For video stitch/mux |
| **Media gateway** | `services/media-gateway` | 3300 / 8080 | Optional (combines renderer + assembly) |

Core alone can run planning, generation, QC, and API-backed review **without** media workers — but carousel/video render steps will fail until workers are reachable.

---

## Phase 1 — Database

### Option A: Docker Compose (local)

```bash
docker compose up -d
```

Use the `DATABASE_URL` from `.env.example` comments (typically `postgresql://postgres:postgres@localhost:5432/caf_core`).

### Option B: Hosted Postgres (Supabase, Fly Postgres, etc.)

Create an empty database. Set `DATABASE_URL` to the connection string (pooler URI mode works).

### Apply schema

```bash
cp .env.example .env
# Edit DATABASE_URL
npm install
npm run migrate
```

Migrations create schema **`caf_core`** and all tables. Re-running migrate is safe.

### Optional seed data

```bash
npm run seed:demo          # Demo project
npm run seed:canonical-flows
npm run seed:flow-engine   # Flow definitions + prompts
```

---

## Phase 2 — Core API minimum config

In `.env`, set at minimum:

| Variable | Required | Notes |
|----------|----------|-------|
| `DATABASE_URL` | **Yes** | Postgres connection |
| `OPENAI_API_KEY` | **Yes** for LLM | Generation, QC helpers, mimic copy |
| `OPENAI_MODEL` | Recommended | Default chat model |

For a **smoke test** without rendering:

```bash
npm run dev
curl http://localhost:3847/health
```

### Recommended for full pipeline

| Variable | Purpose |
|----------|---------|
| `RENDERER_BASE_URL` | Carousel worker (default `http://localhost:3333`) |
| `VIDEO_ASSEMBLY_BASE_URL` | ffmpeg worker (default `http://localhost:3334`) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ASSETS_BUCKET` | Asset uploads |
| `HEYGEN_API_KEY` | Avatar / video agent flows |
| `MIMIC_IMAGE_ENABLED=1` + provider keys | Top-performer mimic render |

Full list: **`.env.example`**, **`ENV_AND_SECRETS_INVENTORY.md`**, **`src/config.ts`** (Zod schema = source of truth).

---

## Phase 3 — Media workers

### Carousel renderer

```bash
cd services/renderer
npm install
# Optional: CAF_TEMPLATE_API_URL=http://localhost:3847  (pull HBS from Core)
npm start
# Listens on PORT (default 3333)
```

Core serves templates at **`GET /api/templates/*`** from `CAROUSEL_TEMPLATES_DIR` (see `src/routes/renderer-templates.ts`).

### Video assembly

```bash
cd services/video-assembly
npm install
# Set SUPABASE_* if uploading outputs
npm start
# Listens on PORT (default 3334)
```

### Media gateway (production pattern)

```bash
cd services/media-gateway
npm install
node server.js
```

Child processes inherit env — set Supabase and mux vars on the gateway host. See **`services/media-gateway/`** and **`fly.toml`** variants.

---

## Phase 4 — Review app

```bash
cd apps/review
npm install
```

Create `apps/review/.env.local`:

```env
CAF_CORE_URL=http://localhost:3847
# If Core uses auth:
# CAF_CORE_TOKEN=<same as CAF_CORE_API_TOKEN>
# Optional:
# RENDERER_BASE_URL=http://localhost:3333
# PROJECT_SLUG=SNS
```

```bash
npm run dev
# http://localhost:3000
```

Review is a **client** — all job state comes from Core APIs.

---

## Phase 5 — End-to-end workflow

### Path A: Legacy XLSX intake

```bash
npm run start-run:xlsx -- path/to/signals.xlsx --project SNS
```

Or `POST /v1/signal-packs/upload` (multipart).

### Path B: Inputs pipeline (evidence → signal pack)

1. Admin UI: `/admin/inputs` — upload evidence XLSX or run scrapers
2. `/admin/processing` — insights, profile, build signal pack
3. Create run linked to signal pack

See **`docs/CAF_INPUTS_PIPELINE_ROADMAP.md`**.

### Run lifecycle (API)

1. Create run with `signal_pack_id` → status `CREATED`
2. `POST /v1/runs/:project_slug/:run_id/jobs` — materialize `planned_jobs_json`
3. `POST /v1/runs/:project_slug/:run_id/start` — plan + insert `content_jobs`
4. `POST /v1/runs/:project_slug/:run_id/process` — generate + QC (background)
5. `POST /v1/runs/:project_slug/:run_id/render` — render `GENERATED` jobs
6. Review via Review app or `/v1/reviews`
7. `POST /v1/publications/:project_slug/...` — publish placements

CLI alternative: `npm run process-run -- <run_id> --project SNS`

---

## Phase 6 — Production deploy

| Target | Config |
|--------|--------|
| **Core** | `fly.toml`, `Dockerfile` at repo root |
| **Media gateway** | `services/media-gateway/fly.toml` |
| **Review** | `apps/review/vercel.json` — Vercel |

Checklist: **`docs/FLY_PRODUCTION_CHECKLIST.md`**

Production essentials:

- `CAF_CORE_REQUIRE_AUTH=1` + `CAF_CORE_API_TOKEN`
- `CAF_PUBLIC_URL` — public Core URL for asset links
- `RENDERER_BASE_URL` / `VIDEO_ASSEMBLY_BASE_URL` — stable worker URLs
- Run `npm run migrate` on deploy or enable `CAF_RUN_MIGRATIONS_ON_START`

---

## Phase 7 — Verify the stack

| Check | Command / URL |
|-------|----------------|
| Core health | `GET /health` |
| Rendering deps | `GET /health/rendering` |
| Review → Core | Review app `/api/health/core` |
| Renderer | `GET {RENDERER_BASE_URL}/health` |
| DB migrations | `SELECT * FROM caf_core.schema_migrations ORDER BY version` |
| Tests | `npm test` (Vitest) |

---

## What docs cannot replace

To **fully re-implement** behavior identical to this repo, you still need:

- **Source code** in `src/services/job-pipeline.ts`, `llm-generator.ts`, mimic modules, etc.
- **Flow engine seed data** — prompt templates and output schemas in DB
- **Migration history** — incremental schema evolution in `migrations/`
- **Integration tests** — `src/**/*.test.ts`, `src/routes/review-contract.test.ts`

For **architectural parity**, Tier 1 docs in [EXTERNAL_CONTEXT_PACK.md](./EXTERNAL_CONTEXT_PACK.md) are sufficient. For **behavioral parity**, treat this repository as the reference implementation.

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `start` fails — no candidates | Run `POST .../jobs` first to materialize `planned_jobs_json` |
| Jobs stuck `RENDERING` | HeyGen poll / missing `HEYGEN_API_KEY` / `RenderNotReadyError` retry |
| Carousel render timeout | Renderer not running; check `RENDERER_BASE_URL`, `CAROUSEL_RENDERER_SLIDE_TIMEOUT_MS` |
| QC passes but risk expected | Project `risk_rules` not enforced — use `risk_policies` or brand bans |
| Review 401 | `CAF_CORE_TOKEN` mismatch with Core `CAF_CORE_API_TOKEN` |
| Mimic disabled | `MIMIC_IMAGE_ENABLED` not set; flow type not in allowed list |

---

## See also

- [README.md](../README.md) — quick start
- [API_REFERENCE.md](./API_REFERENCE.md) — HTTP examples
- [TECH_STACK.md](./TECH_STACK.md) — stack detail
- [CAF_CORE_COMPLETE_GUIDE.md](./CAF_CORE_COMPLETE_GUIDE.md) — merged reference
