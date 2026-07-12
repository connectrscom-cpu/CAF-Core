# Cursor task — CAF documentation reconciliation (July 2026)

Paste this entire file into a Cursor agent session when older CAF docs need to match the live repo.

---

You are working inside **CAF Core**.

## Goal

Update CAF documentation so it matches the current repo state as of the **July 2026 current-state context pack**. Do **not** refactor runtime code unless you discover a documentation generator or an obvious broken doc reference that needs a small fix. This is primarily a **documentation reconciliation** task.

## Primary authority order

1. **Live source code and migrations** win.
2. `docs/CAF_CURRENT_STATE_CONTEXT_PACK.md` and `docs/volumes/CAF_CONTEXT_VOL*.md` are the current repo-derived operational map.
3. `AGENTS.md` defines invariants for AI/coding agents.
4. Older June docs are useful but may be stale.

## Read first

- `docs/CAF_CURRENT_STATE_CONTEXT_PACK.md`
- `docs/volumes/CAF_CONTEXT_VOL1_Platform_and_Funnel.md`
- `docs/volumes/CAF_CONTEXT_VOL2_Data_Contracts_and_Flows.md`
- `docs/volumes/CAF_CONTEXT_VOL3_Operators_Mimic_and_BVS.md`
- `docs/volumes/CAF_CONTEXT_VOL4_Quality_Ops_and_Agent_Map.md`
- `AGENTS.md`
- `docs/EXTERNAL_CONTEXT_PACK.md`

## Then update stale docs, especially

- `docs/CAF_CORE_COMPLETE_GUIDE.md`
- `docs/CAF_COMPLETE_PRODUCT_GUIDE.md`
- `docs/PROJECT_OVERVIEW.md`
- `docs/ARCHITECTURE.md`
- `docs/DOMAIN_MODEL.md`
- `docs/LIFECYCLE.md`
- `docs/JOB_LIFECYCLE.md`
- `docs/DATABASE_SCHEMA.md`
- `docs/MIMIC_FLOWS_COMPLETE_GUIDE.md`
- `docs/MIMIC_IMAGE_FLOWS.md`
- `docs/CREATIVE_INTELLIGENCE.md`
- `docs/CAF_INPUTS_PIPELINE_ROADMAP.md`
- `docs/QUALITY_CHECKS.md`
- `docs/RISK_RULES.md`
- `docs/GENERATION_GUIDANCE.md`
- `docs/API_REFERENCE.md`
- `docs/REBUILD_FROM_DOCS.md`
- `docs/TECH_STACK.md`
- `ENV_AND_SECRETS_INVENTORY.md`
- `.env.example` — only if documented env names are stale or missing
- `.cursor/rules/visual-first-carousel-flow.mdc` — if still describing TP replication for visual-first

## Specific corrections to apply

### 1. CAF identity

CAF is a **content operations platform**, not only AI generation.

Production loop (use consistently):

```
Inputs / evidence → signal pack → planned jobs → decision engine → content jobs
  → LLM drafts → QC / risk → diagnostics → rendering → human review
  → rework → publishing → performance metrics → learning rules
```

State clearly:

- Source of truth: PostgreSQL `caf_core`, especially `content_jobs.generation_payload`
- Review app is a **client/proxy** of Core APIs, not the DB authority
- Migrations and source win over prose documentation

### 2. Maturity (honest)

**Production / mature:** run planning, `FLOW_CAROUSEL`, carousel editor, Review workbench, QC + risk policies, HeyGen video, inputs → signal pack, Creative Intelligence ingest, publications (Meta/n8n), learning rules.

**Partial / gated:** mimic carousel render (`MIMIC_IMAGE_ENABLED=false` default), mimic image, scene assembly (provider-dependent), Stage-3 idea picker, marketer funnel completeness, composite saliency text-placement automation (designed, not built), global learning rules disabled, `FLOW_IMG_*` blocked at LLM.

### 3. Brand Visual System (BVS)

Document: `brand_bibles`, `brand_bible_v1`, `generation_payload.bvs_v1`, `parseBvsV1()`, `attachBvsToPlannedPayload()`, `brand-bible.ts`, `bvs-v1.ts`, `bvs-render-plan.ts`, `brand-bibles` repo, `bvs-render-overlays.ts`.

- BVS is a **current** subsystem
- Snapshotted at plan when `candidate_data.use_brand_visual_system === true`
- Visual-first defaults BVS on
- `mimic_v1.bvs_render_plan` can drive invented plates for `template_bg`
- Logo/frame overlays and palette injection where supported

### 4. Visual-first carousel

**Not** top-performer mimic replication.

- `FLOW_VISUAL_FIRST_CAROUSEL` → `mimic_v1.execution_mode = "new_visual"`
- Idea + BVS driven; **no** `reference_items`
- Prep: `new-visual-carousel-prep.ts`, `new-visual-carousel-execution.ts`, `new-visual-carousel-flux-prompts.ts`

### 5. Why Mimic carousel

- `FLOW_WHY_MIMIC_CAROUSEL` → `execution_mode: "why_mimic"`
- SIL on `mimic_v1.slide_intelligence`
- `why-mimic-carousel-flow-types.ts`, `why-mimic-execution.ts`
- Requires substantive SIL when `WHY_MIMIC_REQUIRE_SUBSTANTIVE_SIL` is enabled

### 6. Mimic carousel contract

- `mimic_v1` = render source of truth
- `mimic_carousel_package` = review snapshot for **TP-grounded carousel render flows** (`isTpGroundedCarouselRenderFlow()`)
- `carousel_package` = standard `FLOW_CAROUSEL` only
- `execution_mode`: `classic` | `why_mimic` | `new_visual`
- `mode`: `image_full` | `template_bg` | `carousel_visual`

### 7. Mimic text overlay invariant

- Do **not** bake LLM copy into image models for TP-grounded carousels
- Art-only plate → DocAI/HBS → `docai_layer_positions` → `reprint-text-overlay`
- Cheap reprint = copy/layout; expensive regen = wrong visuals

### 8. Review app

- Embedded at `/admin/workbench` on Core Fly
- Marketer: `/workspace`, `/brand/[slug]/*`
- Operator: `/review`, `/runs`, `/pipeline`, `/publish`, `/learning`, `/t/[task_id]`
- Core owns state; Review owns UX, previews, proxies

### 9. QC / risk

- Enforced: checklists, copy-quality patterns, `risk_policies`, `brand_constraints.banned_words`
- **Not** enforced: project `risk_rules` — honesty at `GET /v1/projects/:slug/risk-qc-status`
- `mergeGenerationPayloadQc()` only writer for `qc_result`
- `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC=true` default

### 10. Learning

- Facade: `learning-rule-selection.ts` only
- Planning: `getLearningRulesForPlanning()` — BOOST_RANK, SCORE_BOOST, SCORE_PENALTY
- Generation: `getLearningContextForGeneration()`
- Global rules disabled in compiler
- `job_outcomes`, run context snapshots, LLM approval reviews

### 11. Publishing

- `publication_placements`: `draft` → `scheduled` → `publishing` → `published` | `failed` | `cancelled`
- `CAF_PUBLISH_EXECUTOR`: `none` | `dry_run` | `meta`

### 12. Database schema

Bring `DATABASE_SCHEMA.md` current through latest migration (e.g. `078_brand_bibles.sql`). Include: `brand_bibles`, `brand_profiles`, `job_outcomes`, CI tables, idea lists, legacy `candidates_json` vs `planned_jobs_json`.

### 13. Job lifecycle

- Runs: `CREATED` → `PLANNING` → `PLANNED` → `GENERATING` → (`RENDERING`) → (`REVIEWING`) → `COMPLETED` | `FAILED` | `CANCELLED`
- Jobs: `PLANNED` → `GENERATING` → `GENERATED` → (`RENDERING`) → `IN_REVIEW` | `BLOCKED` | `REJECTED` | `NEEDS_EDIT` | `APPROVED` | `FAILED`
- Note: `QC_FAILED` only on limited pipeline path; `READY_FOR_REVIEW` legacy; no DB CHECK on `content_jobs.status`

### 14. EXTERNAL_CONTEXT_PACK

Instruct LLMs to start with current-state pack + volumes + `AGENTS.md`; warn older docs lag BVS / new visual / Why Mimic.

## Preserve invariants (do not weaken)

See `AGENTS.md` § Invariants — especially `task_id`, `mergeGenerationPayloadQc`, `hasActiveProviderSession`, learning facade, overlay-only mimic text, visual-first ≠ TP replication.

## Deliverables

1. Update relevant docs — small, reviewable diffs; add **“Updated current-state note”** where helpful instead of deleting historical context.
2. End summary: files changed, stale claims corrected, remaining uncertainties, docs still needing source verification.
3. Run `npm run export:doc-pdfs` if export bundles should be regenerated.
4. **Do not** touch secrets or change runtime behavior unless required for broken doc generation.

**Scope:** Documentation only. Do not implement app fixes in the same task.
