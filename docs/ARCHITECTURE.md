# CAF Core — Technical architecture

Engineering-focused view of **how the system is structured**, **where state lives**, and **which modules to open** when changing behavior.

## Stack

See **[TECH_STACK.md](./TECH_STACK.md)** for a fuller breakdown (companion services, deployment hints). Summary:

| Layer | Technology |
|--------|------------|
| API | Fastify 5 (`src/server.ts`), Zod on routes |
| Database | PostgreSQL, `pg`, schema **`caf_core`**, SQL migrations |
| LLM | OpenAI (chat + Videos API for Sora as configured) |
| Review UI | Next.js 14 (`apps/review`) |
| Carousel render | Separate Node service; Core serves `.hbs` templates |
| Video | HeyGen API, optional Sora clips, local **video-assembly** (ffmpeg) |
| Storage | Optional Supabase Storage for assets |

Environment is validated in **`src/config.ts`** (Zod).

## Layered view

One page per layer: **[layers/README.md](./layers/README.md)**.

| Layer | Responsibility | Primary locations |
|-------|----------------|-------------------|
| **HTTP** | Routes, auth hook | `src/routes/*.ts`, `src/server.ts` |
| **Orchestration** | Run start → plan → create jobs | `src/services/run-orchestrator.ts` |
| **Planning / decisions** | Score candidates, caps, suppression, traces | `src/decision_engine/` |
| **Execution** | Generate → QC → diagnose → render | `src/services/job-pipeline.ts` |
| **Generation** | Prompt resolution, OpenAI, drafts | `src/services/llm-generator.ts`, `llm-generator-helpers.ts` |
| **QC** | Checklists + risk policies + brand bans | `src/services/qc-runtime.ts` |
| **Rendering** | Carousel HTTP client, HeyGen, scene/Sora paths | `job-pipeline.ts`, `heygen-renderer.ts`, `scene-pipeline.ts`, … |
| **Review / rework** | Human decisions, orchestrated rework | `src/routes/v1.ts`, `src/services/rework-orchestrator.ts` |
| **Publishing** | Placements, optional Meta executor | `src/routes/publications.ts`, `src/repositories/publications.ts` |
| **Learning** | Rules, evidence, cron (optional) | `src/routes/learning.ts`, `src/services/learning-context-compiler.ts` |
| **Persistence** | SQL accessors | `src/repositories/` |

## Entity hierarchy (implementation)

| Level | Storage | Notes |
|-------|---------|------|
| **Project** | `caf_core.projects` | `slug` is the external key used in URLs |
| **Run** | `caf_core.runs` | Human-readable **`run_id`** + UUID **`id`**; links **`signal_pack_id`** |
| **Signal pack** | `caf_core.signal_packs` | **`overall_candidates_json`** drives planning |
| **Content job** | `caf_core.content_jobs` | Unique **`(project_id, task_id)`**; **`generation_payload`** is the integration hub |
| **Draft** | `caf_core.job_drafts` | Per LLM call |
| **Asset** | `caf_core.assets` | Render outputs |
| **Publication** | `caf_core.publication_placements` | Publish intent + outcome |

The schema also includes **`caf_core.candidates`**; run planning primarily consumes **signal pack JSON** built in memory in **`run-orchestrator.ts`** / decision engine. Do not assume every deployment fully syncs **`candidates`** rows.

## Lifecycle (abbreviated)

Full detail: **[LIFECYCLE.md](./LIFECYCLE.md)**.

1. **Start run** (`POST /v1/runs/:project_slug/:run_id/start`) → **`startRun`**: loads signal pack, optionally expands candidates, **`decideGenerationPlan`**, **`upsertContentJob`** for each selected row → run **`GENERATING`**.
2. **Process run** (`processRunJobs` in **`job-pipeline.ts`**) for each job: **`PLANNED`** → generation → **`runQcForJob`** → routing / diagnostic → carousel or video render → **`IN_REVIEW`** (human gate; QC does not auto-approve by default—see **`CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC`**).
3. **Review** updates **`content_jobs.status`** and **`editorial_reviews`** via **`v1`** routes.
4. **Publishing** mutates **`publication_placements`**; executor mode from **`CAF_PUBLISH_EXECUTOR`**.

## Critical integration contract

**`content_jobs.generation_payload`** holds:

- Planner inputs: **`signal_pack_id`**, **`candidate_data`**, **`prompt_*`**
- LLM output: **`generated_output`**
- QC snapshot: **`qc_result`**, **`recommended_route`** (also columns on the row)
- Render / video: provider-specific nested objects (HeyGen, scene bundle, URLs)

Treat changes here as **versioned API design**—multiple clients (pipeline, Review, admin) read the same blob.

The `qc_result` slice has a typed subset and canonical write path in **`src/domain/generation-payload-qc.ts`**:

- `qcResultSchema` (Zod) defines the persisted shape.
- `mergeGenerationPayloadQc(db, jobId, qc, opts)` is the only sanctioned writer — updates `qc_status`, merges `qc_result` into `generation_payload`, and sets `recommended_route` in one statement.
- `pickStoredQcResult` is the tolerant reader (falls back for pre-migration rows).

Two more slices follow the same pattern:

- **`generated_output`** — **`src/domain/generation-payload-output.ts`** (`pickGeneratedOutput`, `pickGeneratedOutputOrEmpty`, `hasGeneratedOutput`). Prefer these over the legacy `(x as Record<string, unknown>) ?? {}` pattern so arrays/primitives don't silently coerce to `{}`.
- **`render_state`** — **`src/domain/content-job-render-state.ts`** (`pickRenderState`, `hasActiveProviderSession`, `isMidProviderPhase`). `hasActiveProviderSession` is the **canonical HeyGen idempotency check** — use it everywhere instead of reading `video_id`/`session_id` inline.

## QC and risk

- **[QUALITY_CHECKS.md](./QUALITY_CHECKS.md)** — QC checklists, **`runQcForJob`**, **`qc_result`** payload (written via **`mergeGenerationPayloadQc`**).
- **[RISK_RULES.md](./RISK_RULES.md)** — **`risk_policies`** (now scoped per `flow_type` via migration **`024_risk_policies_scope.sql`** and **`listRiskPoliciesForJob`**) vs project **`risk_rules`** vs brand bans. The **`GET /v1/projects/:slug/risk-qc-status`** endpoint reports what QC actually enforces, courtesy of **`src/services/risk-qc-status.ts`**.
- Output-schema validation (separate from QC) is controlled by **`CAF_OUTPUT_SCHEMA_VALIDATION_MODE`** (`skip` / `warn` / `enforce`), resolved in **`src/config.ts`** and honored in **`llm-generator.ts`**.

## Audit trail — upstream recs & run snapshots

- **Post-approval LLM review** (`src/services/approved-content-llm-review.ts`) now returns structured **`upstream_recommendations`** next to scores. Schema + prompt addendum: **`src/domain/upstream-recommendations.ts`**. Persisted on **`caf_core.llm_approval_reviews.upstream_recommendations`** and fanned out per item into **`learning_observations`** (`source_type = "llm_upstream_recommendation"`) for queryable history.
- **Run context snapshot** (`src/services/run-context-snapshot.ts`) writes **`caf_core.runs.context_snapshot_json`** at end-of-planning — prompt versions per flow_type, project brand/strategy slices, and SHA-256 fingerprints of the compiled learning guidance per `(flow_type, platform)`. See migration **`025_upstream_recs_and_run_snapshot.sql`**.
- **Run Logs UI** — Review app route **`/runs`** (sidebar entry "Run Logs") lists every run with status, job progress, and indicators for whether prompt/context snapshots are present; links straight to **`/r/[run_id]`**.

## Learning (two paths, one facade)

Both paths are reached through **`src/services/learning-rule-selection.ts`** — the single sanctioned lookup point:

1. **Planning** — **`getLearningRulesForPlanning(db, projectId)`** wraps **`listActiveAppliedLearningRules`** (`src/repositories/core.ts`). **Active** rules with ranking-style **`action_type`** affect scoring in the decision engine.
2. **Generation** — **`getLearningContextForGeneration(db, projectId, flow, platform, opts)`** wraps **`compileLearningContexts`** (`src/services/learning-context-compiler.ts`). **Generation/guidance** text merged into prompts — see **[GENERATION_GUIDANCE.md](./GENERATION_GUIDANCE.md)**.

Rules must be **`active`** (and correctly **`rule_family`**) to affect the right stage. Do not import the repository / compiler functions directly from new feature code — extend the facade instead.

## Flow typing

**`src/decision_engine/flow-kind.ts`** classifies carousel vs video flows (regex + product flow helpers). **`src/domain/product-flow-types.ts`** defines **`FLOW_PRODUCT_*`** (video) and **`FLOW_IMG_*`** (image flows not fully wired). **`src/services/offline-flow-types.ts`** excludes certain flow names from the pipeline.

## Where not to look first

- **`src/routes/admin.ts`** — Large operator UI/API; search by endpoint.
- **`src/routes/v1.ts`** — Large integration surface; same.

## Related docs

- [CAF_CORE_COMPLETE_GUIDE.md](./CAF_CORE_COMPLETE_GUIDE.md) — merged single-file reference (overview + stack + layers + QC/risk/guidance)
- [PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md) — non-technical summary
- [LIFECYCLE.md](./LIFECYCLE.md) — run & job states
- [TECH_STACK.md](./TECH_STACK.md)
- [layers/README.md](./layers/README.md) — per-layer pages
- [QUALITY_CHECKS.md](./QUALITY_CHECKS.md), [GENERATION_GUIDANCE.md](./GENERATION_GUIDANCE.md), [RISK_RULES.md](./RISK_RULES.md)
- [API_REFERENCE.md](./API_REFERENCE.md)
- `README.md` — quick start, CLI, deploy
- `.cursor/rules/caf-domain-model.mdc` — ID conventions (always-on rule)
