# CAF Current State Context Pack — Quality Ops and Agent Map

**Volume 4 of 4** | Generated 2026-07-10 | Full pack: docs/CAF_CURRENT_STATE_CONTEXT_PACK.md

---
## 12. QC, risk, validation, and quality gates

### QC runtime (`qc-runtime.ts` → `runQcForJob`)

1. **Checklist** from `flow_definitions.qc_checklist_name` → `qc_checklists`
2. **Copy quality** patterns (hashtags, tone, etc.)
3. **`risk_policies`** — global + flow-scoped via `listRiskPoliciesForJob()`
4. **`brand_constraints.banned_words`** — same keyword scan as policies

### NOT enforced by QC
- **`risk_rules`** (project CSV rows) — zero references in `qc-runtime.ts`
- Honesty endpoint: `GET /v1/projects/:slug/risk-qc-status`

### Pass/fail
`qc_passed` = no blocking checklist failures AND no CRITICAL risk findings.

### Routing (`validation-router.ts`)
Maps `recommended_route` to job status; `finalJobStatusAfterRender()` → `IN_REVIEW`.

### Other gates
- **Output schema validation** — `CAF_OUTPUT_SCHEMA_VALIDATION_MODE` (`off`|`warn`|`strict`)
- **Draft package contract** — `CAF_DRAFT_PACKAGE_CONTRACT_MODE`
- **Diagnostic audits** — machine quality evaluation
- **Auto-validation** — `auto_validation_results` table
- **Post-approval LLM review** — `llm_approval_reviews`, upstream recommendations via `insertLlmApprovalReview()`
- **Human review gate** — `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC=true` default

---

## 13. Learning loop

### Facade (mandatory entry point)
`src/services/learning-rule-selection.ts`

| Function | When | Rules |
|----------|------|-------|
| `getLearningRulesForPlanning()` | Decision engine scoring | `BOOST_RANK`, `SCORE_BOOST`, `SCORE_PENALTY` only |
| `getLearningContextForGeneration()` | LLM prompt build | `generation` family / GUIDANCE action types |

### Planning path
`decision_engine/index.ts` → `applyLearningBoosts()` multiplies `pre_gen_score`.

Sources: `editorial-learning.ts`, `performance-learning.ts`, `market-learning.ts`.

### Generation path
`learning-context-compiler.ts` → `merged_guidance` injected in `llm-generator.ts`.  
Preview: `GET /v1/learning/:slug/context-preview`.  
**Global rules disabled** in compiler.

### Evidence → rules loops

| Loop | Trigger | Output |
|------|---------|--------|
| Editorial (B) | `POST …/editorial-analysis` | Pending `SCORE_PENALTY` rules |
| Performance (C) | performance ingest/CSV/analysis | Ranking rules from metrics |
| LLM approval | `POST …/llm-review-approved` | Upstream recommendations + hints |
| Manual | apply/retire/dismiss APIs | `pending` → `active` |

### Attribution / snapshots
- `learning_generation_attribution` — which rules affected a generation
- `run_context_snapshots` via `setRunContextSnapshot()` — prompt versions + fingerprints (failures logged, never abort run)
- `job_outcomes` (075) — publish → performance anchor

### Tables
`learning_rules`, `learning_observations`, `learning_hypotheses`, `learning_insights`, `performance_metrics`, `llm_approval_reviews`

---

## 14. Publishing and integrations

### Model
`publication_placements` — one row per scheduled post: caption/media snapshots, platform, format (`carousel`|`video`|`unknown`).

### Lifecycle
`draft` → `scheduled` → `publishing` → `published` | `failed` | `cancelled`

### Executor modes (`CAF_PUBLISH_EXECUTOR`)

| Mode | Behavior |
|------|----------|
| `none` (default) | Start claims placement; returns n8n payload; external worker calls `/complete` |
| `dry_run` | Fake IDs for plumbing tests |
| `meta` | Core calls `publishPlacementToMeta()` directly |

### Meta integration (`meta-graph-publish.ts`)
Facebook feed/photos/video; Instagram single/carousel/reels; polls container status; re-signs Supabase URLs for Meta fetch.

Credentials: `project_integrations` (`META_FB`, `META_IG`) + env overrides `CAF_META_*`.  
Account aliasing: `CAF_META_ACCOUNT_SOURCE_MAP` (e.g. `CUISINA=SNS`).

### n8n payload
`publication-n8n-payload.ts` — legacy field names matching `Publish_Carousel_IG_FB` / `Publish_Video_IG_FB`.

### On success
`appendPublicationResultToJob()` + `upsertJobOutcomeOnPublish()` → closes loop to `job_outcomes` / performance.

### Project integrations
`src/routes/project-integrations.ts` — CRUD + test for external credentials.

---

## 15. API surface map

**Registration hub:** `src/server.ts`

| Domain | Route file | Key endpoints | Auth |
|--------|------------|---------------|------|
| Health | `v1.ts` | `/`, `/health`, `/readyz`, `/health/rendering` | Optional bearer |
| Decisions / jobs | `v1.ts` | `/v1/decisions/plan`, `/v1/jobs/ingest`, `GET .../jobs/:slug/:task_id` | Token if required |
| Review queue | `v1.ts` | `/v1/review-queue/...` (large surface: decide, regen, reprint, docai, mimic-mode) | Token |
| Runs | `runs.ts` | CRUD, `/jobs`, `/start`, `/process`, `/render`, `/cancel` | Token |
| Pipeline | `pipeline.ts` | `/generate`, `/qc`, `/diagnose`, `/full`, `/rework` | Token |
| Projects | `project-config.ts` | strategy, brand, risk-qc-status, flow-types, brand-assets, heygen | Token |
| Flow engine | `flow-engine.ts` | flows, prompts, schemas, templates, qc-checks, risk-policies | Token |
| Signal packs | `signal-packs.ts` | upload, ideas, select-ideas, mimic-mode overrides | Token |
| Inputs evidence | `inputs-evidence.ts` | upload, list, rows | Token |
| Inputs scrapers | `inputs-scrapers.ts`, `inputs-sources.ts` | workbook, scraper runs | Token |
| Inputs processing | `inputs-processing.ts` | profile, insight passes, build-signal-pack, idea-lists | Token |
| Evidence read | `evidence-insights-read.ts` | `/v1/evidence`, `/v1/insights` | Token |
| Creative intel | `creative-intelligence.ts` | ingest, analyses, styling, mimic-template | Token |
| Learning | `learning.ts` | rules, observations, performance, editorial-analysis, llm-review | Token |
| Publications | `publications.ts` | CRUD, start, complete, n8n-payload | Token |
| Integrations | `project-integrations.ts` | Meta etc. | Token |
| Admin | `admin.ts`, `mimic-text-overlay-lab-routes.ts` | HTML workbench + lab APIs | Token |
| Renderer templates | `renderer-templates.ts` | `/api/templates` | Often open |
| Review proxy | `review-proxy.ts` | Non-Core paths → embedded Next.js | Review exempt |

**Auth:** When `CAF_CORE_REQUIRE_AUTH` + `CAF_CORE_API_TOKEN`, Bearer or `x-caf-core-token` on Core paths.

---

## 16. Environment and deployment

### Local minimum
```bash
DATABASE_URL=postgres://...
OPENAI_API_KEY=sk-...
# Optional for full loop:
RENDERER_BASE_URL=http://localhost:3333
CAF_CORE_URL=http://localhost:3847  # Review app
```

### Production groups
See `ENV_AND_SECRETS_INVENTORY.md` and `src/config.ts` (Zod-validated).

| Group | Notable vars |
|-------|--------------|
| Core | `DATABASE_URL`, `CAF_RUN_MIGRATIONS_ON_START`, `CAF_CORE_API_TOKEN`, `CAF_REVIEW_ENABLED`, `CAF_PUBLIC_URL` |
| Planning | `DECISION_ENGINE_VERSION`, `DEFAULT_MAX_CAROUSEL_JOBS_PER_RUN`, score weights |
| QC | `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC`, `CAF_OUTPUT_SCHEMA_VALIDATION_MODE` |
| Rendering | `RENDERER_BASE_URL`, `VIDEO_ASSEMBLY_BASE_URL`, concurrency/timeouts |
| Mimic | `MIMIC_IMAGE_ENABLED`, `MIMIC_IMAGE_PROVIDER`, `BFL_API_KEY`, `MIMIC_LAYOUT_QA_*` |
| Video | `HEYGEN_API_KEY`, `SCENE_ASSEMBLY_CLIP_PROVIDER`, `SORA_*` |
| Publish | `CAF_PUBLISH_EXECUTOR`, `CAF_META_*`, `META_GRAPH_API_VERSION` |
| Storage | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ASSETS_BUCKET` |
| Inputs | `APIFY_API_TOKEN`, `DOCUMENT_AI_*`, `CREATIVE_INTEL_*` |

### Deploy
- **Core + Review:** `fly deploy -a caf-core` (Dockerfile builds Next.js standalone)
- **Renderer / media:** separate Fly apps (`fly.caf-renderer.toml`, `fly.toml`)
- **Migrations:** `npm run migrate` or on startup when enabled

---

## 17. Current maturity matrix

| Feature / subsystem | Maturity | Evidence | Known gaps | Main files |
|---------------------|----------|----------|------------|------------|
| Standard carousel | Production | Full pipeline + Review editor | Template variety | `carousel-render-pack.ts`, `CarouselEdits.tsx` |
| Carousel editor | Production | Live preview, brand styling panel | — | `CarouselSlider.tsx`, `preview-live-slide/route.ts` |
| Mimic carousel | Production (gated) | Full prep + render + layer editor | Default `MIMIC_IMAGE_ENABLED=false` | `mimic-draft-prep.ts`, `MimicCarouselLayerEditorPanel.tsx` |
| New visual carousel | Active development | `new-visual-carousel-*.ts`, migration 070/071 | Docs lag | `new-visual-carousel-prep.ts` |
| Why Mimic carousel | Newer production | migration 074, SIL | Requires substantive SIL | `why-mimic-carousel-flow-types.ts` |
| BVS / brand bible | New (migration 078) | `brand-bibles.ts`, `bvs-v1.ts` | Docs not updated | `brand-bible.ts`, `bvs-render-plan.ts` |
| Mimic image (single) | Gated | `mimic-image-job.ts` | Same env gate | `mimic-image-provider.ts` |
| Mimic text placement automation | Partial | Layout QA loop only | Composite saliency not built | `mimic-post-render-layout-loop.ts` |
| HeyGen video | Production | `heygen-renderer.ts` | Provider quotas | `HEYGEN_API_KEY` |
| Scene assembly | Provider-dependent | `scene-pipeline.ts` | Sora availability | `sora-scene-clips.ts` |
| Inputs pipeline | Largely built | migrations 027–065+ | Stage-3 picker partial | `inputs-processing.ts` |
| Creative intelligence | Production | migration 055 | Downstream SIL docs thin | `creative-intelligence.ts` |
| Publishing | Production | Meta + n8n paths | Default executor `none` | `publications.ts` |
| Learning | Production | Facade + compiler | Global rules disabled | `learning-rule-selection.ts` |
| QC / risk | Production | `qc-runtime.ts` | `risk_rules` not enforced | `risk-qc-status.ts` |
| Review app | Production | Embedded in Core | Marketer funnel incomplete vs admin | `apps/review/` |
| Admin config | Production | `admin.ts`, project-config routes | HTML legacy mixed with API | `project-config.ts` |
| Product image flows | Placeholder | Blocked at LLM | Not wired | `product-flow-types.ts` |

---

## 18. Repo map for future AI agents

| Goal | Start here | Do not casually change |
|------|------------|------------------------|
| Run planning / scoring | `src/decision_engine/`, `run-orchestrator.ts` | ID patterns, `planned_jobs_json` contract |
| Job execution | `job-pipeline.ts` | Lifecycle enums |
| LLM generation | `llm-generator.ts`, `flow-engine` repos | Prompt versions without migration |
| QC | `qc-runtime.ts` | Write `qc_result` except via `mergeGenerationPayloadQc` |
| Risk policies | `flow-engine` risk-policies, `qc-runtime.ts` | Assume `risk_rules` are enforced |
| Rendering | `job-pipeline.ts`, `carousel-render-pack.ts`, `services/renderer/` | HeyGen retry without `hasActiveProviderSession` |
| Review UI | `apps/review/src/components/TaskReviewClient.tsx` | Job state authority |
| Mimic | `mimic-draft-prep.ts`, `mimic-carousel-render.ts`, `mimic-payload.ts` | Conflate `carousel_package` with `mimic_carousel_package` |
| BVS | `brand-bible.ts`, `bvs-v1.ts`, `bvs-render-plan.ts` | — |
| New visual | `new-visual-carousel-prep.ts`, `new-visual-carousel-execution.ts` | Re-add TP references to visual-first |
| Inputs | `inputs-processing.ts`, `inputs-evidence.ts` | Signal pack JSON contracts |
| Publishing | `publications.ts`, `meta-graph-publish.ts` | Placement lifecycle strings |
| Learning | `learning-rule-selection.ts` facade only | Direct `listActiveAppliedLearningRules` imports |
| Env / config | `src/config.ts` | — |
| Review contract | `review-contract.test.ts` | Rename paths without updating test |
| Schema truth | `migrations/` | — |

---

## 19. Non-negotiable invariants

1. **`task_id` + `project_id`** remain primary execution keys across `job_drafts`, `assets`, `editorial_reviews`, `job_state_transitions`, etc.
2. **Postgres `caf_core`** is source of truth; Review app is a client.
3. **`content_jobs.generation_payload`** is a versioned integration contract — coordinate pipeline, Review, admin consumers.
4. **QC `qc_result`** must be written only via **`mergeGenerationPayloadQc()`** (`generation-payload-qc.ts`).
5. **HeyGen/provider retries** must use **`hasActiveProviderSession()`** — no double-submit when `video_id`/`session_id` exist.
6. **Learning lookups** go through **`learning-rule-selection.ts`** facade — not direct compiler imports from new code.
7. **`risk_policies` + brand `banned_words`** are QC-enforced; **project `risk_rules` are NOT** (see `risk-qc-status`).
8. **Lifecycle status strings** must not be casually renamed (runs have SQL CHECK; jobs do not but consumers depend on strings).
9. **Migrations + source win** over docs when conflicting.
10. **`mimic_carousel_package`** is for TP-grounded carousel render flows only (`isTpGroundedCarouselRenderFlow()`); standard carousel uses `carousel_package`.
11. **Mimic LLM creation pack** must filter signal pack to the job's single planned idea (`mimicFlowOnly: true`).
12. **Mimic carousel text** is overlay-only — do not bake copy into Flux at render (enforced in `job-pipeline.ts`).
13. **Upstream recommendations** must use `parseUpstreamRecommendations` + `insertLlmApprovalReview()`; each item logged as `learning_observation`.
14. **Run context snapshots** via `setRunContextSnapshot()` — failures logged, never abort run.
15. **Review `/v1/` contract** — changes to listed paths require `review-contract.test.ts` update in same PR.

---

## 20. Documentation drift and required updates

### Still accurate
- `AGENTS.md` — invariants match code
- `docs/DOMAIN_MODEL.md` — ID patterns (minor column naming caveat)
- `docs/LIFECYCLE.md` — run states (job diagram omits `GENERATED`)
- `docs/QUALITY_CHECKS.md`, `docs/RISK_RULES.md` — risk_rules vs risk_policies asymmetry
- `docs/EXTERNAL_CONTEXT_PACK.md` — tier structure (needs new pack reference)
- `docs/CAF_INPUTS_PIPELINE_ROADMAP.md` — largely matches implementation
- `.cursor/rules/caf-domain-model.mdc`, `mimic-carousel-package.mdc`, `mimic-signal-pack-llm-filter.mdc`

### Outdated or incomplete
| Doc | Drift |
|-----|-------|
| `docs/MIMIC_FLOWS_COMPLETE_GUIDE.md` | Visual-first still described as TP-grounded; missing `execution_mode`, Why Mimic, new visual, BVS |
| `docs/CREATIVE_INTELLIGENCE.md` | No SIL, `mimic_evaluation`, new-visual lane |
| `docs/MIMIC_IMAGE_FLOWS.md` | Pre-BVS, pre-new-visual |
| `visual-first-carousel-flow-types.ts` header comment | Still says TP-grounded references |
| `docs/CAF_CORE_COMPLETE_GUIDE.md` | Merged summary stale on BVS, Why Mimic, new visual (June 2026 stamp) |
| `docs/DATABASE_SCHEMA.md` | Missing `brand_bibles`, `brand_profiles`, `job_outcomes`, slide intelligence columns |
| `docs/export/README.md` | Last generated 2026-06-16; no current-state pack |
| `docs/JOB_LIFECYCLE.md` | May omit `GENERATED`, `QC_FAILED` split-brain |

### Features in code, not documented
- Brand Visual System (`brand_bibles`, `bvs_v1`, `bvs_render_plan`, invented plates)
- `FLOW_WHY_MIMIC_CAROUSEL` + slide intelligence layer
- `FLOW_VISUAL_FIRST_CAROUSEL` as **new visual** (not TP replication)
- `execution_mode` on `mimic_v1` (`classic`|`why_mimic`|`new_visual`)
- `job_outcomes` table (075)
- `CarouselBrandStylingPanel` + live preview overlays in Review
- Per-project mimic render settings (migrations 066–069)
- `MIMIC_CAROUSEL_TEXT_VIA_FLUX` ignored at render (hardcoded false)

### Documented but not fully implemented
- `docs/MIMIC_TEXT_PLACEMENT_AUTOMATION.md` — composite saliency analyzer
- Project `risk_rules` enforcement (documented as config-only — correct)
- Stage-3 structured idea picker (roadmap TBD)
- Global learning rules in generation compiler

### Suggested update priority
1. **`docs/MIMIC_FLOWS_COMPLETE_GUIDE.md`** — add execution modes, new visual, Why Mimic, BVS section
2. **`docs/DATABASE_SCHEMA.md`** — brand_bibles, job_outcomes, SIL columns
3. **`docs/CREATIVE_INTELLIGENCE.md`** — downstream SIL + mimic_evaluation
4. **`docs/CAF_CORE_COMPLETE_GUIDE.md`** — merge BVS + new flows or point to this pack
5. **`docs/export/README.md`** — add current-state PDF volumes
6. **Cursor rule `visual-first-carousel-flow.mdc`** — align header with new_visual semantics
7. **`docs/JOB_LIFECYCLE.md`** — add `GENERATED`, clarify `QC_FAILED` scope

---

## Appendix A — ChatGPT upload bundle (2026-07)

For external LLM projects, upload **in order**:

| Priority | File |
|----------|------|
| 1 | `docs/CAF_CURRENT_STATE_CONTEXT_PACK.md` (this file) OR volumes 1–4 |
| 2 | `AGENTS.md` |
| 3 | `docs/EXTERNAL_CONTEXT_PACK.md` |
| 4 | `apps/review/CHATGPT_CAROUSEL_REVIEW_CONSOLE_EDIT_GUIDE.md` (operator mimic workflow) |
| 5 | Topic add-ons: `docs/MIMIC_FLOWS_COMPLETE_GUIDE.md` (until updated), `docs/CREATIVE_INTELLIGENCE.md` |

**System prompt:** Use the template in `docs/EXTERNAL_CONTEXT_PACK.md` § "System prompt template".

**Regenerate PDFs:** `npm run export:doc-pdfs` after doc changes.
