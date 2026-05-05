# CAF Core Project Context — Updated 2026-05-05

Snapshot anchor:
- Date: 2026-05-05
- Repo: CAF-Core
- Branch: master
- Commit: 64c85a3d3a4fac6ac70bf6ccf896e2f22f0a2f1d

## Priority rules (canonicality)
1. Current code behavior is canonical.
2. Current migrations/schema are canonical.
3. Current tests are canonical for contract claims.
4. `.env.example` + `src/config.ts` define configuration truth.
5. Repo docs are useful but may be stale; when code and docs disagree, record the disagreement.
6. Mark anything not proven by code/migrations/tests/config as aspirational.

## System summary
CAF Core is a Fastify + Postgres backend providing:
- A multi-tenant project model (`caf_core.projects`) keyed by `slug`.
- Runs and signal packs stored in Postgres (`caf_core.runs`, `caf_core.signal_packs`) and a required materialization step that writes planner rows into `runs.candidates_json` before run start.
- Planning (decision engine) that creates `caf_core.content_jobs` rows keyed by `task_id` (primary execution key across downstream tables).
- A per-job pipeline surface for generation/QC/diagnostics (`/v1/pipeline/*`) plus run-level orchestration endpoints for start/process/render.
- A DB-backed review queue and decision endpoints (`/v1/review-queue*`) that persist human decisions and update job state.
- A publishing placements model (`/v1/publications/*`) with executor modes: external (default), dry-run, and in-core Meta Graph publishing.
- Learning APIs under `/v1/learning/*` that store evidence and learning rules, provide compiled generation context previews, and support editorial/performance analysis. Global learning is currently disabled.

## Entity hierarchy (canonical IDs)
Canonical joins are text-keyed, scoped by `project_id`:
- **Project**: `caf_core.projects.slug` (tenant key), `id` (UUID PK)
- **Run**: `caf_core.runs.run_id` (text, scoped by project), `id` (UUID PK)
- **Signal Pack**: `caf_core.signal_packs.id` (UUID PK), associated to `(project_id, run_id)` + attached to runs via `runs.signal_pack_id` (in later migrations)
- **Candidate / planner row**:
  - Persisted planner rows for orchestration live in **`runs.candidates_json`** (materialized from signal packs)
  - `caf_core.candidates` exists historically but is not the required run-start input path
- **Content Job** (central): `caf_core.content_jobs.task_id` (text execution key), scoped by `(project_id, task_id)`
- **Draft**: `caf_core.job_drafts` keyed by `draft_id` and joined by `(project_id, task_id)`
- **Asset**: `caf_core.assets` joined by `(project_id, task_id)`
- **Editorial Review**: `caf_core.editorial_reviews` joined by `(project_id, task_id)`; consumption marker for editorial analysis: `editorial_analysis_consumed_at` (migration 044)
- **Placement**: `caf_core.publication_placements` joined by `project_id` and `task_id` (migration 016+)
- **Learning**: `caf_core.learning_rules` + evidence tables (observations, insights, hypotheses, trials, performance metrics, LLM approval reviews)

## Database contracts (high-signal)
From `migrations/001_caf_core_schema.sql` and later migrations:
- `caf_core.content_jobs` contains key JSONB slices:
  - `generation_payload` (integration-critical, primary execution contract)
  - `render_state` (provider idempotency / session tracking)
  - `scene_bundle_state` (scene assembly state)
  - `review_snapshot` (mirrors latest validation output for downstream consumers)
- Lifecycle/audit tables:
  - `caf_core.job_state_transitions` (append-only)
  - `caf_core.diagnostic_audits`
  - `caf_core.auto_validation_results`
  - `caf_core.api_call_audit` (added in later migrations; used for HeyGen prompt visibility)
- Learning:
  - `caf_core.learning_rules` status lifecycle: `pending|active|superseded|rejected` (plus later migrations add `expired`/retirement semantics at API level)
- Editorial analysis:
  - `caf_core.editorial_reviews.editorial_analysis_consumed_at` marks which submitted decisions have been folded into analysis (migration 044)

## Configuration contract (what changes runtime)
Canonical config file: `src/config.ts` (Zod schema + defaults).

Key toggles:
- **DB migrations on startup**: `CAF_RUN_MIGRATIONS_ON_START` (default true)
- **API auth**: `CAF_CORE_REQUIRE_AUTH` + `CAF_CORE_API_TOKEN`
- **Publishing executor**: `CAF_PUBLISH_EXECUTOR = none|dry_run|meta` (default none)
- **Output schema validation**:
  - Preferred: `CAF_OUTPUT_SCHEMA_VALIDATION_MODE = skip|warn|enforce`
  - Legacy fallback: `CAF_SKIP_OUTPUT_SCHEMA_VALIDATION` (unset defaults to skip behavior)
- **QC routing**: `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC` (default true)
- **Renderer/video deps**: `RENDERER_BASE_URL`, `VIDEO_ASSEMBLY_BASE_URL` (+ render concurrency + timeouts)
- **Providers**: `OPENAI_API_KEY` (+ models), `HEYGEN_API_KEY` (+ burn subtitles pipeline), optional Supabase (`SUPABASE_*`)
- **Editorial analysis cron**: `EDITORIAL_ANALYSIS_CRON_ENABLED` etc. (default disabled)

## Stage-by-stage contracts (enforced format)

## Stage: Inputs / Signal Packs
Purpose:
Store a research bundle in Postgres and associate it with a run.

Trigger:
- Signal pack HTTP routes under `src/routes/signal-packs.ts` (registered in `src/server.ts`)
- CLI entrypoints exist (`npm run start-run:xlsx`) per `package.json` + repo README.

Inputs:
- `.xlsx` upload (multipart) or upstream-processed data (depending on chosen route/CLI)
- `project_slug`

Process:
- Parse and store pack data and summaries.

Outputs:
- Writes `caf_core.signal_packs` (and related “ideas json” tables/links in later migrations)

Canonical files:
- `src/routes/signal-packs.ts`

Failure modes:
- Invalid upload / parse errors
- Missing project or signal pack association

Observability:
- HTTP responses
- Postgres rows in `caf_core.signal_packs`

Do not confuse with:
- `runs.candidates_json` (planner rows) — that is a later explicit materialization stage.

## Stage: Run creation
Purpose:
Create a run container for planning/execution that references a specific signal pack.

Trigger:
- `POST /v1/runs/:project_slug` (`src/routes/runs.ts`)

Inputs:
- `signal_pack_id` (UUID; must exist for the project)
- Optional `run_id`, name (stored as `metadata_json.display_name`), `source_window`

Process:
- Validate signal pack ownership, create run row.

Outputs:
- Writes `caf_core.runs`

Canonical files:
- `src/routes/runs.ts`
- `src/repositories/runs.ts` (`createRun`, `patchRun`, `updateRunStatus`, etc.)

Failure modes:
- Signal pack not found for project
- Invalid UUIDs

Observability:
- Run row in Postgres

Do not confuse with:
- “Start run” which is orchestration/planning, not run creation.

## Stage: Candidate materialization (planner rows)
Purpose:
Convert run’s attached signal pack into a compact set of planner rows stored on the run.

Trigger:
- `POST /v1/runs/:project_slug/:run_id/candidates` (`src/routes/runs.ts`)

Inputs:
- Run must be `CREATED`
- Run must have `signal_pack_id`
- `mode`:
  - `manual` (idea ids)
  - `llm` (max_ideas)
  - `from_pack_ideas_all`
  - `from_pack_overall` (legacy)

Process:
- Read signal pack; produce planner rows and provenance
- Persist to run’s `candidates_json`

Outputs:
- Writes `runs.candidates_json` + provenance metadata

Canonical files:
- `src/routes/runs.ts`
- `src/services/run-candidates-materialize.ts` (`materializeRunCandidates`)

Failure modes:
- Run not in CREATED
- Missing signal_pack_id
- Pack not found

Observability:
- HTTP response includes `planner_rows` and provenance; run row updated

Do not confuse with:
- `caf_core.candidates` table (historical) — this stage uses run-local JSON.

## Stage: Planning (orchestrator → create jobs)
Purpose:
Use decision engine + constraints + enabled flows to create planned content jobs.

Trigger:
- `POST /v1/runs/:project_slug/:run_id/start` (`src/routes/runs.ts`) calling `startRun(...)`
- `POST /v1/runs/:project_slug/:run_id/replan` calling `replanRun(...)`

Inputs:
- Run row with candidates materialized
- Project constraints + allowed flow types + flow engine metadata

Process:
- Decision engine computes which candidates/flows become jobs
- Persist jobs as `content_jobs` with stable `task_id`

Outputs:
- Writes `caf_core.content_jobs`
- Writes run status updates

Canonical files:
- `src/services/run-orchestrator.ts`
- `src/decision_engine/**`

Failure modes:
- Missing candidates_json/materialization
- No enabled flow types
- Bad run status (e.g., still planning)

Observability:
- Run + content_jobs rows; logs

Do not confuse with:
- Pipeline generation/rendering; planning only creates jobs.

## Stage: Generation (LLM)
Purpose:
Produce execution-ready generated output and store it on the job payload/drafts.

Trigger:
- Per-job: `POST /v1/pipeline/:project_slug/:task_id/generate` (`src/routes/pipeline.ts`)
- Per-run async: `POST /v1/runs/:project_slug/:run_id/process` (`src/routes/runs.ts`) calling `generateRunDraftPackages(...)`

Inputs:
- `OPENAI_API_KEY`
- `content_jobs.generation_payload` + flow-engine prompt templates/output schema refs
- Generation-time learning context (facade)
- Schema validation mode (`CAF_OUTPUT_SCHEMA_VALIDATION_MODE` or legacy fallback)

Process:
- Call `generateForJob(...)`
- Optionally validate output schema (skip/warn/enforce)

Outputs:
- Writes to `job_drafts` and `content_jobs.generation_payload` (including `generated_output`)
- Updates job status to `GENERATED` in pipeline endpoints

Canonical files:
- `src/services/llm-generator.ts`
- `src/routes/pipeline.ts`
- `src/services/learning-rule-selection.ts` (generation context)

Failure modes:
- Missing `OPENAI_API_KEY`
- Invalid output schema (enforce mode)
- Provider/API errors

Observability:
- Job row status updates; logs

Do not confuse with:
- QC (post-generation runtime checks)

## Stage: Output schema validation
Purpose:
Validate generated output against Flow Engine output schemas.

Trigger:
- Inside generation service, controlled by `resolveOutputSchemaValidationMode(...)`.

Inputs:
- Generated output + output schema definitions

Process:
- Validate and either:
  - Skip
  - Warn and record warnings
  - Enforce and fail generation

Outputs:
- On warn: `generation_payload.schema_validation_warnings` (recorded)
- On enforce: generation failure (caller sets job status/response)

Canonical files:
- `src/config.ts` (mode resolution)
- `src/services/llm-generator.ts` (execution)

Failure modes:
- Schema definition mismatch
- Output does not match schema

Observability:
- Warnings or generation failure response/logs

Do not confuse with:
- QC, risk policies, brand bans

## Stage: QC
Purpose:
Automated post-generation checks over `generated_output`, producing QC status and routing recommendations.

Trigger:
- `POST /v1/pipeline/:project_slug/:task_id/qc` (or pipeline “full”)

Inputs:
- `content_jobs.generation_payload.generated_output`
- QC checklists + runtime risk policy inputs + brand banned words
- `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC`

Process:
- `runQcForJob(...)` computes `qc_passed`, `risk_level`, and `recommended_route`

Outputs:
- Writes QC result slices (QC status + recommended route + `qc_result` slice on generation_payload)

Canonical files:
- `src/services/qc-runtime.ts`
- `src/domain/generation-payload-qc.ts` (sanctioned qc_result writer per repo invariants)

Failure modes:
- Missing or malformed generated output
- Checklist/policy lookup failures (depending on implementation)

Observability:
- QC result persisted on job; pipeline route response

Do not confuse with:
- Output schema validation (separate stage)
- Project “risk_rules” (not necessarily enforced by QC runtime)

## Stage: Diagnostics
Purpose:
Store post-generation quality analysis for later learning and inspection.

Trigger:
- `POST /v1/pipeline/:project_slug/:task_id/diagnose` (or pipeline “full”)

Inputs:
- Generated output + job metadata

Process:
- Run diagnostic audit and persist

Outputs:
- Writes `caf_core.diagnostic_audits`

Canonical files:
- `src/services/diagnostic-runner.ts`

Failure modes:
- Missing generated output, DB write issues

Observability:
- Audit row persisted; pipeline response

Do not confuse with:
- QC (gates/recommends routing)

## Stage: Rendering
Purpose:
Turn generated output into concrete media assets (carousel images, video renders, scene assembly outputs).

Trigger:
- `POST /v1/runs/:project_slug/:run_id/render` (async background render for `GENERATED` jobs)
- `POST /v1/jobs/:project_slug/:task_id/process` (process one job through pipeline)
- `POST /v1/pipeline/:project_slug/task/:task_id/reprocess` (re-entry)

Inputs:
- `RENDERER_BASE_URL`, `VIDEO_ASSEMBLY_BASE_URL`
- Optional `SUPABASE_*`
- Optional `HEYGEN_*`, `OPENAI_*` for video/scene flows

Process:
- Dispatch to renderer/video assembly services over HTTP
- Use render_state helpers to avoid provider double-submits

Outputs:
- Writes `caf_core.assets`, `render_state` fields, and job status transitions

Canonical files:
- `src/services/job-pipeline.ts`
- `src/domain/content-job-render-state.ts`

Failure modes:
- Upstream renderer unavailable/timeouts
- Provider long polls/timeouts (HeyGen/Sora/video assembly)
- Storage upload failures

Observability:
- `/health/rendering` probe, logs, assets rows

Do not confuse with:
- “Generation” (LLM output) which does not necessarily create media assets.

## Stage: Review
Purpose:
Human approval/rejection/edit decisions over jobs and assets, persisted in Core.

Trigger:
- Review UI calls Core endpoints:
  - `GET /v1/review-queue*` list/detail
  - `POST /v1/review-queue/:project_slug/decide` or `/task/:task_id/decide`

Inputs:
- Review queue filters + per-job detail
- Decision body includes overrides and rework hints (including explicit `regenerate`)

Process:
- Persist editorial review row + mirror structured validation output
- Update `content_jobs.status` to `APPROVED|NEEDS_EDIT|REJECTED`
- Optionally patch copy-only approvals into generated_output without re-render

Outputs:
- Writes `caf_core.editorial_reviews`
- Updates `caf_core.content_jobs.status` and `review_snapshot`
- Inserts `caf_core.job_state_transitions`

Canonical files:
- `src/routes/v1.ts` (`executeEditorialReviewDecision`)

Failure modes:
- Task not found, validation errors, DB errors

Observability:
- Review rows + transitions + job snapshot

Do not confuse with:
- Publishing (placements/execution)

## Stage: Publishing
Purpose:
Represent intent to publish as placements, optionally execute in-core depending on config, and record outcomes.

Trigger:
- Create: `POST /v1/publications/:project_slug`
- Start: `POST /v1/publications/:project_slug/:id/start`
- Complete: `POST /v1/publications/:project_slug/:id/complete`

Inputs:
- Placement row (task_id, platform, media URL snapshots, schedule)
- Executor mode:
  - `CAF_PUBLISH_EXECUTOR=none|dry_run|meta`

Process:
- `start` claims placement (status→publishing) with guardrails (due time, allow flags)
- Execute:
  - `dry_run`: complete immediately with fake ids
  - `meta`: call Meta Graph and then complete
  - `none`: return external payload for worker to post

Outputs:
- Updates `publication_placements` status and result fields
- Best-effort append of publication result to the job row

Canonical files:
- `src/routes/publications.ts`
- `src/services/meta-graph-publish.ts`

Failure modes:
- Cannot start due to schedule/status, meta publish failure, external worker never completes

Observability:
- Placement row status and error fields; API responses

Do not confuse with:
- “Posted successfully” (depends on executor mode + completion)

## Stage: Learning
Purpose:
Store evidence and learning rules, run analyses, and provide compiled guidance used in planning/generation.

Trigger:
- Evidence CRUD: `/v1/learning/:project_slug/*`
- Editorial analysis: `POST /v1/learning/:project_slug/editorial-analysis`
- Performance ingest: JSON + CSV under `/v1/learning/:project_slug/performance/*`
- Approved content LLM review: `POST /v1/learning/:project_slug/llm-review-approved`
- Context preview: `GET /v1/learning/:project_slug/context-preview`

Inputs:
- Editorial reviews/notes, performance exports, approved content assets/copy
- `OPENAI_API_KEY` for LLM review and some analysis paths

Process:
- Persist evidence rows
- Mint learning rules (pending/active) based on analysis and operator actions

Outputs:
- Learning rules + evidence tables + performance metrics + llm approval reviews

Canonical files:
- `src/routes/learning.ts`
- `src/services/learning-rule-selection.ts` (generation/planning context facade)

Failure modes:
- Global scope operations rejected (global learning disabled)
- Missing OpenAI key for LLM review

Observability:
- Transparency endpoint: `/v1/learning/:project_slug/transparency`

Do not confuse with:
- QC (runtime enforcement) — learning guidance is prompt/planning influence, not a QC gate by itself.

## Canonical source of truth (by concern)
- HTTP surface registration: `src/server.ts`
- Environment contract + defaults: `src/config.ts` and `.env.example`
- DB schema truth: `migrations/*.sql`
- Run start/replan orchestration: `src/services/run-orchestrator.ts`
- Job pipeline (generation→qc→render orchestration): `src/services/job-pipeline.ts`
- Per-job pipeline endpoints: `src/routes/pipeline.ts`
- Review queue + decision persistence: `src/routes/v1.ts`
- Publishing placements + executor behavior: `src/routes/publications.ts` + `src/services/meta-graph-publish.ts`
- Learning rule selection facade: `src/services/learning-rule-selection.ts`

## Engineering invariants (must not break)
These are enforced by repo guidance and the current architecture:
1. `task_id` is the primary execution key across job drafts, assets, reviews, transitions, etc. scoped by `project_id`.
2. Prefer joins on `(project_id, task_id)` or `(project_id, run_id)` using text IDs.
3. `content_jobs.generation_payload` is an integration contract; coordinate changes. QC writes must go through `mergeGenerationPayloadQc(...)`.
4. Provider idempotency: don’t double-submit renders when `render_state` shows an active provider session; use `hasActiveProviderSession(...)`.
5. Learning lookups should go through the facade `src/services/learning-rule-selection.ts`.
6. Publishing placements represent intent; execution depends on `CAF_PUBLISH_EXECUTOR`.

## Known gaps / technical debt (repo-grounded signals)
- Dual pipeline modes (run-level async draft packages vs per-job “full” endpoint) can confuse operators and lifecycle diagrams unless explicitly documented.
- Legacy vs canonical flow identifiers coexist (`Flow_*` vs `FLOW_*`); task_id is not migrated by design.
- Output-schema validation is mid-rollout; without explicit env settings, many deployments will skip validation.
- Global learning is disabled, but some docs/expectations may still mention “caf-global” behavior.

## Do not assume
- Do not assume every registered flow_type is fully wired end-to-end (flow-engine + allowed_flow_types + render path must exist).
- Do not assume the `candidates` table is the planning source of truth; run start expects `runs.candidates_json`.
- Do not assume project `risk_rules` are enforced by QC unless `qc-runtime.ts` proves it.
- Do not assume QC equals output schema validation (different stages, knobs, and failure semantics).
- Do not assume a clean QC pass means auto-publish; default config routes to human review.
- Do not assume Review app owns state; Core/Postgres is the source of truth.
- Do not assume `generation_payload` can be changed casually; it is an integration contract.
- Do not assume HeyGen is safe to double-submit; provider session/idempotency must be checked via render_state helpers.
- Do not assume a publication placement implies a post exists; executor mode + `/complete` semantics matter.
