# CAF Current State Context Pack — Operators Mimic and BVS

**Volume 3 of 4** | Generated 2026-07-10 | Full pack: docs/CAF_CURRENT_STATE_CONTEXT_PACK.md

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
