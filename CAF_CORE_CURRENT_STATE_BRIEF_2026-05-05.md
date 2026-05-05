# CAF Core Current State Brief

Snapshot anchor:
- Date: 2026-05-05
- Repo: CAF-Core
- Branch: master
- Commit: 64c85a3d3a4fac6ac70bf6ccf896e2f22f0a2f1d

## What CAF Core is now
CAF Core is a **Fastify + Postgres** backend that acts as the **operational system-of-record** for a content automation pipeline: **signals → run → plan → content_jobs → LLM generation → QC/diagnostics → rendering → review → publishing placements → learning evidence/rules**. Its canonical persisted unit is a `caf_core.content_jobs` row keyed by `(project_id, task_id)`, with integration-critical JSON stored primarily under `content_jobs.generation_payload`.

CAF Core also ships:
- A DB-backed **review queue + decision endpoints** under `/v1/*` (Core persists review decisions; the Review app is a client).
- A DB-backed **publications placement** model under `/v1/publications/:project_slug/*` with executor modes (`none | dry_run | meta`).
- A DB-backed **learning store + analysis routes** under `/v1/learning/*`, including a “compiled context preview” endpoint for generation guidance debugging.
- Companion services in-repo (`services/renderer`, `services/video-assembly`, `services/media-gateway`) that Core calls over HTTP for rendering and assembly; Core itself is not the renderer/video worker.

## What is fully wired
- **HTTP server + auth gating**: `src/server.ts` registers all route modules and optionally requires `x-caf-core-token`/Bearer for non-public paths (public exceptions include `/health`, `/health/rendering`, `/robots.txt`, and public renderer-template GET paths).
- **DB migrations on startup**: enabled by default via `CAF_RUN_MIGRATIONS_ON_START` (true unless explicitly disabled).
- **Runs**: create/list/patch/cancel/delete, start/replan, process, render — `src/routes/runs.ts`.
  - Candidate materialization is a first-class step: `POST /v1/runs/:project_slug/:run_id/candidates` writes `runs.candidates_json` from the run’s attached signal pack.
- **Per-job pipeline HTTP endpoints**: `src/routes/pipeline.ts`
  - Generate: `POST /v1/pipeline/:project_slug/:task_id/generate` (writes status `GENERATED` on success)
  - QC: `POST /v1/pipeline/:project_slug/:task_id/qc`
  - Diagnostic: `POST /v1/pipeline/:project_slug/:task_id/diagnose`
  - “Full” (generate→qc→diagnose→status): `POST /v1/pipeline/:project_slug/:task_id/full`
  - Reprocess / rework: `POST /v1/pipeline/:project_slug/task/:task_id/reprocess` and `/rework` (rework is async/202)
- **Review queue + editorial decisions**: `src/routes/v1.ts`
  - DB-backed queues for one project or all projects (`/v1/review-queue*`)
  - Decision endpoint(s) that persist `editorial_reviews` + update job status to `APPROVED|NEEDS_EDIT|REJECTED` and write a `job_state_transitions` row.
  - “Copy-only bypass” exists: approving with `regenerate=false` patches `generation_payload.generated_output` without re-rendering/re-generating.
- **Publishing placements**: `src/routes/publications.ts`
  - Placement CRUD + `start` + `complete`.
  - Executor mode is controlled by `CAF_PUBLISH_EXECUTOR`:
    - `none` (default): returns payload; external worker posts then calls `/complete`.
    - `dry_run`: Core completes immediately with fake IDs.
    - `meta`: Core calls Meta Graph using `project_integrations` + env token overrides.
- **Learning**: `src/routes/learning.ts`
  - Learning rules lifecycle (apply/retire/erase).
  - Evidence objects (observations, hypotheses, trials, insights).
  - Editorial analysis route (Loop B) and performance ingest + analysis (Loop C).
  - Compiled learning context preview for generation via `getLearningContextForGeneration(...)`.
  - Global learning rules are intentionally disabled (routes enforce project scope; calls referencing “global” return 400).
- **Rendering dependency probe**: `/health/rendering` exposes configured upstream renderer/video assembly URLs and probes their health.
- **Editorial analysis cron**: can run inside the API process when enabled by env (off by default).

## What is partially wired
- **End-to-end “run processing” is split into phases** in practice:
  - `/start-and-process` and `/process` asynchronously generate **DraftPackages** and stop jobs at **`GENERATED`** (“Package ready”), explicitly leaving rendering to a separate manual step (`/render`) in `src/routes/runs.ts`.
  - There is also a pipeline “full” endpoint for a single job which does generation+qc+diagnostic and then sets final status (`IN_REVIEW`, `QC_FAILED`, or `BLOCKED`). This coexists with the run-level processing/render split.
- **Output-schema validation** exists but is in a rollout state:
  - Legacy binary `CAF_SKIP_OUTPUT_SCHEMA_VALIDATION` (historical default = skip).
  - Preferred tri-state `CAF_OUTPUT_SCHEMA_VALIDATION_MODE = skip|warn|enforce`, with `warn` recording warnings instead of failing generation.
- **Auto-publish route recommendation** is intentionally constrained by default:
  - `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC` defaults to true, so QC will prefer human review routing even on pass unless explicitly disabled.
- **Scene / video flows** are present and heavily parameterized by env (Sora/OpenAI videos, HeyGen, scene assembly), but actual wiring depends on per-project DB configuration (flow definitions, prompt templates, heygen_config, allowed_flow_types, etc.) and external services.

## What is not actually enforced / not yet real
- **Global learning rule application** is disabled “for now” in the learning routes (explicit error text); any “global merged rules” behavior in docs should be treated as not active unless code elsewhere reintroduces it.
- **“Publish happened” is not implied by placement existence**:
  - A placement row represents intent/scheduling and later result reporting. In `CAF_PUBLISH_EXECUTOR=none`, Core does not post; an external executor must call `/complete`.

## Current end-to-end content path (repo-grounded)
This is the runtime path that exists today, based on registered routes and their invoked services.

### Stage: Inputs / Signal Packs
- Trigger:
  - `POST /v1/signal-packs/*` (signal pack routes are registered; ingestion also exists via CLI `npm run start-run:xlsx` per `package.json` + README).
- Inputs:
  - `.xlsx` (multipart) or pre-existing processing rows (depending on chosen route/CLI).
- Outputs (DB writes):
  - `caf_core.signal_packs` row(s); run linkage via run id / foreign associations in later migrations.
- Canonical:
  - Route module: `src/routes/signal-packs.ts` (registered in `src/server.ts`)

### Stage: Run creation
- Trigger:
  - `POST /v1/runs/:project_slug` (manual run creation requiring `signal_pack_id`), or CLI that creates run+pack.
- Writes:
  - `caf_core.runs` row with `signal_pack_id` (added by later migrations).
- Canonical:
  - `src/routes/runs.ts` → `createRun(...)` in `src/repositories/runs.ts`

### Stage: Candidate materialization (run → planner rows)
- Trigger:
  - `POST /v1/runs/:project_slug/:run_id/candidates` with a mode:
    - `manual` (idea ids),
    - `llm` (max ideas),
    - `from_pack_ideas_all`,
    - `from_pack_overall` (legacy).
- Inputs:
  - Run must be `CREATED` and have `signal_pack_id`.
  - Signal pack must belong to the same project.
- Writes:
  - `runs.candidates_json` + provenance metadata (via `materializeRunCandidates`).
- Canonical:
  - `src/routes/runs.ts` → `materializeRunCandidates(...)` in `src/services/run-candidates-materialize.ts`
- Do not confuse with:
  - `caf_core.candidates` table exists historically, but run orchestration now relies on `runs.candidates_json` as the planner row store for the run start path.

### Stage: Planning / orchestration (create content_jobs)
- Trigger:
  - `POST /v1/runs/:project_slug/:run_id/start` or `/replan`
- Inputs:
  - Run record (must have candidates materialized) + project config/constraints + allowed_flow_types.
- Outputs:
  - Planned jobs written as `caf_core.content_jobs` rows (keyed by `task_id`).
- Canonical:
  - `src/services/run-orchestrator.ts` (invoked by `src/routes/runs.ts`)

### Stage: Generation (LLM)
- Trigger:
  - Per-job: `POST /v1/pipeline/:project_slug/:task_id/generate`
  - Per-run: `POST /v1/runs/:project_slug/:run_id/process` (async “draft packages”)
  - Per-job pipeline full: `POST /v1/pipeline/:project_slug/:task_id/full`
- Inputs:
  - `content_jobs.generation_payload` + flow-engine prompt definitions + learning context (generation-time).
  - Requires `OPENAI_API_KEY`.
- Outputs (writes):
  - Job draft artifacts in DB (job drafts) and merged `generation_payload.generated_output` (plus other slices).
  - Status: `GENERATED` on success in pipeline endpoints.
- Canonical:
  - `src/services/llm-generator.ts` called by `src/routes/pipeline.ts`
  - Run-level draft package generation uses functions in `src/services/job-pipeline.ts`

### Stage: Output schema validation (Flow Engine output_schemas)
- Trigger:
  - During generation (controlled by `CAF_OUTPUT_SCHEMA_VALIDATION_MODE` / legacy flag).
- Inputs:
  - Output schema referenced by flow-engine definitions.
- Outputs:
  - `warn` mode records warnings under `generation_payload.schema_validation_warnings` (and does not fail).
  - `enforce` fails generation on invalid output.
- Canonical:
  - Configuration: `src/config.ts` (`resolveOutputSchemaValidationMode`)
  - Execution: `src/services/llm-generator.ts` (invoked by pipeline routes)
- Do not confuse with:
  - QC (post-generation checks) — separate stage.

### Stage: QC (post-generation validation + risk)
- Trigger:
  - `POST /v1/pipeline/:project_slug/:task_id/qc` or the “full” pipeline endpoint.
- Inputs:
  - `content_jobs.generation_payload.generated_output`
  - QC checklists + risk policies + brand banned words (runtime enforcement)
  - `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC` affects `recommended_route` behavior.
- Outputs:
  - Writes QC results and routing decisions (QC status + recommended route + qc_result slice).
  - Pipeline “full” endpoint sets job status to `IN_REVIEW` (pass), `QC_FAILED` (fail), or `BLOCKED` (route).
- Canonical:
  - `src/services/qc-runtime.ts` via `runQcForJob(...)`

### Stage: Diagnostics (post-generation)
- Trigger:
  - `POST /v1/pipeline/:project_slug/:task_id/diagnose` or pipeline “full”.
- Writes:
  - `caf_core.diagnostic_audits` rows.
- Canonical:
  - `src/services/diagnostic-runner.ts` (invoked from `src/routes/pipeline.ts`)

### Stage: Rendering
- Trigger:
  - Per-run: `POST /v1/runs/:project_slug/:run_id/render` (async background)
  - Per-job: `POST /v1/jobs/:project_slug/:task_id/process` (calls job pipeline)
  - Reprocess/rework endpoints can also re-enter render paths depending on mode.
- Inputs:
  - Generated output + render configuration and upstream services:
    - `RENDERER_BASE_URL` (Puppeteer renderer / media-gateway)
    - `VIDEO_ASSEMBLY_BASE_URL` (video worker / media-gateway)
    - Optional: `SUPABASE_*` for asset storage
    - Optional: `HEYGEN_*` for HeyGen video generation
- Outputs:
  - `caf_core.assets` rows and URLs (often Supabase signed URLs for UI and platform fetchers).
- Canonical:
  - `src/services/job-pipeline.ts` (central) + `src/domain/content-job-render-state.ts` for idempotency checks

### Stage: Review (human)
- Trigger:
  - Review app (Next.js) calls Core review queue endpoints; decision submission hits:
    - `POST /v1/review-queue/:project_slug/decide` (preferred for long task ids)
    - or `/task/:task_id/decide`
- Writes:
  - `caf_core.editorial_reviews` (submitted) + `content_jobs.status` update + `job_state_transitions` insert.
  - `content_jobs.review_snapshot` mirrors latest structured validation output for downstream.
- Canonical:
  - `src/routes/v1.ts` → `executeEditorialReviewDecision(...)`

### Stage: Publishing (placements)
- Trigger:
  - Create placement: `POST /v1/publications/:project_slug`
  - Start placement: `POST /v1/publications/:project_slug/:id/start`
  - Complete placement: `POST /v1/publications/:project_slug/:id/complete`
- Outputs:
  - Placement row status changes: `draft|scheduled|publishing|published|failed|cancelled`
  - On success, Core appends a publication result into the job row (best-effort).
- Canonical:
  - `src/routes/publications.ts` and `src/repositories/publications.ts`

### Stage: Learning
- Trigger:
  - Learning CRUD and analysis routes under `/v1/learning/*`
  - Editorial analysis (Loop B): `POST /v1/learning/:project_slug/editorial-analysis`
  - Performance ingest/analysis (Loop C): `POST /v1/learning/:project_slug/performance/*`
  - Approved-content LLM review: `POST /v1/learning/:project_slug/llm-review-approved`
- Writes:
  - Learning rules (`caf_core.learning_rules`), evidence tables, performance metrics, llm_approval_reviews, etc.
- Canonical:
  - API: `src/routes/learning.ts`
  - Generation-time lookup: `src/services/learning-rule-selection.ts` (facade)

## Current operator surfaces
- **HTTP**:
  - `/health`, `/readyz`, `/health/rendering`
  - `/v1/*` (run, pipeline, review queue, publishing placements, learning)
  - `/admin` (Core operator HTML) + admin JSON endpoints (`src/routes/admin.ts`)
- **CLI** (via `package.json` scripts):
  - `npm run migrate`, `npm run start-run:xlsx`, `npm run process-run`, `npm run replan-run`, `npm run seed:*`
- **Review UI**:
  - Next.js workbench in `apps/review` (consumes Core APIs, does not own truth)

## Current integration boundaries
- **Core ↔ Postgres**: Core is the writer and authoritative state store.
- **Review app ↔ Core**: client UI; writes decisions via Core endpoints.
- **Core ↔ Renderer / video assembly**: Core calls external HTTP services defined by `RENDERER_BASE_URL` / `VIDEO_ASSEMBLY_BASE_URL`.
- **Core ↔ Supabase Storage**: optional but common for assets; Core signs URLs for UI/platform fetchers where needed.
- **Core ↔ OpenAI**: required for generation; optional for Sora video and approval reviews; TTS used for scene pipelines.
- **Core ↔ HeyGen**: optional; video flows depend on HeyGen key + project config; subtitle burn-in uses video-assembly.
- **Core ↔ Meta Graph**: optional executor path for publishing placements when `CAF_PUBLISH_EXECUTOR=meta`.

## Current risks
- **Contract risk (`generation_payload`)**: it is a cross-system JSON contract (pipeline, review UI, renderers, publishers). Changes must be coordinated.
- **Misinterpretation risk (QC vs schema validation vs risk)**:
  - Output schema validation is a generation-time structural check; QC is post-generation policy/quality checks; “risk_rules” in project tables are not necessarily runtime enforced unless the QC runtime uses them.
- **Idempotency risk (video providers)**: render retries must respect `render_state` provider session state (avoid double submit).
- **Operational split-brain risk (publish placements)**: placements can represent intent only; in `executor=none` they do not imply actual posting occurred.
