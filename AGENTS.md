# AGENTS.md — Guidance for AI coding assistants

This file helps **Cursor agents** (and humans) work safely and efficiently in **CAF Core**.

## Project identity

- **Repo:** CAF Core — Fastify + PostgreSQL backend for a **content automation pipeline** (signals → jobs → LLM → QC → render → review → publish → learning).
- **Source of truth:** Postgres schema **`caf_core`** + **`content_jobs`** rows, especially **`generation_payload`**.
- **Review app** (`apps/review`) is a **client** of Core APIs, not the authority for job state.

## Always read first

| Resource | Why |
|----------|-----|
| `.cursor/rules/caf-domain-model.mdc` | **ID conventions**, `task_id` joins, lifecycle states |
| `docs/ARCHITECTURE.md` | Layers, critical files, QC/learning split |
| `src/config.ts` | Env flags (Zod); defaults for validation, human review after QC, URLs |

## Invariants — do not break without explicit user approval

1. **`task_id`** is the primary execution key across **`job_drafts`**, **`assets`**, **`editorial_reviews`**, **`job_state_transitions`**, etc., scoped by **`project_id`**.
2. Prefer joins on **`(project_id, task_id)`** or **`(project_id, run_id)`** using **text IDs** as documented in **caf-domain-model**.
3. **`content_jobs.generation_payload`** is the main JSON contract; coordinate changes with pipeline, Review, and admin consumers. Use **`mergeGenerationPayloadQc`** (`src/domain/generation-payload-qc.ts`) to write the `qc_result` slice — it is the only sanctioned writer for that subset.
4. **HeyGen retry:** avoid double-submitting renders when **`render_state`** already holds **`video_id`** / **`session_id`**. Use **`hasActiveProviderSession`** from **`src/domain/content-job-render-state.ts`** — do not re-implement the check inline.
5. **Learning lookups go through the facade** at **`src/services/learning-rule-selection.ts`** — `getLearningRulesForPlanning` for planning, `getLearningContextForGeneration` for prompts. Do not import `listActiveAppliedLearningRules` or `compileLearningContexts` directly from new code.
6. **QC risk enforcement today:** `risk_policies` (scoped per `flow_type` via `applies_to_flow_type`) + `brand_constraints.banned_words`. Project `risk_rules` are **not** enforced by `qc-runtime.ts`; **`GET /v1/projects/:slug/risk-qc-status`** is the canonical honesty endpoint.
7. **Review app `/v1/` contract** is covered by **`src/routes/review-contract.test.ts`**. If you rename or remove a listed path, update that test in the same change.
8. **Typed payload readers** — prefer the helpers in **`src/domain/`** over ad-hoc casts:
   - `pickGeneratedOutput` / `hasGeneratedOutput` for `generation_payload.generated_output`
   - `pickRenderState` / `hasActiveProviderSession` / `isMidProviderPhase` for `render_state`
   - `pickStoredQcResult` / `mergeGenerationPayloadQc` for `qc_result`
9. **Structured logs**: when adding new pipeline logging, prefer **`logPipelineEvent(level, stage, message, { run_id, task_id, job_id, ... })`** from **`src/services/pipeline-logger.ts`** over `console.*`. Correlation fields are how we trace a single job across stages.
10. **Upstream recommendations** (`src/domain/upstream-recommendations.ts`) are the structured shape the post-approval LLM reviewer emits. Writers must use `parseUpstreamRecommendations` (tolerant) and persist via **`insertLlmApprovalReview`**; each parsed item is also logged as its own `learning_observation` — do not bypass either when extending the reviewer.
11. **Run context snapshot** (`src/services/run-context-snapshot.ts`) is the canonical record of "what we actually generated with" (prompt versions + brand/strategy slice + learning fingerprints). Persist via `setRunContextSnapshot`. Snapshot failures are logged but must never abort a run.

## Where to change behavior

| Goal | Start here |
|------|------------|
| Run planning, scoring, suppression | `src/decision_engine/`, `src/services/run-orchestrator.ts` |
| LLM prompts & creation pack | `src/services/llm-generator.ts`, `src/repositories/flow-engine.ts` |
| QC checks / risk keywords | `src/services/qc-runtime.ts`, checklist rows, scoped `risk_policies` via `listRiskPoliciesForJob` |
| Job lifecycle & render | `src/services/job-pipeline.ts` |
| Human review & rework | `src/routes/v1.ts`, `src/services/rework-orchestrator.ts` |
| Publications | `src/routes/publications.ts` |
| Learning APIs & compiled guidance | `src/routes/learning.ts`, facade at `src/services/learning-rule-selection.ts` |
| New HTTP routes | Register in **`src/server.ts`** (pattern: `register*Routes`) |

## Conventions

- **TypeScript ESM** — imports use `.js` extensions in source (Node ESM).
- **Tests:** Vitest — `npm test`; colocate `*.test.ts` under `src/`.
- **Migrations:** SQL in **`migrations/`**; applied via **`src/cli/migrate.ts`** / startup.
- **Avoid** drive-by refactors in files unrelated to the task; match existing style.

## Commands (from repo root)

```bash
npm run dev          # Core API (watch)
npm run migrate      # Apply DB migrations
npm test             # Vitest
npm run process-run -- <run_id|uuid> [--project SLUG]
```

Review app: `cd apps/review && npm run dev` (needs **`CAF_CORE_URL`**).

## Documentation map

| Doc | Audience |
|-----|----------|
| `README.md` | Quick start, API index, deploy |
| `docs/CAF_CORE_COMPLETE_GUIDE.md` | **Single-file** full project reference |
| `docs/PROJECT_OVERVIEW.md` | Stakeholders / onboarding |
| `docs/ARCHITECTURE.md` | Engineers |
| `docs/LIFECYCLE.md` | Run & job states |
| `docs/TECH_STACK.md` | Stack & services |
| `docs/layers/README.md` | Per-layer deep dives |
| `docs/QUALITY_CHECKS.md` | QC runtime |
| `docs/GENERATION_GUIDANCE.md` | Prompt guidance |
| `docs/RISK_RULES.md` | Risk policies vs project `risk_rules` |
| `docs/API_REFERENCE.md` | HTTP examples |

## Optional rules (Cursor)

- `scene-assembly-n8n-legacy.mdc` — when touching scene/n8n-legacy paths
- `caf-domain-model.mdc` — **alwaysApply**

If the user’s request conflicts with **domain invariants**, **ask** or **surface the tradeoff** before renaming IDs or changing status enums.
