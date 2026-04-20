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

## Post-approval LLM review — upstream recommendations

- **`src/services/approved-content-llm-review.ts`** scores approved jobs (multimodal) and now emits an **`upstream_recommendations`** array alongside scores/bullets.
- **Schema:** **`src/domain/upstream-recommendations.ts`** (`upstreamRecommendationSchema`, tolerant `parseUpstreamRecommendations`, `UPSTREAM_RECOMMENDATIONS_PROMPT_ADDENDUM` appended to the system prompt).
- **Targets:** `prompt_template | output_schema | flow_definition | project_brand | project_strategy | learning_guidance | qc_checklist | risk_policy | other` — each item is `{ target, change, rationale, field_or_check_id? }`.
- **Persistence:** stored as `jsonb` on **`caf_core.llm_approval_reviews.upstream_recommendations`** (migration **`025`**).
- **Audit trail:** every parsed item is also written as its own **`learning_observation`** with `source_type = "llm_upstream_recommendation"` so the list is queryable and reportable without parsing the blob.

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
