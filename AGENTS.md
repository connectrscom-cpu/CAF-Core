# AGENTS.md — Guidance for AI coding assistants

This file helps **Cursor agents** (and humans) work safely and efficiently in **CAF Core**.

## Project identity

- **Repo:** CAF Core — Fastify + PostgreSQL backend for a **content automation pipeline** (signals → jobs → LLM → QC → render → review → publish → learning).
- **Source of truth:** Postgres schema **`caf_core`** + **`content_jobs`** rows, especially **`generation_payload`**.
- **Review app** (`apps/review`) is a **client** of Core APIs, not the authority for job state.

## Always read first

| Resource | Why |
|----------|-----|
| `docs/CAF_CURRENT_STATE_CONTEXT_PACK.md` | **Repo-derived current state** — start here when context may be stale (BVS, new visual, Why Mimic) |
| `docs/EXTERNAL_CONTEXT_PACK.md` | **Tiered doc bundle** for ChatGPT / other repos / rebuilds |
| `docs/DOMAIN_MODEL.md` | **ID conventions**, `task_id` joins, lifecycle states (external copy) |
| `.cursor/rules/caf-domain-model.mdc` | Same domain rules (Cursor always-on) |
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
   - `pickMimicPayload` for `generation_payload.mimic_v1`
   - `parseBvsV1` / `attachBvsToPlannedPayload` for `generation_payload.bvs_v1`
   - `pickMimicCarouselDraftPackage` for `mimic_carousel_package` (TP-grounded carousel flows only)
9. **Structured logs**: when adding new pipeline logging, prefer **`logPipelineEvent(level, stage, message, { run_id, task_id, job_id, ... })`** from **`src/services/pipeline-logger.ts`** over `console.*`. Correlation fields are how we trace a single job across stages.
10. **Upstream recommendations** (`src/domain/upstream-recommendations.ts`) are the structured shape the post-approval LLM reviewer emits. Writers must use `parseUpstreamRecommendations` (tolerant) and persist via **`insertLlmApprovalReview`**; each parsed item is also logged as its own `learning_observation` — do not bypass either when extending the reviewer.
11. **Run context snapshot** (`src/services/run-context-snapshot.ts`) is the canonical record of "what we actually generated with" (prompt versions + brand/strategy slice + learning fingerprints). Persist via `setRunContextSnapshot`. Snapshot failures are logged but must never abort a run.
12. **Mimic carousel package** — `mimic_carousel_package` is for **TP-grounded carousel render flows** (`isTpGroundedCarouselRenderFlow()`): `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`, `FLOW_VISUAL_FIRST_CAROUSEL`, `FLOW_WHY_MIMIC_CAROUSEL`. Do not conflate with `FLOW_CAROUSEL` / `carousel_package`. Render truth is **`mimic_v1`** on `generation_payload`. Mimic LLM prompts must filter signal pack to the job's single planned idea (`llm-creation-pack-budget.ts`, `mimicFlowOnly: true`).
13. **Mimic carousel text overlay** — TP-grounded carousels must **not** bake LLM copy into image models at render. Overlay-only (DocAI/HBS + `reprint-text-overlay`) is enforced in `job-pipeline.ts`; do not re-enable Flux typography for carousels without explicit approval.
14. **New visual carousel** — `FLOW_VISUAL_FIRST_CAROUSEL` uses `execution_mode: "new_visual"` on `mimic_v1`: idea + BVS driven, **no** top-performer `reference_items`. Prep in `new-visual-carousel-prep.ts` — not TP reference resolve. Do not treat visual-first as competitor frame replication.
15. **Why Mimic carousel** — `FLOW_WHY_MIMIC_CAROUSEL` uses `execution_mode: "why_mimic"` with Slide Intelligence (`slide_intelligence` on `mimic_v1`). Same render engine as other TP-grounded flows; copy/prompts are SIL-driven.
16. **Brand Visual System (BVS)** — versioned `brand_bibles` (`brand_bible_v1`) snapshotted to `generation_payload.bvs_v1` when `candidate_data.use_brand_visual_system` is set (visual-first defaults on). `mimic_v1.bvs_render_plan` drives invented plates for `template_bg`. Use `src/domain/brand-bible.ts`, `bvs-v1.ts`, `bvs-render-plan.ts` — do not ad-hoc read bible JSON from jobs.

## Where to change behavior

| Goal | Start here |
|------|------------|
| Run planning, scoring, suppression | `src/decision_engine/`, `src/services/run-orchestrator.ts` |
| LLM prompts & creation pack | `src/services/llm-generator.ts`, `src/repositories/flow-engine.ts` |
| QC checks / risk keywords | `src/services/qc-runtime.ts`, checklist rows, scoped `risk_policies` via `listRiskPoliciesForJob` |
| Job lifecycle & render | `src/services/job-pipeline.ts` |
| Top-performer mimic (prep, render, modes) | `src/services/mimic-draft-prep.ts`, `mimic-carousel-render.ts`, `mimic-image-job.ts`, `mimic-mode-classifier.ts`, `src/domain/mimic-payload.ts` |
| New visual carousel (`FLOW_VISUAL_FIRST_CAROUSEL`) | `src/services/new-visual-carousel-prep.ts`, `new-visual-carousel-execution.ts`, `new-visual-carousel-flux-prompts.ts` |
| Why Mimic carousel (`FLOW_WHY_MIMIC_CAROUSEL`) | `src/domain/why-mimic-carousel-flow-types.ts`, `why-mimic-execution.ts`, SIL on `mimic_v1` |
| Brand Visual System (BVS) | `src/domain/brand-bible.ts`, `bvs-v1.ts`, `bvs-render-plan.ts`, `src/services/bvs-render-overlays.ts`, `src/repositories/brand-bibles.ts` |
| Mimic text overlay / DocAI / reprint | `src/domain/mimic-docai-layer-positions.ts`, `mimic-post-render-layout-loop.ts`, Review `reprint-text-overlay` |
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

**Production Review / Admin UI:** embedded in the Core Fly image — **not** a separate Vercel deploy. Canonical URL: **https://caf-core.fly.dev/admin/workbench**. After `apps/review/` changes, ship with **`fly deploy -a caf-core`** from repo root (rebuilds Next.js standalone in `Dockerfile`). Vercel projects (`caf-core-review`, etc.) are optional/legacy; do not assume they are what operators use.

## Documentation map

| Doc | Audience |
|-----|----------|
| `docs/CAF_PRODUCT_PITCH.md` | Leadership / investors / evaluators |
| `docs/CAF_COMPLETE_PRODUCT_GUIDE.md` | **Complete product guide** — what CAF is and does |
| `docs/CAF_CURRENT_STATE_CONTEXT_PACK.md` | **Current repo truth** — operational map; PDF volumes in `docs/export/pdf/11–14` |
| `docs/EXTERNAL_CONTEXT_PACK.md` | **ChatGPT / external repos** — what to upload, system prompt |
| `docs/REBUILD_FROM_DOCS.md` | Engineers bootstrapping from scratch |
| `docs/DATABASE_SCHEMA.md` | Postgres table catalog |
| `docs/DOMAIN_MODEL.md` | Entities, IDs, lifecycles |
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
| `docs/MIMIC_FLOWS_COMPLETE_GUIDE.md` | Top-performer mimic (full; **lags** new visual / BVS — prefer current-state pack) |
| `docs/MIMIC_IMAGE_FLOWS.md` | Mimic image quick ref |
| `docs/MIMIC_TEXT_PLACEMENT_AUTOMATION.md` | **Future** mimic text placement QA (post-render composite loop) — read before automating |
| `docs/CREATIVE_INTELLIGENCE.md` | Top-performer ingest upstream of mimic |
| `docs/API_REFERENCE.md` | HTTP examples |

## Optional rules (Cursor)

- `scene-assembly-n8n-legacy.mdc` — when touching scene/n8n-legacy paths
- `mimic-signal-pack-llm-filter.mdc` — mimic LLM creation pack; single-idea `signal_pack` filter
- `mimic-carousel-package.mdc` — `mimic_carousel_package` vs `FLOW_CAROUSEL` / `carousel_package`
- `visual-first-carousel-flow.mdc` — `FLOW_VISUAL_FIRST_CAROUSEL`: **new visual** lane (`execution_mode: "new_visual"`, idea+BVS, no TP references); same mimic **render engine** as manual mimic; Review workbench without original-vs-generated compare
- `mimic-text-placement-automation.mdc` — **before automating mimic text placement**: post-render composite QA loop, HTML overlay invariants, `docai_layer_positions` schema
- `caf-domain-model.mdc` — **alwaysApply**

If the user’s request conflicts with **domain invariants**, **ask** or **surface the tradeoff** before renaming IDs or changing status enums.
