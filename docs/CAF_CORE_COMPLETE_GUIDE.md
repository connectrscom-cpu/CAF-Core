# CAF Core — Complete guide (single file)

**Purpose:** One document that merges the project overview, stack, lifecycles, architecture layers, QC, risk, generation guidance, and repository map. Individual topic files under `docs/` remain the maintained copies for smaller edits; this file is for **printing, onboarding packets, or offline reading**.

**Convention:** Paths are from the **repository root**. Schema is **`caf_core`**.

---

## Table of contents

1. [What CAF Core is](#1-what-caf-core-is)
2. [Tech stack](#2-tech-stack)
3. [Domain concepts & entity hierarchy](#3-domain-concepts--entity-hierarchy)
4. [Lifecycles](#4-lifecycles)
5. [End-to-end pipeline (abbreviated)](#5-end-to-end-pipeline-abbreviated)
6. [Critical contract: `generation_payload`](#6-critical-contract-generation_payload)
7. [Architecture layers (detail)](#7-architecture-layers-detail)
8. [Quality checks (QC)](#8-quality-checks-qc)
9. [Risk: policies vs project rules vs brand bans](#9-risk-policies-vs-project-rules-vs-brand-bans)
10. [Generation guidance & learning (two paths)](#10-generation-guidance--learning-two-paths)
11. [Flow typing & special flow types](#11-flow-typing--special-flow-types)
12. [HTTP API surface (index)](#12-http-api-surface-index)
13. [Persistence (`src/repositories`)](#13-persistence-srcrepositories)
14. [Repository layout & companion services](#14-repository-layout--companion-services)
15. [Engineering invariants](#15-engineering-invariants)
16. [Split documentation map](#16-split-documentation-map)

---

## 1. What CAF Core is

**CAF** (Content Automation Framework) is a **content pipeline platform**. **CAF Core** is the backend: a **Fastify API + PostgreSQL** application that owns **operational truth** for content production—signals, **content jobs**, AI drafts, QC, rendered media, human review, publication placements, and learning data.

| Piece | Role |
|--------|------|
| **CAF Core** (repo root) | API, business logic, `caf_core` schema |
| **Review app** (`apps/review`) | Next.js UI; **not** the DB of record |
| **Carousel renderer** (`services/renderer`) | Puppeteer + Handlebars → slide PNGs |
| **Video assembly** (`services/video-assembly`) | ffmpeg → stitched/muxed video |
| **Media gateway** (`services/media-gateway`) | Single port for renderer + assembly |

Core is **self-contained**: all planning, job, QC, render, review, publish, and learning state lives in this repo and Postgres; the companion services above only add media rendering and the operator UI.

### Problems addressed

1. Structured intake (signal packs → candidates with typed fields and lineage).
2. Controlled generation (prompts, tenant config, caps, suppression).
3. Quality gates (checklists + keyword risk before expensive render).
4. Human review (approve / reject / needs edit + rework).
5. Media (carousel PNGs, HeyGen/Sora/ffmpeg, Supabase URLs).
6. Publishing intent (placements, schedules, outcomes).
7. Learning (rules + evidence; planning scores + prompt guidance).

**ID conventions** (`task_id`, `run_id`, etc.) are defined in **`.cursor/rules/caf-domain-model.mdc`**.

---

## 2. Tech stack

### Core API (this repo)

| Concern | Choice |
|---------|--------|
| Runtime | Node.js ≥ 20 |
| Language | TypeScript (ESM) |
| HTTP | Fastify 5 — `src/server.ts` |
| Validation | Zod (routes + `src/config.ts`) |
| DB | PostgreSQL, `pg`, schema `caf_core`, `migrations/*.sql` |
| Tests | Vitest — `npm test` |

### LLM & AI

| Use | Integration |
|-----|-------------|
| Text / JSON | OpenAI Chat — `OPENAI_API_KEY`, `OPENAI_MODEL` |
| Structured output | Flow Engine `output_schemas`; validation controlled by `CAF_OUTPUT_SCHEMA_VALIDATION_MODE` (`skip` / `warn` / `enforce`, wins over legacy `CAF_SKIP_OUTPUT_SCHEMA_VALIDATION`) |
| Scene clips | OpenAI Videos / Sora when configured — `SCENE_ASSEMBLY_CLIP_PROVIDER` |
| Post-approval vision | `OPENAI_APPROVAL_REVIEW_MODEL` |

### Out-of-process media

| Service | Role | Config |
|---------|------|--------|
| Carousel renderer | PNG slides | `RENDERER_BASE_URL`, `CAROUSEL_TEMPLATES_DIR` |
| Video assembly | concat, mux, burn subtitles | `VIDEO_ASSEMBLY_BASE_URL`, poll timeouts |

Core calls these over **HTTP**; it does not run Puppeteer/ffmpeg inside the main API process for those steps.

### Optional integrations

| Provider | Purpose |
|----------|---------|
| HeyGen | Avatar / video agent — `HEYGEN_API_KEY`, polling `HEYGEN_POLL_MAX_MS` |
| Supabase | Asset storage — `SUPABASE_*` |
| Meta Graph | Publishing when `CAF_PUBLISH_EXECUTOR=meta` |

### Review UI

Next.js 14 in `apps/review` — uses `CAF_CORE_URL` and optional `CAF_CORE_TOKEN`.

### Deploy hints

Fly (`fly.toml`, `Dockerfile`), Review on Vercel (`apps/review/vercel.json`). Full env list: `ENV_AND_SECRETS_INVENTORY.md`.

---

## 3. Domain concepts & entity hierarchy

| Concept | Meaning |
|---------|---------|
| **Project** | Tenant (brand); `caf_core.projects`, keyed by `slug` in URLs |
| **Signal pack** | Research bundle; `overall_candidates_json` feeds planning |
| **Run** | One cycle; `runs.run_id` (text) + UUID `id`; links `signal_pack_id` |
| **Content job** | Atomic work unit; unique `(project_id, task_id)`; **`generation_payload`** is the hub |
| **Draft** | One LLM attempt — `job_drafts` |
| **Asset** | Render output — `assets` |
| **Publication placement** | Post intent + outcome — `publication_placements` |

**Note:** `caf_core.candidates` exists in schema; planning primarily uses **signal pack JSON** built in memory in `run-orchestrator.ts`.

---

## 4. Lifecycles

### Run (`caf_core.runs`)

Driven by `POST /v1/runs/:project_slug/:run_id/start` → `startRun` in `src/services/run-orchestrator.ts`.

**`startRun` requires `signal_pack_id` on the run.**

Allowed statuses (SQL check in migration `002`):  
`CREATED`, `PLANNING`, `PLANNED`, `GENERATING`, `RENDERING`, `REVIEWING`, `COMPLETED`, `FAILED`, `CANCELLED`.

| Phase | Typical status | What happens |
|-------|----------------|--------------|
| Created | `CREATED` | Attach `signal_pack_id` before start |
| Planning | `PLANNING` | Load pack, build candidates, `decideGenerationPlan`, insert jobs `PLANNED` |
| Generating | `PLANNED` → `GENERATING` | After jobs exist |
| Execution | `GENERATING` → … | Job pipeline updates run as configured |
| Terminal | `COMPLETED` / `FAILED` | |

### Content job (`caf_core.content_jobs`)

Typical path (`job-pipeline.ts`):

```
PLANNED → GENERATING → GENERATED → (QC) → RENDERING → IN_REVIEW → APPROVED | REJECTED | NEEDS_EDIT
```

- After `runQcForJob`, status may be `BLOCKED`, `QC_FAILED`, short-circuit to `REJECTED` / `NEEDS_EDIT` via `routeJobAfterQc` (`validation-router.ts`).
- Default human gate: `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC` (default true).
- Video may stay `RENDERING` during HeyGen/Sora polls; `RenderNotReadyError` allows retry without marking FAILED.

### Editorial (`caf_core.editorial_reviews`)

`decision`: `APPROVED` | `NEEDS_EDIT` | `REJECTED` — via `src/routes/v1.ts`.

### Publication placements

Statuses: `draft`, `scheduled`, `publishing`, `published`, `failed`, `cancelled` — linked by `(project_id, task_id)`.

### Learning rules

`learning_rules.status`: `pending`, `active`, `superseded`, `rejected`, `expired`. `applyLearningRule` sets `active` + `applied_at`.

### State log

`caf_core.job_state_transitions` — `src/repositories/transitions.ts`.

---

## 5. End-to-end pipeline (abbreviated)

1. **Ingest** — XLSX upload or CLI → `signal_packs`; create **run** `CREATED`.
2. **Start run** — `startRun`: plan → `upsertContentJob` each selected row → `generation_payload` with `signal_pack_id`, `candidate_data`, `prompt_*`.
3. **Process** — `processRunJobs` / single job: `generateForJob` → `runQcForJob` → `routeJobAfterQc` → `runDiagnosticAudit` → render (carousel / HeyGen / scene) → `IN_REVIEW`.
4. **Review** — Human decision; optional rework (`rework-orchestrator.ts`).
5. **Publish** — `publication_placements`; executor `none` | `dry_run` | `meta`.
6. **Learn** — Rules APIs, metrics, optional editorial cron.

---

## 6. Critical contract: `generation_payload`

Stored on **`caf_core.content_jobs`**. Treat as a **versioned integration surface** for pipeline, Review, and admin.

Contains (non-exhaustive):

- Planner: `signal_pack_id`, `candidate_data`, `prompt_id`, `prompt_version_label`, …
- LLM: `generated_output`
- QC: `qc_result` (also `qc_status`, `recommended_route` on columns)
- Render: HeyGen/scene/video URLs, `render_state` / nested provider data
- Publish helpers: `publish_media_urls_json`, `publish_video_url`, …

### Typed readers (incremental contract hardening)

The `src/domain/` folder carves out typed subsets one slice at a time so new code does not have to repeat unsafe `(x as Record<string, unknown>) ?? {}` casts:

| Slice | Module | Helpers |
|-------|--------|---------|
| `qc_result` | `generation-payload-qc.ts` | `qcResultSchema` (Zod), `mergeGenerationPayloadQc` (canonical writer), `pickStoredQcResult` (tolerant reader) |
| `generated_output` | `generation-payload-output.ts` | `pickGeneratedOutput`, `pickGeneratedOutputOrEmpty`, `hasGeneratedOutput` — reject arrays/primitives instead of coercing to `{}` |
| `render_state` | `content-job-render-state.ts` | `pickRenderState`, **`hasActiveProviderSession`** (HeyGen idempotency invariant), `isMidProviderPhase` |

Adoption is incremental. Existing call sites keep working; code you touch or write should prefer these helpers. The HeyGen "don't double-submit when `render_state` already holds `video_id`/`session_id`" rule now has a grep-able name: `hasActiveProviderSession`.

---

## 7. Architecture layers (detail)

Summary table:

| Layer | Responsibility | Primary code |
|-------|----------------|--------------|
| HTTP | Routes, auth | `src/server.ts`, `src/routes/*.ts` |
| Orchestration | Run start → jobs | `run-orchestrator.ts` |
| Decision engine | Score, caps, suppression, traces | `decision_engine/` |
| Job pipeline | Generate → QC → diagnose → render | `job-pipeline.ts` |
| Generation | Prompts, OpenAI, drafts | `llm-generator.ts` |
| QC | Checklists + policies + bans | `qc-runtime.ts` |
| Rendering | Carousel HTTP, HeyGen, Sora, assembly | `heygen-renderer.ts`, `scene-pipeline.ts`, … |
| Review / rework | Human + rework | `v1.ts`, `rework-orchestrator.ts` |
| Publishing | Placements | `publications.ts` |
| Learning | APIs + `compileLearningContexts` | `learning.ts`, `learning-context-compiler.ts` |
| Persistence | SQL | `repositories/` |

### 7.1 HTTP API

- **Entry:** `src/server.ts` — Fastify, CORS, multipart, optional `CAF_CORE_REQUIRE_AUTH` + token; public exceptions: `/health`, `/robots.txt`, renderer template paths.
- **Routes:** `v1`, `runs`, `signal-packs`, `pipeline`, `project-config`, `flow-engine`, `learning`, `publications`, `admin`, `renderer-templates`, `project-integrations`.
- **State:** none durable in-process; all in Postgres.

### 7.2 Run orchestration

- **`startRun`:** CREATED run + `signal_pack_id` → delete orphan jobs for run → `PLANNING` → load pack → allowed flows (skip `offline-flow-types`) → optional scene router expansion → `buildCandidatesFromSignalPack` → `decideGenerationPlan` → `upsertContentJob` + transitions → `PLANNED`/`GENERATING`/terminal.
- **`replanRun`:** same file family.

### 7.3 Decision engine

- **`decideGenerationPlan`** — input: `GenerationPlanRequest`; output: selected jobs, dropped list, suppression, `trace_id` → `decision_traces`.
- **Modules:** `scoring.ts`, `ranking_rules.ts` (learning boosts), `kill_switches.ts`, `route_selector.ts`, `prompt_selector.ts`, `default-plan-caps.ts`, `flow-kind.ts`.
- **Planning learning:** only via `getLearningRulesForPlanning` facade (wraps `listActiveAppliedLearningRules`) — `BOOST_RANK`, `SCORE_BOOST`, `SCORE_PENALTY`.

### 7.4 Job pipeline

- **`processRunJobs`**, `processContentJobById`, `reprocessJobFromScratch`.
- Stages: offline exit → `GENERATING` → `generateForJob` → `runQcForJob` → `routeJobAfterQc` → diagnostic → render branch → `IN_REVIEW`.
- Failures: `markJobFailedPipeline`; video polls: `RenderNotReadyError`.

### 7.5 LLM generation

- **`generateForJob`** — templates from `flow-engine`, `buildCreationPack`, `getLearningContextForGeneration` (facade), OpenAI, output-schema validation controlled by `schemaValidationMode` (resolved from `CAF_OUTPUT_SCHEMA_VALIDATION_MODE`, legacy fallback `CAF_SKIP_OUTPUT_SCHEMA_VALIDATION`), `job_drafts` insert, merge `generated_output`. In `warn` mode, schema failures are recorded on `generation_payload.schema_validation_warnings` without failing.
- **Special:** scene-bundle flows, `FLOW_IMG_*` blocked in `product-flow-types.ts`, carousel addenda + anti-repetition.

### 7.6 Rendering

- **Carousel:** HTTP to `RENDERER_BASE_URL`; `carousel-render-pack.ts`; retries `CAROUSEL_RENDERER_*`.
- **Video:** `heygen-renderer.ts`, `scene-pipeline.ts`, `sora-scene-clips.ts`; concat/mux via video-assembly; assets + `render_state` on job.

### 7.7 Review & rework

- **`v1.ts`:** queue, detail, editorial decision + overrides (script, slides, HeyGen ids, skip video/image regen, …).
- **`rework-orchestrator.ts`:** `executeRework`; pipeline route triggers.

### 7.8 Publishing

- **`publication_placements`**; routes in `publications.ts`; `CAF_PUBLISH_EXECUTOR`; `meta-graph-publish.ts`, `dry-run.ts`; stable JSON payload exposed at `GET /v1/publications/:project_slug/:id/n8n-payload` (route name is historical — Core does not depend on any specific external executor).

### 7.9 Learning

- **`learning.ts`** — rules, evidence, ingest.
- **Cron:** `editorial-analysis-cron.ts` + `EDITORIAL_ANALYSIS_CRON_*`.
- **Global project:** `caf-global` — `learning-global.ts`.
- **Attribution:** `learning_generation_attribution`.
- **Post-approval LLM review:** `src/services/approved-content-llm-review.ts` scores approved jobs and emits **`upstream_recommendations`** (schema in `src/domain/upstream-recommendations.ts`). Stored on `caf_core.llm_approval_reviews.upstream_recommendations` (migration `025`) and fanned out per item into `learning_observations` with `source_type = "llm_upstream_recommendation"` for a queryable audit trail.
- **Run context snapshot:** `src/services/run-context-snapshot.ts` captures prompt versions, project brand/strategy slices, and learning-guidance fingerprints at end-of-planning. Persisted via `setRunContextSnapshot` into `caf_core.runs.context_snapshot_json` (migration `025`). Snapshot failures never abort a run; they are logged via `pipeline-logger.ts`.
- **Run Logs (Review app):** `/runs` lists every run with prompt/context-snapshot indicators; entry point on the sidebar. Deep-links to `/r/[run_id]` for the per-run review queue.

---

## 8. Quality checks (QC)

- **Function:** `runQcForJob(db, jobId, requireHumanReviewAfterQc)` in `src/services/qc-runtime.ts`.
- **Input:** `generation_payload.generated_output` (carousel may be normalized first).
- **Tables:** `flow_definitions` → `qc_checklist_name` / version; rows in `qc_checklists`.
- **Check types:** `required_keys`, `equals` (incl. carousel slide-count helpers), `min_length`, `max_length`, `regex`, `not_empty`; unknown types default non-blocking pass.
- **Pass:** no blocking failures and no CRITICAL risk finding from policies.
- **`qc_result`:** `buildQcResultPayload` — score, routes, reasons, blocking lists. Persisted via `mergeGenerationPayloadQc` in `src/domain/generation-payload-qc.ts` — the single write surface. A Zod `qcResultSchema` in the same module validates the shape before touching Postgres; `pickStoredQcResult` is the tolerant reader.
- **Routes:** may yield `BLOCKED`, `DISCARD`, `REWORK_REQUIRED`, `HUMAN_REVIEW`; `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC` maps clean passes away from `AUTO_PUBLISH` by default.
- **Separate from:** output-schema validation in `llm-generator.ts`. Rollout is controlled by `CAF_OUTPUT_SCHEMA_VALIDATION_MODE` (`skip` / `warn` / `enforce`); the legacy `CAF_SKIP_OUTPUT_SCHEMA_VALIDATION` flag is still honored as the fallback. In `warn` mode, validation failures are written to `generation_payload.schema_validation_warnings` instead of failing the generation, which lets staging measure impact before flipping to `enforce`.

---

## 9. Risk: policies vs project rules vs brand bans

| Source | Table / field | Used in `runQcForJob`? |
|--------|----------------|-------------------------|
| **Risk policies** | `caf_core.risk_policies` | **Yes** — `listRiskPoliciesForJob(db, flow_type)` returns rows where `applies_to_flow_type IS NULL OR = flow_type` (added in migration `024_risk_policies_scope.sql`). Keyword scan on JSON.stringify output + `riskDetectionTermMatches` |
| **Project risk rules** | `caf_core.risk_rules` | **No** in current `qc-runtime` — used for profile, CSV import, admin. `GET /v1/projects/:slug/risk-qc-status` surfaces this asymmetry honestly |
| **Brand bans** | `brand_constraints.banned_words` | **Yes** — merged into same scan as policies |

Planning-time routing uses `route_selector.ts` — different phase from QC `recommended_route`.

### Risk honesty surfaces

Every write path that touches **project risk rules** (`caf_core.risk_rules`) now returns (or warns with) the same `risk_qc` notice so operators cannot silently configure unenforced rules:

- `GET/POST/DELETE /v1/projects/:project_slug/project-risk-rules` (preferred) and the deprecated alias `.../risk-rules`, plus `POST /v1/admin/config/risk-rule[/delete]` → attach `risk_qc: riskRulesNotEnforcedNotice()` on the response.
- `importProjectFromCsv` → appends a `warnings[]` entry whenever `applied.risk_rule > 0`.
- `GET /v1/projects/:project_slug/risk-qc-status` → returns a compact payload for operators and admin UI (shape defined in `src/services/risk-qc-status.ts` via `buildRiskQcStatus`):

```json
{
  "ok": true,
  "project_slug": "...",
  "qc_uses": ["risk_policies", "brand_banned_words"],
  "project_risk_rules_count": 0,
  "risk_rules_enforced_by_qc": false,
  "has_unenforced_risk_rules": false,
  "message": "...",
  "docs_path": "docs/RISK_RULES.md"
}
```

---

## 10. Generation guidance & learning (two paths)

### Single facade

- **File:** `src/services/learning-rule-selection.ts` — the **only** place code looks up learning rules today. Two exports map the two mental models:
  - `getLearningRulesForPlanning(db, projectId)` — wraps `listActiveAppliedLearningRules`.
  - `getLearningContextForGeneration(db, projectId, flow, platform, opts)` — wraps `compileLearningContexts`.
- Call sites migrated: `src/decision_engine/index.ts`, `src/services/llm-generator.ts`, `src/routes/learning.ts` (context-preview). A static test in `src/services/learning-rule-selection.test.ts` asserts that none of them bypass the facade.

### A. Prompt injection (`getLearningContextForGeneration`)

- **Impl:** `src/services/learning-context-compiler.ts` → `compileLearningContexts`; reached via the facade.
- **Includes:** active rules where `rule_family === 'generation'` or action matches `GENERATION|GUIDANCE|HINT`; optional **pending** on editorial rework.
- **Scope:** `scope_flow_type` (wildcards), `scope_platform`.
- **Text:** from `action_payload`: `guidance`, `hint`, `text`, `message`, `summary`.
- **Injection:** template placeholders + system prompt appendix ("do not quote verbatim").
- **Caps:** `LLM_LEARNING_*` env vars.

### B. Planning-only rules (`getLearningRulesForPlanning`)

- **Impl:** `src/repositories/core.ts` → `listActiveAppliedLearningRules`; reached via the facade.
- **Includes:** `BOOST_RANK`, `SCORE_BOOST`, `SCORE_PENALTY` only; affects **which jobs are planned**, not prompt text (`ranking_rules.ts`).

### Other

- **Anti-repetition (carousel):** `buildLlmApprovalAntiRepetitionBlock` — `LLM_APPROVAL_ANTI_REPETITION_*`.
- **Rework:** reviewer notes + `editorial_overrides_json` in user prompt when `isEditorialRework`.
- **Attribution:** `caf_core.learning_generation_attribution`.

---

## 11. Flow typing & special flow types

- **`flow-kind.ts`:** `isCarouselFlow`, `isVideoFlow` (regex + product video).
- **`product-flow-types.ts`:** `FLOW_PRODUCT_*` video; `FLOW_IMG_*` image flows **not** wired to generation.
- **`offline-flow-types.ts`:** excluded from planning/pipeline (e.g. some reel/hook variation names).

---

## 12. HTTP API surface (index)

| Area | File |
|------|------|
| `/v1/decisions`, jobs, review queue, reviews | `src/routes/v1.ts` |
| `/v1/runs/...` | `src/routes/runs.ts` |
| `/v1/signal-packs/...` | `src/routes/signal-packs.ts` |
| `/v1/pipeline/...` | `src/routes/pipeline.ts` |
| `/v1/projects/...` | `src/routes/project-config.ts` |
| `/v1/flow-engine/...` | `src/routes/flow-engine.ts` |
| `/v1/learning/...` | `src/routes/learning.ts` |
| `/v1/publications/...` | `src/routes/publications.ts` |
| `/admin`, `/v1/admin/...` | `src/routes/admin.ts` |
| `/api/templates/...` | `src/routes/renderer-templates.ts` |

Examples: **`docs/API_REFERENCE.md`**. Quick start: **`README.md`**.

---

## 13. Persistence (`src/repositories`)

| Module | Role |
|--------|------|
| `core.ts` | Projects, constraints, planning learning rules, prompt versions |
| `jobs.ts` | `upsertContentJob`, run-scoped deletes |
| `runs.ts` | Run CRUD, status |
| `signal-packs.ts` | Packs |
| `flow-engine.ts` | Flow defs, prompts, schemas, QC checks, **listRiskPolicies** |
| `learning.ts`, `learning-evidence.ts` | Rules + attribution |
| `assets.ts`, `publications.ts`, `review-queue.ts`, `transitions.ts` | As named |
| `project-config.ts` | Strategy, brand, platform, allowed flows, HeyGen, **project risk rules** (`caf_core.risk_rules`) |
| `ops.ts` | Audits, reviews, metrics inserts |
| `db/queries.ts` | `q`, `qOne` |

---

## 14. Repository layout & companion services

| Path | Role |
|------|------|
| `src/server.ts` | API entry |
| `src/config.ts` | Env schema |
| `migrations/` | SQL |
| `apps/review/` | Next.js workbench |
| `services/renderer/` | Carousel PNGs |
| `services/video-assembly/` | ffmpeg services |
| `services/media-gateway/` | Combined gateway |

CLIs: `package.json` — `process-run`, `start-run:xlsx`, `migrate`, etc.

---

## 14.1 Observability

- **Structured pipeline log helper:** `src/services/pipeline-logger.ts` emits a single JSON line per event to stderr with `ts`, `level`, `stage`, `message`, and correlation fields (`project_id`, `run_id`, `task_id`, `job_id`, `flow_type`, `data`). Zero deps. Opt-in — existing `console.*` call sites still work; prefer the helper in new or touched code so a single job is easy to trace across generate → QC → render → review.
- **Swappable sink:** `setPipelineLogSink(fn)` is provided for tests (so asserting log output does not litter the Vitest stream).

## 15. Engineering invariants

1. **`task_id`** + **`project_id`** are the primary keys for joining jobs to drafts, assets, reviews, transitions.
2. Do not **double-submit HeyGen** when `render_state` already has `video_id` / `session_id`. The canonical check is **`hasActiveProviderSession(renderState)`** in `src/domain/content-job-render-state.ts`; use it instead of re-implementing the check.
3. **`generation_payload`** changes affect pipeline, Review, admin — coordinate schema drift. Use `mergeGenerationPayloadQc` (`src/domain/generation-payload-qc.ts`) to write QC results; it is the only sanctioned writer for that slice.
4. **Project risk rules** (`caf_core.risk_rules`) are not enforced by QC today; enforcement is **`risk_policies`** (now scoped by `applies_to_flow_type`) + **brand bans**. `GET /v1/projects/:slug/risk-qc-status` is the canonical "what does QC actually run here?" endpoint and must stay consistent with `qc-runtime.ts`.
5. **Learning lookups** go through `src/services/learning-rule-selection.ts`. Calling `listActiveAppliedLearningRules` or `compileLearningContexts` directly from a new feature is considered drift — extend the facade instead.
6. **Review app `/v1/` contract** is covered by `src/routes/review-contract.test.ts`. Renaming or removing a listed path requires updating that test deliberately.

---

## 16. Split documentation map

For smaller files to edit in isolation:

| Topic | File |
|-------|------|
| Overview | `docs/PROJECT_OVERVIEW.md` |
| Architecture (short) | `docs/ARCHITECTURE.md` |
| Lifecycle only | `docs/LIFECYCLE.md` |
| Stack only | `docs/TECH_STACK.md` |
| QC only | `docs/QUALITY_CHECKS.md` |
| Guidance only | `docs/GENERATION_GUIDANCE.md` |
| Risk only | `docs/RISK_RULES.md` |
| Per-layer pages | `docs/layers/*.md` |
| HTTP examples | `docs/API_REFERENCE.md` |
| Video / HeyGen details | `docs/VIDEO_FLOWS.md`, `docs/HEYGEN_API_V3.md` |
| AI agent onboarding | `AGENTS.md` |
| Domain IDs | `.cursor/rules/caf-domain-model.mdc` |

---

*Generated as a merged reference; when in doubt, trust the codebase and `migrations/` over this document.*
