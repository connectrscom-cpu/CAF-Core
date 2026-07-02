# Layer: Learning

**Purpose:** Store **rules**, **evidence**, and **operator-facing APIs** so future planning and generation can improve; optional **cron** synthesizes insights from editorial patterns.

## HTTP

- **`src/routes/learning.ts`** — rules CRUD, merge lists, evidence endpoints, performance CSV-style ingest, transparency helpers (large file; search by handler).

## Single lookup facade

- **`src/services/learning-rule-selection.ts`** — the only place code should look up learning rules. Two exports map the two mental models:
  - **`getLearningRulesForPlanning(db, projectId)`** — wraps `listActiveAppliedLearningRules`.
  - **`getLearningContextForGeneration(db, projectId, flow, platform, opts)`** — wraps `compileLearningContexts`.
- Call sites migrated: **`src/decision_engine/index.ts`**, **`src/services/llm-generator.ts`**, **`src/routes/learning.ts`** (context-preview). A static test (**`learning-rule-selection.test.ts`**) asserts these do not bypass the facade.

## Compilation for prompts

- **`src/services/learning-context-compiler.ts`** — **`compileLearningContexts`**; reached via **`getLearningContextForGeneration`** — see **[../GENERATION_GUIDANCE.md](../GENERATION_GUIDANCE.md)**.

## Planning integration

- **`listActiveAppliedLearningRules`** (**`src/repositories/core.ts`**); reached via **`getLearningRulesForPlanning`**. Used by **`decideGenerationPlan`** — only **ranking/suppression** action types.

## Evidence & global project

- **`migrations/010_learning_evidence_and_global.sql`** — **`caf-global`** project, observations, hypotheses, insights, **generation attribution**.
- **`src/repositories/learning-global.ts`** — **`getGlobalLearningProjectId`**.

Important (current wiring):
- Global learning rules are currently **disabled at the HTTP layer** (the learning routes reject global scope operations).
- Treat `caf-global` as a historical/schema concept unless code explicitly reintroduces global rule compilation and application.

## Post-approval LLM review — Nemotron VL + upstream recommendations

- **`src/services/approved-content-llm-review.ts`** scores approved jobs via **`generated-output-nemotron-analysis.ts`** (Nemotron VL on rendered assets + intended copy).
- **Config:** `APPROVAL_REVIEW_VISION_PROVIDER` (default `nvidia`), `APPROVAL_REVIEW_NVIDIA_MODEL`; requires `NVIDIA_NIM_API_KEY`.
- **TP-parity output:** `llm_approval_reviews.output_insights_json` (`slide_arc`, `slides[]`, `format_pattern`, `why_it_worked`, `mimic_evaluation`, …) — migration **`076`**.
- **Derived signals:** **`generated-output-learning-derive.ts`** maps insights → scores, bullets, `upstream_recommendations`.
- **Global observatory:** batch runs emit `caf-global` observations (`source_type = llm_review_global`) via **`global-learning-observe.ts`** — never touches planning/generation facades.
- **Schema:** **`src/domain/upstream-recommendations.ts`** (`parseUpstreamRecommendations`, targets list unchanged).
- **Audit trail:** parsed upstream items still log as `learning_observations` with `source_type = llm_upstream_recommendation`.

## Phase 0 — publish anchor, performance loop, dossier

- **`caf_core.job_outcomes`** (migration **`075`**) — publish anchor keyed by `(project_id, task_id)` with `tracking_status`: `published` → `metrics_present` → `analyzed`.
- **Publish hook:** **`src/routes/publications.ts`** → `upsertJobOutcomeOnPublish` after successful placement.
- **Metrics ingest:** **`performance-learning.ts`** marks `metrics_present` when CSV/JSON ingest includes `task_id`.
- **Manual performance analysis:** **`performance-learning-runner.ts`** via `POST /v1/learning/:slug/performance-analysis` (alias `market-analysis`). `auto_create_rules` defaults **false**; global observation emitted by default.
- **Global digest:** `POST /v1/learning/caf-global/digest`, `GET .../digest/latest` — **`global-learning-digest.ts`**.
- **Job dossier:** `GET /v1/jobs/:project_slug/:task_id/dossier` — **`build-job-dossier.ts`**; Review Task Review shows **Job journey** panel.

## Run-level generation context snapshot

- **`caf_core.runs.context_snapshot_json`** (migration **`025`**) stores a frozen snapshot captured at the end of planning: prompt versions per flow_type, project brand/strategy slices, and a SHA-256 fingerprint of the compiled learning guidance per `(flow_type, platform)`.
- **Builder:** **`src/services/run-context-snapshot.ts`** (`buildRunContextSnapshot`, `fingerprintGuidance`, `pickBrandSliceForSnapshot`, `pickStrategySliceForSnapshot`).
- **Write site:** **`src/services/run-orchestrator.ts` → `startRun`** persists the snapshot via `setRunContextSnapshot`; failures are logged via **`pipeline-logger.ts`** and never abort the run.
- **Why:** closes the "what did we actually use to generate this?" gap for reruns, forensic diffs, and evaluating whether upstream recommendations would have changed outcomes.

## Cron (optional)

- **`src/services/editorial-analysis-cron.ts`** — **`EDITORIAL_ANALYSIS_CRON_ENABLED`** and related env.
- **`editorial-learning.ts`**, **`market-learning.ts`** — pattern analysis (see imports in **`learning.ts`**).

## Inputs

- Reviews, metrics, manual rule inserts, editorial analysis outputs.

## Outputs

- **`caf_core.learning_rules`**, **`learning_observations`**, etc.; **attribution** rows on generation.

## Boundaries

- **Learning is not automatic quality** — rules must be **activated** and scoped; two paths (planning vs prompts) are easy to confuse — see **[../GENERATION_GUIDANCE.md](../GENERATION_GUIDANCE.md)** and **[decision-engine.md](./decision-engine.md)**.

## See also

- [../RISK_RULES.md](../RISK_RULES.md) (different concern — QC keywords)
- [persistence.md](./persistence.md)
