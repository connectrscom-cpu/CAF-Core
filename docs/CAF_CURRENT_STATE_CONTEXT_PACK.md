# CAF Current State Context Pack

**Generated:** 2026-07-10  
**Authority:** This document is derived from the live repository (`src/`, `migrations/`, `apps/review/`, `services/`). When it conflicts with older docs, **source wins**.

**Purpose:** Operational, file-path-specific map of CAF as it exists today — for product owners, engineers, operators, and external LLMs (ChatGPT, Claude, Cursor).

**PDF volumes:** For ChatGPT upload limits, use the four split files in `docs/volumes/` (regenerate PDFs via `npm run export:doc-pdfs`).

---

## 1. Executive summary

### What CAF is

CAF (Content Automation Framework) is a **content automation / content operations platform** that turns research inputs, evidence, signal packs, creative intelligence, and planning decisions into **generated, QC-checked, rendered, reviewed, publishable, and learnable** social content.

The production loop:

```
Inputs / evidence → signal pack → planned jobs → decision engine → content jobs
  → LLM drafts → QC / risk → diagnostics → rendering → human review
  → rework → publishing → performance metrics → learning rules
```

### Problem it solves

Operators run multi-platform content brands (e.g. SNS, Cuisina) at scale: ingest competitor/top-performer research, plan ideas per flow type, generate copy and media, enforce brand/risk gates, route through human review, publish to Meta, and close the loop with performance-driven learning.

### Who uses it

| Persona | Surface |
|---------|---------|
| **Marketer / brand owner** | Review app marketer funnel (`/workspace`, `/brand/[slug]/*`) |
| **Content operator / reviewer** | Review workbench (`/review`, `/t/[task_id]`) |
| **Pipeline engineer** | Core API, CLI (`npm run process-run`), admin HTML |
| **Inputs / research operator** | Admin inputs pages, `/v1/inputs-*` APIs |
| **External workers** | n8n publish webhooks, renderer/video-assembly sidecars |

### Source of truth

- **PostgreSQL schema `caf_core`** — especially `content_jobs.generation_payload`
- **Core API** (`src/server.ts`, Fastify) — not the Review app
- **Migrations** (`migrations/*.sql`) — schema truth over prose docs

### Mature vs experimental (honest)

| Mature / production-used | Partial / gated / experimental |
|--------------------------|--------------------------------|
| Run planning + job pipeline | Product image flows (`FLOW_IMG_*`) — blocked at generation |
| Standard carousel (`FLOW_CAROUSEL`) | Full composite saliency text-placement automation (designed, not built) |
| QC + risk policies + human review | Project `risk_rules` — config only, **not** QC-enforced |
| HeyGen video flows | Scene assembly (Sora) — wired but provider-dependent |
| Inputs → signal pack funnel | Stage-3 structured idea picker at plan time (partial) |
| Publications + Meta executor | `CAF_PUBLISH_EXECUTOR=none` default (n8n external) |
| Learning rules (planning + generation) | Global learning rules (disabled in compiler) |
| Review app workbench | Marketer funnel — growing, not all pipeline controls |
| Manual mimic carousel | Why Mimic + New Visual — newer, actively evolving |
| Brand Visual System (BVS) + brand bibles | BVS invented plates — `template_bg` + BVS only |

---

## 2. Platform components

| Component | Path | Purpose | State owned | Depends on | Key env | Maturity |
|-----------|------|---------|-------------|------------|---------|----------|
| **CAF Core API** | `src/` | Orchestration, HTTP, business logic | `caf_core.*` tables | Postgres, OpenAI, providers | `DATABASE_URL`, `PORT` | Production |
| **Postgres `caf_core`** | `migrations/` | All persistent state | Everything | — | `DATABASE_URL` | Production |
| **Review app** | `apps/review/` | Operator + marketer UI (client) | None (proxies Core) | Core API, renderer | `CAF_CORE_URL`, `RENDERER_BASE_URL` | Production (embedded in Core Fly image) |
| **Admin HTML** | `src/routes/admin.ts` | Legacy ops workbench | None | Core | Same as Core | Production |
| **Renderer** | `services/renderer/` | Puppeteer + HBS → PNG slides | Temp files | Templates from Core or disk | `PORT`, `RENDER_CONCURRENCY` | Production |
| **Video assembly** | `services/video-assembly/` | ffmpeg stitch/mux/burn | Temp uploads | Supabase | `SUPABASE_*` | Production |
| **Media gateway** | `services/media-gateway/` | Single port proxy to renderer + video | None | Child processes | `PORT`, `SPAWN_CHILDREN` | Production (Fly sidecar) |
| **Storage** | Supabase | Asset URLs (carousel, video, mimic plates) | Bucket objects | — | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Production |
| **OpenAI** | external | LLM generation, TTS, Sora, vision | None | API key | `OPENAI_API_KEY` | Production |
| **HeyGen** | external | Avatar / video agent renders | Provider session IDs in `render_state` | API key | `HEYGEN_API_KEY` | Production |
| **BFL / DashScope / NVIDIA** | external | Mimic image edit / T2I | None | Provider keys | `MIMIC_IMAGE_*`, `BFL_API_KEY` | Gated (`MIMIC_IMAGE_ENABLED=false` default) |
| **Meta Graph** | external | IG/FB publish | Placement rows | Page tokens | `CAF_PUBLISH_EXECUTOR`, `CAF_META_*` | Optional |
| **Apify / scrapers** | external | Evidence ingest | Scraper run rows | `APIFY_API_TOKEN` | Partial |
| **Document AI** | external | Carousel OCR for mimic overlay seed | None | GCP creds | `DOCUMENT_AI_*` | Optional |
| **n8n / external publish workers** | external | Legacy publish execution | Callback to Core | Webhook | `CAF_PUBLISH_EXECUTOR=none` | Legacy path |

**Deployment:** Production Review is embedded at `https://caf-core.fly.dev/admin/workbench` (not a separate Vercel deploy). Ship Review changes with `fly deploy -a caf-core` from repo root.

---

## 3. End-to-end funnel

### Stage map

| Stage | Trigger | Main files | DB tables | Input → output | Status change | Failure modes | Operator surface |
|-------|---------|------------|-----------|----------------|---------------|---------------|------------------|
| **Evidence upload** | `POST /v1/inputs-evidence/upload` | `inputs-evidence.ts`, repos | `inputs_evidence_imports`, `inputs_evidence_rows` | XLSX → normalized rows | import status | Parse errors, sparse rows | Admin inputs, Review proxy |
| **Scraper runs** | `POST /v1/inputs-sources/...` | `inputs-scrapers.ts` | `inputs_scraper_runs`, `inputs_source_rows` | Apify/HTML → evidence shape | run status | Apify failures | Admin |
| **Insights passes** | `POST /v1/inputs-processing/.../run-*` | `inputs-processing.ts` | `inputs_evidence_row_insights` | Rows → tier insights | pass progress | LLM/vision timeouts | Admin |
| **Signal pack build** | `POST .../build-signal-pack` | processing + signal-packs | `signal_packs`, `ideas` | Import/idea list → pack JSON | pack created | Empty insights | Admin, API |
| **Run create** | `POST /v1/runs` | `runs.ts`, `run-orchestrator.ts` | `runs` | project + signal_pack_id | `CREATED` | Missing pack | Admin, API |
| **Materialize jobs** | `POST .../jobs` or `.../candidates` | `runs.ts`, `run-candidates-materialize.ts` | `runs.planned_jobs_json` | pack → planned rows | — | No ideas | Admin, CLI |
| **Start run** | `POST .../start` | `run-orchestrator.ts` | `content_jobs`, `runs` | planned → jobs | `PLANNING`→`PLANNED`→`GENERATING` | No flows enabled | Admin, `process-run` CLI |
| **LLM generation** | pipeline auto / `POST .../generate` | `llm-generator.ts`, `job-pipeline.ts` | `job_drafts`, `generation_payload` | prompt → `generated_output` | `GENERATING`→`GENERATED` | Schema fail, API error | Run logs |
| **Mimic prep** | pipeline | `mimic-draft-prep.ts`, `new-visual-carousel-prep.ts` | `generation_payload.mimic_v1` | references + mode | — | Missing archive media | — |
| **QC** | pipeline auto | `qc-runtime.ts` | `generation_payload.qc_result` | output → checklist + risk | `BLOCKED`, route flags | CRITICAL risk | Job detail |
| **Render** | pipeline auto | `job-pipeline.ts`, render services | `assets`, `render_state` | payload → media URLs | `RENDERING`→`IN_REVIEW` | Provider timeout, Flux fail | Review preview |
| **Human review** | operator | Review app → Core `/decide` | `editorial_reviews` | decision + overrides | `APPROVED`/`REJECTED`/`NEEDS_EDIT` | — | `/review`, `/t/[task_id]` |
| **Rework** | `NEEDS_EDIT` | `rework-orchestrator.ts` | new draft attempt | feedback → regen | back to `GENERATING` | Rework loop cap | Review DecisionPanel |
| **Publish** | `POST .../publications/.../start` | `publications.ts`, `meta-graph-publish.ts` | `publication_placements` | approved job → platform post | `draft`→`published` | Meta API errors | `/publish` |
| **Learning** | cron / manual APIs | `learning.ts`, `editorial-learning.ts` | `learning_rules`, `learning_observations` | outcomes → rules | `pending`→`active` | — | `/learning` |

### Run lifecycle (exact strings)

`CREATED` → `PLANNING` → `PLANNED` → `GENERATING` → (`RENDERING`) → (`REVIEWING`) → `COMPLETED` | `FAILED` | `CANCELLED`

Set in: `migrations/002_project_config_and_runs.sql`, `src/repositories/runs.ts`, `run-orchestrator.ts`, `job-pipeline.ts`, `runs.ts`.

### Job lifecycle (exact strings — no DB CHECK on `content_jobs.status`)

`PLANNED` → `GENERATING` → `GENERATED` → (`RENDERING`) → `IN_REVIEW` | `BLOCKED` | `REJECTED` | `NEEDS_EDIT` | `APPROVED` | `FAILED`

Also observed: `READY_FOR_REVIEW` (legacy progress counting), `QC_FAILED` (only `pipeline.ts` `/full` endpoint, not main pipeline).

---

## 4. Domain model and IDs

### Entities

| Entity | Description | Primary key pattern |
|--------|-------------|---------------------|
| **Project** | Named content brand | `project_id` (uuid), `project_slug` (text, e.g. `SNS`) |
| **Run** | One execution cycle | `run_id` = `{PROJECT}_{period}` e.g. `SNS_2026W09` |
| **Signal pack** | Research bundle for a run | `signal_pack_id` (uuid/text per schema) |
| **Candidate / planned row** | Idea × flow in memory or `planned_jobs_json` | `candidate_id` = `{run_id}_{platform}_{NNNN}` or `{base}_{flow_type}` |
| **Content job** | Atomic executable unit | `task_id` = `{run_id}__{platform}__{flow_type}__row{NNNN}__{variation}` |
| **Job draft** | One LLM attempt | `draft_id` = `d_{random12}` |
| **Asset** | Rendered media artifact | `asset_id` = `{candidate_id}__{ASSET_TYPE}_v{version}` |
| **Editorial review** | Human decision | `(project_id, task_id, review_id)` |
| **Publication placement** | Scheduled post | uuid row in `publication_placements` |
| **Learning rule** | Structured behavior change | uuid in `learning_rules` |
| **Evidence import** | XLSX/scraper batch | `inputs_evidence_imports.id` |
| **Evidence row** | Single post/account row | per import |
| **Evidence insight** | Tier analysis on a row | `inputs_evidence_row_insights` |
| **Creative intelligence asset** | Archived top-performer media | `creative_intelligence_assets` |
| **Brand bible** | BVS source per project | `brand_bibles` versioned rows |
| **Brand profile** | Marketer voice/strategy | `brand_profiles` |

### Join pattern

All job-related tables join on **`(project_id, task_id)`** — text IDs, not UUID FKs to `content_jobs`.

### Legacy / dual-write

| Legacy | Canonical | Helper |
|--------|-----------|--------|
| `runs.candidates_json` | `runs.planned_jobs_json` | `readRunPlannedJobsJson()` in `jobs-json-compat.ts` |
| `signal_packs.ideas_json` | structured idea tables | both may coexist |
| Old flow type names | `canonical-flow-types.ts` | `LEGACY_FLOW_TYPE_TO_CANONICAL` |

---

## 5. Database schema map

Grouped by domain (79 migrations through `078_brand_bibles.sql`):

### Core pipeline
`projects`, `runs`, `content_jobs`, `job_drafts`, `assets`, `job_state_transitions`, `signal_packs`, `signal_pack_ideas`, `signal_pack_selected_ideas`, `ideas`, `idea_grounding_insights`

**Writers:** `run-orchestrator.ts`, `job-pipeline.ts`, `runs.ts`  
**Readers:** all routes keyed by `task_id`

### Review / QC / validation
`editorial_reviews`, `diagnostic_audits`, `auto_validation_results`, `qc_checklists`, `qc_flow_profiles`

**Writers:** `validation-router.ts`, review routes, `qc-runtime.ts` (payload only)

### Flow engine / prompts
`flow_definitions`, `prompts`, `prompt_versions`, `prompt_schemas`, `carousel_templates`, `risk_policies`

**Writers:** migrations seed, `flow-engine.ts` admin  
**Readers:** `llm-generator.ts`, `qc-runtime.ts`

### Project configuration
`project_strategy`, `brand_constraints`, `product_profiles`, `platform_constraints`, `project_system_constraints`, `project_brand_assets`, `brand_profiles`, `brand_bibles`, `heygen_config`, `project_integrations`, `risk_rules` (not QC-enforced)

### Inputs / evidence
`inputs_evidence_imports`, `inputs_evidence_rows`, `inputs_evidence_row_insights`, `inputs_evidence_packs`, `inputs_processing_profiles`, `inputs_source_rows`, `inputs_scraper_config`, `inputs_scraper_runs`, `inputs_idea_lists`, `inputs_ideas`, `evidence_media_assets`, `insights_packs`

### Creative intelligence / mimic
`creative_intelligence_assets`, `creative_intelligence_analyses`, `creative_intelligence_insights` (migration 055+)

### Learning / performance
`learning_rules`, `suppression_rules`, `learning_observations`, `learning_hypotheses`, `learning_insights`, `learning_generation_attribution`, `performance_metrics`, `performance_ingestion_batches`, `run_content_outcomes`, `job_outcomes` (075), `llm_approval_reviews`

### Publishing
`publication_placements`, `project_integrations`

### Operations / audit
`api_call_audit`, `run_context_snapshots`, `run_output_reviews`

---

## 6. Lifecycle map

### Runs
See §3. Terminal: `COMPLETED`, `FAILED`, `CANCELLED`.

### Content jobs
See §3. Editorial terminal: `APPROVED`, `REJECTED`. Rework re-enters `GENERATING`.

### Editorial decisions (`editorial_reviews.decision`)
`APPROVED` | `NEEDS_EDIT` | `REJECTED`

### Publication placements
`draft` → `scheduled` → `publishing` → `published` | `failed` | `cancelled`

### Learning rules
`pending` → `active` | `superseded` | `rejected` | `expired`

### Provider render state (`generation_payload.render_state`)
HeyGen: `video_id`, `session_id` — retry guard via `hasActiveProviderSession()` (`content-job-render-state.ts`).  
Scene assembly: `scene_bundle` progress, Sora job IDs.  
Carousel: `isCarouselRenderComplete()`.

### QC recommended routes (`qc_result.recommended_route`)
`AUTO_PUBLISH` | `BLOCKED` | `DISCARD` | `REWORK_REQUIRED` | `HUMAN_REVIEW`  
Default `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC=true` remaps clean QC to `HUMAN_REVIEW`.

---

## 7. Critical JSON contracts

### `content_jobs.generation_payload` (main integration contract)

| Slice | Meaning | Read/write helpers |
|-------|---------|-------------------|
| Plan-time base | `schema_version`, `signal_pack_id`, `candidate_data`, prompt binding | `buildPlannedGenerationPayloadBase()` (`stage-contract.ts`) |
| `generated_output` | LLM output body | `pickGeneratedOutput()`, `hasGeneratedOutput()` |
| `qc_result` | QC pass/fail, findings, route | `pickStoredQcResult()`, **`mergeGenerationPayloadQc()`** (only writer) |
| `render_state` | Provider sessions, carousel progress | `pickRenderState()`, `hasActiveProviderSession()`, `isMidProviderPhase()` |
| `mimic_v1` | Mimic render truth | `pickMimicPayload()`, `MIMIC_PAYLOAD_KEY` |
| `mimic_carousel_package` | Draft package for TP-grounded carousels | `pickMimicCarouselDraftPackage()` — all `isTpGroundedCarouselRenderFlow()` |
| `carousel_package` | Standard `FLOW_CAROUSEL` only | `draft-package-contract.ts` |
| `bvs_v1` | Frozen brand bible snapshot | `parseBvsV1()`, `attachBvsToPlannedPayload()` |
| `mimic_job_grounding` | Plan-time mimic grounding | `mimic-job-grounding.ts` |
| `semantic_contract_v1` | Cross-flow semantic constraints | `semantic-contract.ts` |
| `content_display` | Display metadata for Review | `content-display-metadata.ts` |
| `layout_qc` | Post-render layout QA blob | `mimic-composite-layout-qa.ts` |
| `docai_layer_positions` | Inside `mimic_v1` — reviewer text boxes | `mimic-docai-layer-positions.ts` |
| `scene_bundle` | Scene assembly progress | scene-pipeline types |
| `schema_validation_warnings` | Non-fatal LLM schema issues | when `CAF_OUTPUT_SCHEMA_VALIDATION_MODE=warn` |
| Publish snapshots | URLs after approval | `validation-router.ts` |

### `mimic_v1` key fields

```typescript
// src/domain/mimic-payload.ts (abridged)
{
  schema_version: 1,
  execution_mode?: "classic" | "why_mimic" | "new_visual",
  mode: "image_full" | "template_bg" | "carousel_visual",
  reference_items[], visual_guideline, slide_plans[],
  flux_image_prompts?, docai_layer_positions?,
  bvs_enabled?, bvs_bible_snapshot?, bvs_render_plan?,
  slide_intelligence?, brand_execution_brief?
}
```

### `bvs_v1` key fields

```typescript
// src/domain/bvs-v1.ts
{ schema_version: "bvs_v1", enabled: boolean, bible_version, bible_snapshot }
```

### Signal pack JSON (high-signal fields)

- `overall_candidates_json` — raw idea rows
- `visual_guidelines_pack_v1` — merged styling for mimic
- `mimic_mode_overrides` — per-insight reviewer mode overrides
- `derived_globals_json` — CI styling merge output

### Risky untyped areas

- Ad-hoc reads of `candidate_data` nested fields in Review components
- Legacy `ideas_json` on older signal packs
- `render_manifest` (commented in migrations, sparse usage)
- Some admin HTML forms bypass typed helpers

---

## 8. Flow types and content formats

### Canonical text/copy flows (`canonical-flow-types.ts`)
`FLOW_CAROUSEL`, `FLOW_ANGLE`, `FLOW_STRUCTURE`, `FLOW_CTA`, `FLOW_HOOKS`, `FLOW_TEXT`

### Video flows
| Flow | Status | Generate | Render | Review |
|------|--------|----------|--------|--------|
| `FLOW_VID_SCRIPT` | Production | OpenAI script | HeyGen | Video edits panel |
| `FLOW_VID_PROMPT` | Production | OpenAI prompt | HeyGen Video Agent | HeyGenReviewEdits |
| `FLOW_VID_PROMPT_NO_AVATAR` | Production | OpenAI | HeyGen no-avatar | HeyGenReviewEdits |
| `FLOW_VID_SCENES` / `FLOW_SCENE_ASSEMBLY` | Provider-dependent | Scene scripts | Sora clips + ffmpeg concat | Video review |
| `FLOW_PRODUCT_*` (6 types) | Production | Product prompts | HeyGen | Video review |

### Carousel flows
| Flow | Status | Notes |
|------|--------|-------|
| `FLOW_CAROUSEL` | Production | `carousel_package`, HBS templates, `CarouselBrandStylingPanel` |
| `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` | Production (gated render) | `mimic_v1`, reference frames, compare UI in Review |
| `FLOW_VISUAL_FIRST_CAROUSEL` | Production (evolving) | **`execution_mode: "new_visual"`** — no TP references, BVS-driven |
| `FLOW_WHY_MIMIC_CAROUSEL` | Production (newer) | SIL-driven, `execution_mode: "why_mimic"` |
| `FLOW_TOP_PERFORMER_MIMIC_IMAGE` | Gated | `image_full` mode, single frame |
| `FLOW_TOP_PERFORMER_MIMIC_VIDEO` | Alias | Routes to HeyGen video planning |

### Product image flows (`FLOW_IMG_*`)
Registered in flow engine; **blocked at LLM** with `PRODUCT_IMAGE_FLOW_NOT_READY_MESSAGE`.

### Offline / excluded (`offline-flow-types.ts`)
`Reel_Script`, `FLOW_REEL_SCRIPT`, hook variation flows — excluded from planning.

### Per-flow requirements

| Flow family | Env / config |
|-------------|--------------|
| Mimic carousel | `MIMIC_IMAGE_ENABLED=1`, provider API key, archived reference media (except new_visual) |
| New visual | BVS recommended; `analysis_t2i` input mode |
| HeyGen | `HEYGEN_API_KEY`, project `heygen_config` |
| Scene assembly | `OPENAI_API_KEY`, `SCENE_ASSEMBLY_CLIP_PROVIDER`, `VIDEO_ASSEMBLY_BASE_URL` |
| Standard carousel | `RENDERER_BASE_URL`, templates |

---

## 9. Review app and operator workflow

### Architecture
- **Next.js** in `apps/review/` — **client only**
- All data via `caf-core-client.ts` → `${CAF_CORE_URL}/v1/...`
- 78 proxy routes under `apps/review/src/app/api/`
- Embedded in Core Fly image at `/admin/workbench`

### Two audiences
1. **Marketer:** `/workspace` → `/brand/[slug]/*` (profile, research, ideas, content, publishing, performance)
2. **Operator:** `/review`, `/runs`, `/pipeline`, `/publish`, `/learning` (enable via `?debug=1` or operator sidebar)

### Queue and job detail
- `GET /api/tasks` → Core review queue
- `GET /api/task/[task_id]` → full job + assets + payload slices
- `TaskReviewClient.tsx` orchestrates viewers and edit panels

### Carousel editing (`FLOW_CAROUSEL`)
- `CarouselSlider.tsx` — live preview via `/api/renderer/preview-live-slide`
- `CarouselEdits.tsx` + `CarouselBrandStylingPanel.tsx` — typography, palette, logo, frame
- Rework overrides sent on decision

### Mimic carousel editing (TP-grounded flows)
- `MimicCarouselLayerEditorPanel.tsx` — 3-column: copy | DocAI layer editor | typography/BVS
- **Save layout** → `mimic-docai-layer-positions`
- **Reprint text** (cheap) → `reprint-text-overlay` — Puppeteer on stored plates
- **Regenerate slides** (expensive) → Flux/Qwen when picture is wrong
- `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`: original vs generated compare
- `FLOW_VISUAL_FIRST_CAROUSEL`: same editor, **no** compare row

### Decisions (`DecisionPanel.tsx`)
`APPROVED` | `NEEDS_EDIT` | `REJECTED` → Core `/v1/review-queue/:slug/decide`  
Auto-upgrades `APPROVED` → `NEEDS_EDIT` if unsaved edits exist.

### Rework options
`rewrite_copy`, `regenerate`, `carousel_rework_change_template`, `slide_rework_indices`, skip video/image regen flags.

### Publishing UI
`/publish` — schedule placements, n8n payload export, Meta start (when configured).

### Learning UI
`/learning/*` — rule inbox, apply/retire, context preview, analyzers, observatory.

### Review owns vs Core owns
| Review owns | Core owns |
|-------------|-----------|
| UX, live preview assembly | `content_jobs.status`, `generation_payload` |
| Proxy auth headers | QC, render orchestration |
| Background job toasts (polling) | `editorial_reviews`, `assets` rows |
| Marketer funnel navigation | Publication execution |

### Contract guard
`src/routes/review-contract.test.ts` — every `REVIEW_CRITICAL_PATHS` must exist in Core routes (CI breakage detector).

### Env
`CAF_CORE_URL`, `CAF_CORE_TOKEN`, `PROJECT_SLUG`, `REVIEW_WRITE_TOKEN`, `RENDERER_BASE_URL`, `NEXT_PUBLIC_APP_URL`

---

## 10. Inputs pipeline and signal pack creation

### Implemented
1. XLSX upload → `inputs_evidence_imports` + rows
2. Scraper config/runs (Apify) → same evidence shape
3. Evidence packs (multi-platform)
4. Processing profile (criteria, models, caps)
5. Insight tiers: `broad_llm`, `top_performer_deep`, `top_performer_video`, `top_performer_carousel`
6. Document AI OCR on carousel tiers
7. Rating/synthesis → `overall_candidates_json`
8. Idea lists (`inputs_idea_lists`, `inputs_ideas`)
9. Signal pack build (from import or idea list)
10. RTP summary, QC flow profiles, API audit

### Partial / TBD (from roadmap + code)
- Structured Stage-3 idea picker at plan time (idea lists exist; full planner UX incomplete)
- Rich explainable idea scoring with brand/risk eligibility gates
- Persist `decideGenerationPlan` I/O snapshot per run
- Optional persisted candidate audit rows
- HTML/platform summary folding
- Review app: upload + inspect only (no processing controls)

### Signal pack → run
`POST /v1/runs` with `signal_pack_id` → materialize `planned_jobs_json` → `startRun()` → `content_jobs` at `PLANNED`.

---

## 11. Creative intelligence and mimic system

### Top-performer ingest
`src/routes/creative-intelligence.ts` — ingest assets, run vision analysis, store insights, styling packs, mimic-carousel-template mint/apply.

Tables: `creative_intelligence_assets`, analyses, insights (migration 055+).

### Visual guidelines on signal packs
`visual_guidelines_pack_v1` merged into generation creation pack; `derived_globals_json` from styling merge.

### Mimic reference resolution (`mimic-draft-prep.ts`)
- Archives frames from CI assets
- Filters promo/video slides
- Builds `reference_items`, `slide_plans`, `visual_guideline`
- **New visual bypasses this** (`new-visual-carousel-prep.ts`)

### Mode classification (`mimic-mode-classifier.ts`)
Priority: reviewer override → Nemotron `mimic_evaluation` → heuristics (`mimic-text-heavy.ts`)

| Mode | Visual strategy | Text strategy |
|------|-----------------|---------------|
| `template_bg` | Background plate (reference strip or BVS-invented T2I) | HBS/DocAI overlay |
| `carousel_visual` | Per-slide art-only plate (`full_bleed`) | HBS/DocAI overlay |
| `image_full` | Single image-edit pass | Copy on-image from LLM |

### Execution modes on `mimic_v1`
| `execution_mode` | Flow | Behavior |
|------------------|------|----------|
| `classic` | `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` | TP fidelity + references |
| `why_mimic` | `FLOW_WHY_MIMIC_CAROUSEL` | SIL-driven strategic copy/prompts |
| `new_visual` | `FLOW_VISUAL_FIRST_CAROUSEL` | Idea+BVS, empty references, always `carousel_visual` |

### Brand Visual System (BVS)

**Brand bible** (`brand_bibles` table, `brand_bible_v1` schema):
- Visual mode, palette, motifs, asset roles (`slide_frame`, `logo`, `style_reference`, …)
- `application_guide.mimic_policy` / `original_policy`
- API: brand bible CRUD on review-queue routes

**Job snapshot** (`generation_payload.bvs_v1`):
- Stamped at plan when `candidate_data.use_brand_visual_system === true`
- Visual-first lane defaults BVS on
- `bvs_render_plan` on `mimic_v1` for `template_bg` invented plates

**Render overlays** (`bvs-render-overlays.ts`):
- Logo/frame auto-overlay for `template_bg` + `bvs_enabled`
- Palette injection into carousel theme colors

### Text overlay / DocAI / reprint

**Invariant:** TP-grounded carousels do **not** bake LLM copy into Flux (`mimicCarouselTextViaFlux` hardcoded false in `job-pipeline.ts`).

Pipeline:
```
Art-only plate → DocAI seed from reference OCR → Puppeteer HBS
  → reviewer docai_layer_positions → reprint-text-overlay → CAROUSEL_IMAGE assets
```

Templates: `carousel_mimic_bg.hbs`, `MIMIC_FULL_BLEED_RENDER_TEMPLATE`.

**Layout QA loop** (`mimic-post-render-layout-loop.ts`): optional automated reposition + reprint (`MIMIC_LAYOUT_QA_*`).  
**Composite saliency QA** (full automation): documented in `MIMIC_TEXT_PLACEMENT_AUTOMATION.md`, **not implemented**.

### Automated vs manual

| Automated | Manual |
|-----------|--------|
| CI ingest + vision | TP selection for ingest |
| Mode classification | `mimic_mode_overrides` on signal pack |
| Reference resolve + plate generation | Brand bible editing |
| DocAI box seed | Layer editor geometry |
| Optional plate text QA + layout QA reprint | Editorial approve/reject |
| BVS snapshot at plan | Per-slide Flux regen when picture wrong |

### Current limitations
- `MIMIC_IMAGE_ENABLED=false` by default — render blocked without explicit enable
- New visual docs still describe old TP-grounded model in places
- Duplicate migration prefix `071_*` (slide intelligence + new visual prompt)
- Why Mimic requires substantive SIL (`WHY_MIMIC_REQUIRE_SUBSTANTIVE_SIL`)

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
| **MIMIC_FLOWS_COMPLETE_GUIDE.md** | Updated July 2026 — still verify against current-state pack for edge cases |
| **CREATIVE_INTELLIGENCE.md** | Updated downstream lanes (SIL, new visual, Why Mimic, BVS) |
| **MIMIC_IMAGE_FLOWS.md** | Rewritten July 2026 |
| **CAF_CORE_COMPLETE_GUIDE.md** | Updated July 2026 — points to current-state pack for latest truth |
| **DATABASE_SCHEMA.md** | Updated through migration 078 |
| **JOB_LIFECYCLE.md** | Updated `QC_FAILED` / `READY_FOR_REVIEW` notes |

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

### Suggested update priority (remaining)
1. **`visual-first-carousel-flow-types.ts` header comment** — align with `new_visual` semantics
2. **`docs/layers/*.md`** — spot-check when touching those layers (orchestration + generation updated July 2026)
3. Regenerate PDFs after doc edits: `npm run export:doc-pdfs`

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
