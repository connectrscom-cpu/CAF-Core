# CAF Current State Context Pack — Platform and Funnel

**Volume 1 of 4** | Regenerated 2026-07-16 from `docs/CAF_CURRENT_STATE_CONTEXT_PACK.md`  
**Planning LLMs:** `docs/FABLE_IMPROVEMENT_BRIEFING.md`

---

## 1. Executive summary

### What CAF is

CAF (Content Automation Framework) is a **content automation / content operations platform** that turns research inputs, evidence, signal packs, creative intelligence, and planning decisions into **generated, QC-checked, rendered, reviewed, publishable, and learnable** social content.

The production loop:

```
Inputs / evidence → signal pack → planned jobs → decision engine → content jobs
  → LLM drafts → QC / risk → diagnostics → rendering → human review
  → rework → publishing → performance metrics → learning rules
```

### Problem it solves

Operators run multi-platform content brands (e.g. SNS, Cuisina) at scale: ingest competitor/top-performer research, plan ideas per flow type, generate copy and media, enforce brand/risk gates, route through human review, publish to Meta, and close the loop with performance-driven learning.

### Who uses it

| Persona | Surface |
|---------|---------|
| **Marketer / brand owner** | Review app marketer funnel (`/workspace`, `/brand/[slug]/*`) |
| **Content operator / reviewer** | Review workbench (`/review`, `/t/[task_id]`) |
| **Pipeline engineer** | Core API, CLI (`npm run process-run`), admin HTML |
| **Inputs / research operator** | Admin inputs pages, `/v1/inputs-*` APIs |
| **External workers** | n8n publish webhooks, renderer/video-assembly sidecars |

### Source of truth

- **PostgreSQL schema `caf_core`** — especially `content_jobs.generation_payload`
- **Core API** (`src/server.ts`, Fastify) — not the Review app
- **Migrations** (`migrations/*.sql`) — schema truth over prose docs

### Mature vs experimental (honest)

| Mature / production-used | Partial / gated / experimental |
|--------------------------|--------------------------------|
| Run planning + job pipeline | Product image flows (`FLOW_IMG_*`) — blocked at generation |
| Standard carousel (`FLOW_CAROUSEL`) | Full composite saliency text-placement automation (designed, not built) |
| QC + risk policies + human review | Project `risk_rules` — config only, **not** QC-enforced |
| HeyGen video flows (script / prompt / no-avatar / hook-first) | Scene assembly (Sora) — wired but provider-dependent |
| Inputs → signal pack funnel (incl. LinkedIn scrapers) | Stage-3 structured idea picker at plan time (partial) |
| Publications + Meta executor | `CAF_PUBLISH_EXECUTOR=none` default (n8n external) |
| Learning rules (planning + generation) | Global learning rules (disabled in compiler) |
| Review app workbench | Marketer funnel — growing; some ops still admin-only |
| Manual mimic carousel | Why Mimic + New Visual — newer, actively evolving |
| Brand Visual System (BVS) + brand bibles | BVS invented plates — `template_bg` + BVS only |
| **Content routes** (lanes ↔ flows ↔ idea quotas) | Route UX polish; advanced lanes off by default |
| **Project setup / onboarding packs** + `/setup/*` checklists | Dogfood friction log still thin (`CAF_DOGFOOD_NOTES.md`) |
| LinkedIn document post path (earlier) | **Text lanes** (LI text, Reddit, IG thread) — shipped, maturing |
| | **UGC video** (`FLOW_VID_UGC`) — shipped, maturing |
| | Research pipeline panel / platform brief packs — newer |
| | Pre-LLM subject relevance + content-subject guards — newer |

---

## 2. Platform components

| Component | Path | Purpose | State owned | Depends on | Key env | Maturity |
|-----------|------|---------|-------------|------------|---------|----------|
| **CAF Core API** | `src/` | Orchestration, HTTP, business logic | `caf_core.*` tables | Postgres, OpenAI, providers | `DATABASE_URL`, `PORT` | Production |
| **Postgres `caf_core`** | `migrations/` | All persistent state | Everything | — | `DATABASE_URL` | Production |
| **Review app** | `apps/review/` | Operator + marketer UI (client) | None (proxies Core) | Core API, renderer | `CAF_CORE_URL`, `RENDERER_BASE_URL` | Production (embedded in Core Fly image) |
| **Admin HTML** | `src/routes/admin.ts` | Legacy ops workbench | None | Core | Same as Core | Production |
| **Renderer** | `services/renderer/` | Puppeteer + HBS → PNG slides | Temp files | Templates from Core or disk | `PORT`, `RENDER_CONCURRENCY` | Production |
| **Video assembly** | `services/video-assembly/` | ffmpeg stitch/mux/burn | Temp uploads | Supabase | `SUPABASE_*` | Production |
| **Media gateway** | `services/media-gateway/` | Single port proxy to renderer + video | None | Child processes | `PORT`, `SPAWN_CHILDREN` | Production (Fly sidecar) |
| **Storage** | Supabase | Asset URLs (carousel, video, mimic plates) | Bucket objects | — | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Production |
| **OpenAI** | external | LLM generation, TTS, Sora, vision | None | API key | `OPENAI_API_KEY` | Production |
| **HeyGen** | external | Avatar / video agent renders | Provider session IDs in `render_state` | API key | `HEYGEN_API_KEY` | Production |
| **BFL / DashScope / NVIDIA** | external | Mimic image edit / T2I | None | Provider keys | `MIMIC_IMAGE_*`, `BFL_API_KEY` | Gated (`MIMIC_IMAGE_ENABLED=false` default) |
| **Meta Graph** | external | IG/FB publish | Placement rows | Page tokens | `CAF_PUBLISH_EXECUTOR`, `CAF_META_*` | Optional |
| **Apify / scrapers** | external | Evidence ingest | Scraper run rows | `APIFY_API_TOKEN` | Partial |
| **Document AI** | external | Carousel OCR for mimic overlay seed | None | GCP creds | `DOCUMENT_AI_*` | Optional |
| **n8n / external publish workers** | external | Legacy publish execution | Callback to Core | Webhook | `CAF_PUBLISH_EXECUTOR=none` | Legacy path |

**Deployment:** Production Review is embedded at `https://caf-core.fly.dev/admin/workbench` (not a separate Vercel deploy). Ship Review changes with `fly deploy -a caf-core` from repo root.

---

## 3. End-to-end funnel

### Stage map

| Stage | Trigger | Main files | DB tables | Input → output | Status change | Failure modes | Operator surface |
|-------|---------|------------|-----------|----------------|---------------|---------------|------------------|
| **Evidence upload** | `POST /v1/inputs-evidence/upload` | `inputs-evidence.ts`, repos | `inputs_evidence_imports`, `inputs_evidence_rows` | XLSX → normalized rows | import status | Parse errors, sparse rows | Admin inputs, Review proxy |
| **Scraper runs** | `POST /v1/inputs-sources/...` | `inputs-scrapers.ts` | `inputs_scraper_runs`, `inputs_source_rows` | Apify/HTML → evidence shape | run status | Apify failures | Admin |
| **Insights passes** | `POST /v1/inputs-processing/.../run-*` | `inputs-processing.ts` | `inputs_evidence_row_insights` | Rows → tier insights | pass progress | LLM/vision timeouts | Admin |
| **Signal pack build** | `POST .../build-signal-pack` | processing + signal-packs | `signal_packs`, `ideas` | Import/idea list → pack JSON | pack created | Empty insights | Admin, API |
| **Run create** | `POST /v1/runs` | `runs.ts`, `run-orchestrator.ts` | `runs` | project + signal_pack_id | `CREATED` | Missing pack | Admin, API |
| **Materialize jobs** | `POST .../jobs` or `.../candidates` | `runs.ts`, `run-candidates-materialize.ts` | `runs.planned_jobs_json` | pack → planned rows | — | No ideas | Admin, CLI |
| **Start run** | `POST .../start` | `run-orchestrator.ts` | `content_jobs`, `runs` | planned → jobs | `PLANNING`→`PLANNED`→`GENERATING` | No flows enabled | Admin, `process-run` CLI |
| **LLM generation** | pipeline auto / `POST .../generate` | `llm-generator.ts`, `job-pipeline.ts` | `job_drafts`, `generation_payload` | prompt → `generated_output` | `GENERATING`→`GENERATED` | Schema fail, API error | Run logs |
| **Mimic prep** | pipeline | `mimic-draft-prep.ts`, `new-visual-carousel-prep.ts` | `generation_payload.mimic_v1` | references + mode | — | Missing archive media | — |
| **QC** | pipeline auto | `qc-runtime.ts` | `generation_payload.qc_result` | output → checklist + risk | `BLOCKED`, route flags | CRITICAL risk | Job detail |
| **Render** | pipeline auto | `job-pipeline.ts`, render services | `assets`, `render_state` | payload → media URLs | `RENDERING`→`IN_REVIEW` | Provider timeout, Flux fail | Review preview |
| **Human review** | operator | Review app → Core `/decide` | `editorial_reviews` | decision + overrides | `APPROVED`/`REJECTED`/`NEEDS_EDIT` | — | `/review`, `/t/[task_id]` |
| **Rework** | `NEEDS_EDIT` | `rework-orchestrator.ts` | new draft attempt | feedback → regen | back to `GENERATING` | Rework loop cap | Review DecisionPanel |
| **Publish** | `POST .../publications/.../start` | `publications.ts`, `meta-graph-publish.ts` | `publication_placements` | approved job → platform post | `draft`→`published` | Meta API errors | `/publish` |
| **Learning** | cron / manual APIs | `learning.ts`, `editorial-learning.ts` | `learning_rules`, `learning_observations` | outcomes → rules | `pending`→`active` | — | `/learning` |

### Run lifecycle (exact strings)

`CREATED` → `PLANNING` → `PLANNED` → `GENERATING` → (`RENDERING`) → (`REVIEWING`) → `COMPLETED` | `FAILED` | `CANCELLED`

Set in: `migrations/002_project_config_and_runs.sql`, `src/repositories/runs.ts`, `run-orchestrator.ts`, `job-pipeline.ts`, `runs.ts`.

### Job lifecycle (exact strings — no DB CHECK on `content_jobs.status`)

`PLANNED` → `GENERATING` → `GENERATED` → (`RENDERING`) → `IN_REVIEW` | `BLOCKED` | `REJECTED` | `NEEDS_EDIT` | `APPROVED` | `FAILED`

Also observed: `READY_FOR_REVIEW` (legacy progress counting), `QC_FAILED` (only `pipeline.ts` `/full` endpoint, not main pipeline).

---

## 4. Domain model and IDs

### Entities

| Entity | Description | Primary key pattern |
|--------|-------------|---------------------|
| **Project** | Named content brand | `project_id` (uuid), `project_slug` (text, e.g. `SNS`) |
| **Run** | One execution cycle | `run_id` = `{PROJECT}_{period}` e.g. `SNS_2026W09` |
| **Signal pack** | Research bundle for a run | `signal_pack_id` (uuid/text per schema) |
| **Candidate / planned row** | Idea × flow in memory or `planned_jobs_json` | `candidate_id` = `{run_id}_{platform}_{NNNN}` or `{base}_{flow_type}` |
| **Content job** | Atomic executable unit | `task_id` = `{run_id}__{platform}__{flow_type}__row{NNNN}__{variation}` |
| **Job draft** | One LLM attempt | `draft_id` = `d_{random12}` |
| **Asset** | Rendered media artifact | `asset_id` = `{candidate_id}__{ASSET_TYPE}_v{version}` |
| **Editorial review** | Human decision | `(project_id, task_id, review_id)` |
| **Publication placement** | Scheduled post | uuid row in `publication_placements` |
| **Learning rule** | Structured behavior change | uuid in `learning_rules` |
| **Evidence import** | XLSX/scraper batch | `inputs_evidence_imports.id` |
| **Evidence row** | Single post/account row | per import |
| **Evidence insight** | Tier analysis on a row | `inputs_evidence_row_insights` |
| **Creative intelligence asset** | Archived top-performer media | `creative_intelligence_assets` |
| **Brand bible** | BVS source per project | `brand_bibles` versioned rows |
| **Brand profile** | Marketer voice/strategy | `brand_profiles` |

### Join pattern

All job-related tables join on **`(project_id, task_id)`** — text IDs, not UUID FKs to `content_jobs`.

### Legacy / dual-write

| Legacy | Canonical | Helper |
|--------|-----------|--------|
| `runs.candidates_json` | `runs.planned_jobs_json` | `readRunPlannedJobsJson()` in `jobs-json-compat.ts` |
| `signal_packs.ideas_json` | structured idea tables | both may coexist |
| Old flow type names | `canonical-flow-types.ts` | `LEGACY_FLOW_TYPE_TO_CANONICAL` |

---
