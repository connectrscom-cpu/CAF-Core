# CAF Core Canonical Architecture Map

Snapshot anchor:
- Date: 2026-05-05
- Repo: CAF-Core
- Branch: master
- Commit: 64c85a3d3a4fac6ac70bf6ccf896e2f22f0a2f1d

## 1. HTTP layer
Canonical files:
- `src/server.ts` (Fastify boot, route registration, auth hook, renderer-template public paths)
- `src/routes/*.ts` (route modules registered by `src/server.ts`)

Responsibilities:
- Expose stable HTTP surfaces for operators (admin), Review app, and external automation (n8n/other workers).
- Enforce optional API auth (`CAF_CORE_REQUIRE_AUTH` + `CAF_CORE_API_TOKEN`) with explicit public exceptions.

Inputs:
- HTTP requests
- `AppConfig` (`src/config.ts`) derived from `.env` / OS env
- Postgres pool (`src/db/pool.ts`)

Outputs:
- DB mutations through repositories/services
- Calls to external rendering/publishing/LLM services

Do not assume:
- Do not assume docs describe the full route surface; `src/server.ts` registration is the canonical list.
- Do not assume `/health` is readiness; `/readyz` is DB readiness.

## 2. Configuration & deployment contract
Canonical files:
- `src/config.ts` (Zod env schema, defaults, feature flags)
- `.env.example` (operator-facing variable explanations)
- `package.json` scripts (CLI entrypoints and operational workflows)

Responsibilities:
- Define the *real* configuration knobs that change runtime behavior:
  - publish executor mode, output-schema validation mode, QC routing mode, renderer/video service URLs, concurrency, provider keys, etc.

Inputs:
- Environment variables

Outputs:
- `AppConfig` used across services/routes

Do not assume:
- Do not assume output-schema validation is a single boolean; it is tri-state (`skip|warn|enforce`) with a legacy fallback flag.

## 3. Persistence layer (Postgres)
Canonical files:
- `migrations/*.sql` (schema)
- `src/db/queries.ts` (query helpers used by routes/services)
- `src/repositories/*.ts` (table access patterns)

Responsibilities:
- Store canonical truth for runs/jobs/reviews/assets/placements/learning.
- Provide stable text-key joins (commonly `(project_id, task_id)` and `(project_id, run_id)`).

Key canonical tables (non-exhaustive; see migrations for full list):
- `caf_core.projects`
- `caf_core.runs` (later migrations add `signal_pack_id`, status fields, etc.)
- `caf_core.signal_packs` (later migrations add richer `ideas_json` variants)
- `caf_core.content_jobs` (central; `generation_payload` JSONB is integration-critical)
- `caf_core.job_drafts`
- `caf_core.assets`
- `caf_core.editorial_reviews` (later migration 044 adds `editorial_analysis_consumed_at`)
- `caf_core.job_state_transitions`
- `caf_core.publication_placements` (added in later migrations)
- `caf_core.learning_rules` + learning evidence tables

Do not assume:
- Do not assume the `candidates` table is planning source-of-truth; `runs.candidates_json` is explicitly materialized and required before run start.

## 4. Run orchestration
Canonical files:
- `src/routes/runs.ts` (HTTP triggers)
- `src/services/run-orchestrator.ts` (run start/replan orchestration)
- `src/services/run-candidates-materialize.ts` (materialize `runs.candidates_json`)

Responsibilities:
- Manage run lifecycle, including resetting for replan and dispatching job creation.
- Enforce prerequisites (signal pack attachment, candidates materialization) at HTTP boundary.

Inputs:
- `runs` row + attached `signal_packs` row
- Project constraints + allowed flow types

Outputs:
- Planned jobs as `content_jobs` rows (keyed by `task_id`)
- Run status updates

Do not assume:
- Do not assume the orchestrator reads signal packs directly for planning; routes explicitly require candidates materialization first.

## 5. Decision engine
Canonical files:
- `src/decision_engine/**` (scoring, caps, routing, prompt selection)
- `/v1/decisions/plan` handler in `src/routes/v1.ts` calling `decideGenerationPlan(...)`

Responsibilities:
- Convert planner rows into a plan of content jobs (scoring + caps + route selection).

Inputs:
- Candidate/planner rows (materialized on run)
- Constraints (project + defaults)
- Learning rules (planning-time selection through services facade)

Outputs:
- Decision plan result + persisted traces (where enabled)

Do not assume:
- Do not assume all flow types are equally wired; allowed flows and per-flow definitions drive what is actually executable.

## 6. Generation (LLM)
Canonical files:
- `src/services/llm-generator.ts` (job generation service used by pipeline routes)
- `src/routes/pipeline.ts` (HTTP triggers for generation)
- `src/services/learning-rule-selection.ts` (generation-time learning context facade)

Responsibilities:
- Prompt selection + model call + writing generated output to `generation_payload` and/or drafts.
- Optional output-schema validation (rollout modes).

Inputs:
- `content_jobs.generation_payload` + flow-engine prompt templates/output schemas
- Learning context (compiled guidance)
- `OPENAI_API_KEY`

Outputs:
- `job_drafts` rows, `generation_payload.generated_output`, and status updates (`GENERATED`)

Do not assume:
- Do not assume schema validation is QC; QC is a separate stage.

## 7. Output schema validation (Flow Engine output_schemas)
Canonical files:
- Mode resolution: `src/config.ts` (`resolveOutputSchemaValidationMode`)
- Execution path: `src/services/llm-generator.ts`

Responsibilities:
- Validate generated output shape against Flow Engine `output_schemas`.

Inputs:
- Generated output + schema definitions (DB/flow-engine tables)

Outputs:
- `warn`: records warnings on `generation_payload.schema_validation_warnings`
- `enforce`: fails generation on invalid output

Do not assume:
- Do not assume “unset flag means validate”; legacy default is effectively “skip” unless tri-state is set.

## 8. QC + Risk
Canonical files:
- `src/services/qc-runtime.ts` (`runQcForJob`)
- `src/routes/pipeline.ts` (HTTP triggers)

Responsibilities:
- Post-generation validation and risk checks; compute routing recommendations.

Inputs:
- `generation_payload.generated_output`
- QC checklists + runtime-enforced risk policy sources + brand banned words
- `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC`

Outputs:
- Writes QC result slices and routing decisions (QC status + recommended route)
- Pipeline “full” endpoint uses QC result to set job status to `IN_REVIEW|QC_FAILED|BLOCKED`

Do not assume:
- Do not assume project “risk_rules” are enforced by QC; code must prove runtime reads them (honesty endpoint exists per repo guidance).

## 9. Diagnostics
Canonical files:
- `src/services/diagnostic-runner.ts`
- `src/routes/pipeline.ts` (HTTP trigger)

Responsibilities:
- Post-generation diagnostic audits written into DB for later analysis/learning.

Inputs:
- Generated output and job metadata

Outputs:
- `diagnostic_audits` rows

Do not assume:
- Do not assume diagnostics gate publishing; they are stored for review/learning unless wired into routing elsewhere.

## 10. Rendering & video flows
Canonical files:
- `src/services/job-pipeline.ts` (central orchestrator for per-job processing and render dispatch)
- `src/domain/content-job-render-state.ts` (render_state helpers; provider session/idempotency checks)
- `src/routes/runs.ts` (`/render` background job runner)
- External services:
  - `services/renderer/**` (Puppeteer renderer)
  - `services/video-assembly/**` (ffmpeg assembly)
  - `services/media-gateway/**` (proxy/co-host of the above)

Responsibilities:
- Convert generated output into renderable media; store assets and render state; ensure provider idempotency.

Inputs:
- `RENDERER_BASE_URL`, `VIDEO_ASSEMBLY_BASE_URL`, provider keys (HeyGen/OpenAI)
- Optional `SUPABASE_*` for storage and signed URLs

Outputs:
- `assets` rows and URLs
- `render_state`/job status transitions

Do not assume:
- Do not assume retries are safe; idempotency must check active provider sessions before re-submit.
- Do not assume renderer/video assembly live inside Core; they are HTTP dependencies.

## 11. Review (human + rework)
Canonical files:
- Core endpoints: `src/routes/v1.ts` (review queue + decision)
- Rework orchestration: `src/services/rework-orchestrator.ts` (invoked by pipeline rework endpoint)
- Review app: `apps/review/**` (client)

Responsibilities:
- Present DB-backed jobs to reviewers and persist decisions back to Core.
- Optionally patch generated output without re-render (copy-only approval path).

Inputs:
- Review queue queries (filters/facets) and per-task detail.

Outputs:
- `editorial_reviews` + job status updates + `job_state_transitions`
- `review_snapshot` mirror on the job row

Do not assume:
- Do not assume Review UI owns truth; Core/Postgres is authoritative.

## 12. Publishing
Canonical files:
- `src/routes/publications.ts`
- `src/repositories/publications.ts`
- Executors:
  - `src/services/publish-executors/dry-run.ts`
  - `src/services/meta-graph-publish.ts`

Responsibilities:
- Model “intent to publish” as placements; optionally execute publishing in-process depending on executor mode.

Inputs:
- Placement row + project integration credentials + executor config (`CAF_PUBLISH_EXECUTOR`)

Outputs:
- Placement lifecycle transitions + job publication result append (best-effort)

Do not assume:
- Do not assume a placement row implies a post exists; in `executor=none` publishing is external.

## 13. Learning
Canonical files:
- Routes: `src/routes/learning.ts`
- Facade: `src/services/learning-rule-selection.ts` (planning vs generation context)
- Evidence + analysis:
  - `src/services/editorial-learning.ts`
  - `src/services/performance-learning.ts`
  - `src/services/approved-content-llm-review.ts`

Responsibilities:
- Store learning evidence, manage learning rules lifecycle, and provide compiled guidance used in planning/generation.

Inputs:
- Editorial reviews/notes, performance metrics (JSON + CSV), approved content (LLM review), operator hints

Outputs:
- Learning rules + evidence rows; compiled generation guidance text

Do not assume:
- Do not assume global rules are active; routes explicitly state global learning is disabled.

