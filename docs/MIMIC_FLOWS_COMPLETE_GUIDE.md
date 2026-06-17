# CAF Core — Top-Performer Mimic Flows (Complete Guide)

**Version:** CAF Core repository snapshot (June 2026)  
**Audience:** Operators, engineers, and AI assistants (e.g. ChatGPT project folders)  
**Scope:** `FLOW_TOP_PERFORMER_MIMIC_IMAGE`, `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`, and their upstream/downstream dependencies

---

## 1. Executive summary

**Mimic flows** are optional CAF pipeline lanes that recreate the **visual pattern** of archived **top-performer** social posts while generating **fresh copy** aligned to the brand and the current signal-pack idea. They are **not** pixel-perfect clones: logos, faces, and copyrighted imagery are explicitly excluded (`twist_brief.visual_only`).

The system splits work into two phases:

1. **Generate (copy)** — OpenAI LLM writes caption, hashtags, and slide text faithful to the reference *structure* (hook device, pacing, CTA shape).
2. **Render (visual)** — Image models (BFL FLUX, DashScope Qwen, NVIDIA NIM, or OpenAI `gpt-image-1`) produce plates; Puppeteer Handlebars templates or Sharp compositing overlay the LLM copy with typography derived from upstream vision analysis (Nemotron / Document AI).

Mimic flows sit in the standard CAF funnel:

```
Signal Pack → Candidates → Decision Engine → Content Job → Draft → Render → Review → Publish
```

Each mimic job is keyed by **`task_id`** like any other content job. Render metadata lives on **`generation_payload.mimic_v1`** (source of truth for render). Carousel mimic jobs additionally snapshot **`draft_package_snapshot`** with `package_type: "mimic_carousel_package"` — this is **distinct** from normal `FLOW_CAROUSEL` / `carousel_package`.

---

## 2. Flow types

| Flow type | Platform format | Reference tier | When to use |
|-----------|-----------------|----------------|-------------|
| `FLOW_TOP_PERFORMER_MIMIC_IMAGE` | Single post (`post`) | `top_performer_deep` | Idea grounded to a top performer with **exactly one** archived reference frame |
| `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` | Carousel | `top_performer_carousel` | **Manual mimic picks** (Mimic · Carousel tab) with **2+** archived frames |
| `FLOW_VISUAL_FIRST_CAROUSEL` | Carousel | `top_performer_carousel` | **Ideas-from-insights** with `carousel_style: visual_first` or `mixed` — separate product lane, same render engine |
| `FLOW_TOP_PERFORMER_MIMIC_VIDEO` | Video | `top_performer_video` | **Planning alias only** — manual video picks route to HeyGen (`FLOW_VID_SCRIPT` / `FLOW_VID_PROMPT` / `FLOW_VID_PROMPT_NO_AVATAR`) from Nemotron `format_pattern`; no pixel mimic render |

**Routing rules:**

- Image mimic **fails early** if more than one reference frame resolves.
- Carousel mimic handles multi-slide archives, video-slide skipping, and promotional-slide filtering.
- **Video top performers** do not use pixel mimic — Nemotron `top_performer_video` insights route to **HeyGen** via `resolveTopPerformerVideoHeygenRoute()` (`src/domain/top-performer-video-heygen-routing.ts`). Creation packs include `top_performer_video_knowledge` when jobs ground to video insights.
- **Visual-first carousel ideas** (`carousel_style: visual_first` or `mixed`) grounded to `top_performer_carousel` with archived slides plan **`FLOW_VISUAL_FIRST_CAROUSEL`** when enabled (`shouldExpandVisualFirstCarouselForRow()`). **Review:** TP-grounded workbench (layer editor, slide regen) — **no** original-vs-generated compare.
- **Manual mimic carousel picks** plan **`FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`** (`shouldExpandMimicCarouselPickForRow()`). **Review:** same workbench **plus** original-vs-generated compare.
- Mimic flows use **separate planning lanes** (`mimic_image`, `mimic_carousel`, `visual_first_carousel`) so they can run **in parallel** with standard `FLOW_CAROUSEL` without sharing the `max_carousel_jobs_per_run` cap.

**Code:** `src/domain/top-performer-mimic-flow-types.ts`, `src/decision_engine/format-routing.ts`

---

## 3. Prerequisites (data + configuration)

### 3.1 Upstream data

1. **Top-performer ingest** — Creative Intelligence pipeline archives inspection media to Supabase (`stored_inspection_media_json` on visual-guidelines entries). See `docs/CREATIVE_INTELLIGENCE.md`.
2. **Signal pack** with `derived_globals_json.visual_guidelines_pack_v1` — per-insight rows carrying aesthetic analysis, slide transcripts, `mimic_evaluation`, and archived media paths.
3. **Ideas grounded** to top-performer `insights_id` values (`ideas_json[].grounding_insight_ids`). Each insight id may ground **at most one** idea.
4. For image mimic expansion at planning time: either explicit `target_flow_type`, `manual_mimic_pick` with `mimic_kind: "image"`, or eligibility via `mimicImageReferenceEligible()` (single-frame deep reference).

### 3.2 Environment flags

| Variable | Default | Purpose |
|----------|---------|---------|
| `MIMIC_IMAGE_ENABLED` | `false` | Master switch — mimic draft/render paths stay off when false |
| `MIMIC_IMAGE_PROVIDER` | `bfl` | `bfl` \| `dashscope` \| `nvidia` \| `openai` |
| `MIMIC_IMAGE_BFL_MODEL` | `flux-2-klein-4b` | BFL model slug (`flux-2-flex` for typography-tuned) |
| `MIMIC_VISUAL_SIMILARITY_PCT` | `70` | How closely reference_edit should follow pixels (≤25% → low fidelity on OpenAI) |
| `MIMIC_IMAGE_INPUT_MODE` | `reference_edit` | `reference_edit` (image-to-image) or `analysis_t2i` (text-to-image from Flux prompts) |
| `MIMIC_IMAGE_DEFAULT_SIZE` | `1024x1536` | Instagram portrait default |
| `OPENAI_API_KEY` | — | Required for **copy** generation (all mimic flows) |
| Provider API keys | — | `BFL_API_KEY`, `DASHSCOPE_API_KEY`, `NVIDIA_NIM_API_KEY`, or `OPENAI_API_KEY` for render |

### 3.3 Project settings

- Enable `FLOW_TOP_PERFORMER_MIMIC_IMAGE`, `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`, and/or `FLOW_VISUAL_FIRST_CAROUSEL` in allowed flow types.
- Set plan cap **> 0** for the mimic flow (flows are seeded **disabled** via `seedMimicFlowTypesSkeleton()`).
- Optional per-project overrides in `project_system_constraints`: `mimic_image_bfl_model`, `mimic_visual_similarity_pct`, `mimic_carousel_text_via_flux`, `mimic_image_input_mode`.

**Migrations:** `060_mimic_flow_types.sql`, `061_mimic_flow_prompts.sql`, `062`–`069` (copy rules, grounding, BFL model, render settings).

---

## 4. Core payload contracts

### 4.1 `generation_payload.mimic_v1` (render source of truth)

Written during **mimic prep** (before or after LLM, depending on step). Consumed at **render**.

| Field | Meaning |
|-------|---------|
| `mode` | `image_full` \| `template_bg` \| `carousel_visual` |
| `mode_override` | Reviewer override from signal pack (`mimic_mode_overrides`) |
| `source_insights_id` | Top-performer insight this job mimics |
| `reference_items[]` | Archived frames: `vision_fetch_url`, `bucket`, `object_path`, `source_slide_index` |
| `archive_reference_items[]` | Full deck before promo/video filtering |
| `slide_plans[]` | Per output slide: `render_mode` (`hbs` \| `full_bleed`), `reference_index` |
| `visual_guideline` | Slim vision row (no signed URLs) |
| `twist_brief` | `{ visual_only: true, legal_note }` |
| `docai_layer_positions` | Reviewer layout edits (preserved across re-renders) |
| `flux_image_prompts` | Per-slide T2I prompts when `image_input_mode = analysis_t2i` |

**Code:** `src/domain/mimic-payload.ts`

### 4.2 `mimic_carousel_package` (review / operator snapshot)

**Only** `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`. Stored in `draft_package_snapshot`:

| Slice | Content |
|-------|---------|
| `copy` | LLM slides, caption, hashtags |
| `render_plan` | `strategy`: `template_background` or `per_slide_mimic` |
| `visual_reference` | Storage paths, `reference_items` |
| `visual_guideline` | Format pattern, deck system, `mimic_evaluation`, per-slide cues |
| `twist_brief` | Legal / visual-only note |

`mimic_v1` remains authoritative for render; the package is for Review UI, content log, and operators.

**Code:** `src/domain/mimic-carousel-package.ts`, `src/services/draft-package-contract.ts`

### 4.3 Supporting payload keys

| Key | When set | Purpose |
|-----|----------|---------|
| `mimic_render_context` | Before LLM | Slide count targets, `copy_before_visual_mimic`, template path hints |
| `mimic_job_grounding` | Before LLM | `slide_copy_layout` — per-slide reference text, typography, copy slots |
| `template_storage_decision` | Before LLM | Whether backgrounds go to project template library |
| `template_backgrounds_prepared_at` | Pre-copy (template_bg) | Background plates extracted before copy gen |
| `candidate_data` | Planning | `grounding_insight_ids`, `idea_id` for lineage |

---

## 5. Mimic modes and render strategies

### 5.1 Mode classification

`classifyMimicMode()` (`src/services/mimic-mode-classifier.ts`) picks the render path:

**Priority:**

1. Manual `mode_override` (reviewer on signal pack)
2. Nemotron `mimic_evaluation.recommended_mode`:
   - `text_on_template` → `template_bg`
   - `full_bleed_visual` → `carousel_visual`
3. Heuristic fallback (text density, `format_pattern`, unified background cues)

| Mode | Typical reference | Render approach |
|------|-------------------|-----------------|
| `image_full` | 1 frame | Single `STATIC_IMAGE` via image edit; on-image copy from LLM |
| `template_bg` | Text-heavy listicle / educational | Extract background plates → HBS (`carousel_mimic_bg.hbs`) or Sharp composite + text overlay |
| `carousel_visual` | Image-led / mixed deck | Per-slide art-only mimic (~70% similarity default) + HBS text overlay where `on_screen_text_transcript` exists |

**Slide render modes:**

- `hbs` — Puppeteer Handlebars template overlays LLM copy; typography from Nemotron `text_blocks` + Document AI merge.
- `full_bleed` — Art-only image model output (no baked-in text); copy overlaid in a later HBS/DocAI step if needed.

Slides with **any** on-screen text transcript use **hbs**, not image-model typography.

### 5.2 Render plan strategies (carousel package)

| `render_plan.strategy` | `mimic_v1.mode` | Behavior |
|------------------------|-----------------|----------|
| `template_background` | `template_bg` | Reuse/extract bg plate → overlay text |
| `per_slide_mimic` | `carousel_visual` | Per-slide visual plate, then text overlay |

---

## 6. End-to-end pipeline (operator workflow)

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 1. PLAN RUN                                                              │
│    Mimic candidates compete in parallel with FLOW_CAROUSEL when enabled  │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 2. RESOLVE REFERENCE (before LLM)                                        │
│    resolveMimicReferenceFromLineage → mimic_v1 + mimic_render_context  │
│    + template_storage_decision                                           │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                    ┌───────────────┴───────────────┐
                    ▼                               ▼
     ┌──────────────────────────┐    ┌──────────────────────────┐
     │ 3a. TEMPLATE BACKGROUNDS │    │ 3b. (carousel_visual)    │
     │ (template_bg only)       │    │ Skip pre-copy bg extract │
     │ Qwen/BFL strip text →    │    │                          │
     │ MIMIC_BACKGROUND assets  │    │                          │
     └──────────────────────────┘    └──────────────────────────┘
                    │                               │
                    └───────────────┬───────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 4. GENERATE JOBS (OpenAI copy)                                           │
│    • template_bg: full slide copy                                        │
│    • full_bleed: caption/hashtags + short hooks                          │
│    • mimic_carousel_package snapshot                                     │
│    Status → GENERATED                                                    │
└─────────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 5. REVIEW (copy + mimic metadata — often no final assets yet)            │
│    Review app: MimicCarouselEdits, mode overrides, DocAI layer editor    │
└─────────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│ 6. RENDER                                                                │
│    • template_bg: bg plate + HBS/DocAI text layers                        │
│    • carousel_visual: per-slide plates + overlays                        │
│    • image_full: single image edit with on-image copy                    │
│    Status → IN_REVIEW (pending human approval)                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### 6.1 Key functions by stage

| Stage | Primary modules |
|-------|-----------------|
| Reference resolve | `mimic-reference-resolver.ts`, `mimic-reference-eligibility.ts` |
| Pre-copy prep | `ensureMimicReferenceBeforeCopyGeneration`, `ensureMimicTemplateBackgroundsBeforeCopy` in `mimic-draft-prep.ts` |
| LLM copy | `llm-generator.ts`, `carousel-mimic-copy-policy.ts`, `mimic-copy-coherence.ts` |
| Post-copy snapshot | `prepareMimicDraftPackage` in `mimic-draft-prep.ts` |
| Carousel render | `mimic-carousel-render.ts`, `mimic-template-bg-render.ts`, `mimic-docai-overlay-layout.ts` |
| Image render | `mimic-image-job.ts`, `mimic-image-provider.ts` |
| Orchestration | `job-pipeline.ts` |

---

## 7. Reference resolution (deep dive)

### 7.1 Lineage

Every mimic job links to a **signal pack** via `generation_payload` lineage (`getJobLineageByTaskId`). Resolution uses:

1. `candidate_data.grounding_insight_ids` (preferred), or
2. Job grounding rows from the signal pack.

### 7.2 Analysis tiers

| Flow | Expected tier | Fallback |
|------|---------------|----------|
| Image mimic | `top_performer_deep` | `top_performer_carousel` (flagged `reference_tier_fallback`) |
| Carousel mimic | `top_performer_carousel` | none |

Image mimic **skips** entries with **>1** reference frame.

### 7.3 Reference items

Archived frames come from `stored_inspection_media_json` / `inspection_media` on the visual-guidelines entry. Each item carries:

- `vision_fetch_url` — fetch at render (re-signed from `bucket` + `object_path` when URLs expire)
- `source_slide_index` — 1-based position in original Instagram deck
- `is_video_slide` — skipped at render

`normalizeMimicReferenceItems()` enforces 1-based contiguous indexes for render plans.

### 7.4 Promotional / video slide handling

- **Video slides** — omitted from mimic reference set; indices tracked in `video_slide_indices`.
- **Promotional slides** — `filterPromotionalSlidesFromMimicPayload()` drops slides tagged `self_promo`, `product_pitch`, or high `brand_specificity`.
- **Skip indices** — `mimic_evaluation.skip_slide_indices` and `content_slide_indices` drive which slides count toward copy/render.

---

## 8. LLM copy generation (deep dive)

### 8.1 Prompt templates

Migration `061_mimic_flow_prompts.sql` seeds:

- `MIMIC__Top_Performer_Carousel_v1` → `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`
- `MIMIC__Top_Performer_Image_v1` → `FLOW_TOP_PERFORMER_MIMIC_IMAGE`

Both **inherit the FLOW_CAROUSEL output schema** so QC and validation stay unchanged.

### 8.2 Signal pack budgeting (mimic-only)

Mimic prompts are large (vision grounding + top-performer knowledge). **Do not pass full `ideas_json`** (30+ rows). Required behavior:

1. Filter `ideas_json` to the job's planned idea only.
2. Match `idea_id` with underscore boundaries (avoid `idea_12` matching `idea_1`).
3. Slim `visual_guidelines_pack_v1` — strip `inspection_media` / signed URLs from LLM context.
4. Cap hashtag leaderboard size.

**Code:** `llm-creation-pack-budget.ts`, `llm-generator-helpers.ts` (`mimicFlowOnly: true`)

### 8.3 Copy branches

| Mode | Copy expectation |
|------|------------------|
| `template_bg` | Full per-slide headline/body matching reference structure |
| `carousel_visual` / full_bleed | Caption, hashtags, short hooks; reference text length scaled by `MIMIC_FULL_BLEED_COPY_REFERENCE_SCALE` |
| `image_full` | Caption, hook, hashtags; on-image copy for render |

### 8.4 Grounding blocks

`mimic_job_grounding.slide_copy_layout` provides per-slide:

- `reference_on_screen_text` (structure/length guide only — output must be fresh)
- `visual_description`, `layout_template`, `text_blocks`, `copy_slots_v1`

`assertMimicCopyDiffersFromReference()` guards against verbatim copying of reference wording.

Optional: `MIMIC_COPY_COHERENCE_LLM` runs a coherence pass after generation.

### 8.5 Context guards

Mimic carousel prompts have char budgets (`LLM_MIMIC_*_MAX_CHARS`, `MIMIC_CAROUSEL_SYSTEM_PROMPT_MAX_CHARS`) with emergency shrinking in `shrinkMimicCarouselPromptsIfNeeded()`.

---

## 9. Visual render (deep dive)

### 9.1 Image providers

`mimic-image-provider.ts` abstracts:

| Provider | Typical model | Notes |
|----------|---------------|-------|
| `bfl` | `flux-2-klein-4b`, `flux-2-flex` | Default; async poll; flex supports steps/guidance |
| `dashscope` | `qwen-image-edit-max` | Alibaba; size `1024*1536` |
| `nvidia` | `qwen/qwen-image-edit` | NIM OpenAI-compatible `/images/edits` |
| `openai` | `gpt-image-1` | `input_fidelity`, `quality` |

All prompts pass through `finalizeMimicImageModelPrompt()` with **art-only guard** (no on-image text unless explicitly allowed).

### 9.2 Template background path (`template_bg`)

1. **Pre-copy** (optional): `ensureMimicTemplateBackgroundsBeforeCopy` extracts cover/body/CTA plates → assets type `MIMIC_BACKGROUND`.
2. **Reusable templates**: when `mimic_evaluation.template_storage_quality = reusable`, plates also go to project template library (`mimic-template-library.ts`).
3. **Render**: Puppeteer renders `carousel_mimic_bg.hbs` with LLM copy + Nemotron typography, **or** Sharp composite (`carousel-composite-render.ts`) when `CAROUSEL_COMPOSITE_ENABLED=true`.

### 9.3 Carousel visual path (`carousel_visual`)

1. Per slide: `generateMimicSlideImage()` with art-only prompt (`mimic-prompt-builder.ts`).
2. Reference frame selected via `referenceItemForMimicSlide()` using `source_slide_index` alignment.
3. Output assets: `MIMIC_VISUAL_PLATE` per slide.
4. Text overlay: Document AI + Nemotron merge → HBS or DocAI fit page (`mimic-docai-fit-page.ts`, `mimic-docai-text-contrast.ts`).

### 9.4 Image full path (`image_full`)

`processImageMimicJob()`:

1. Asserts single reference frame.
2. Reads on-image copy from `generated_output` (`onImageCopyForMimicRender`).
3. One image edit → `STATIC_IMAGE` asset.
4. Job status → `IN_REVIEW`.

### 9.5 Re-render and text-only reprint

Reviewers can adjust `docai_layer_positions` and trigger **text-overlay reprint** (`MIMIC_TEXT_OVERLAY_REPRINT_PHASE`) without re-running image models — requires existing `MIMIC_BACKGROUND` or `MIMIC_VISUAL_PLATE` assets.

### 9.6 `analysis_t2i` mode

When `MIMIC_IMAGE_INPUT_MODE=analysis_t2i`:

- Per-slide Flux prompts generated at copy time (`mimic-flux-image-prompts.ts`, optional `MIMIC_FLUX_PROMPT_LLM`).
- Render uses text-to-image (no reference pixels) — useful when reference edit is undesirable.

---

## 10. Planning and candidate materialization

### 10.1 Image mimic expansion guard

`shouldExpandTopPerformerMimicImageForRow()` returns true when:

- `manual_mimic_pick === true` and `mimic_kind === "image"`, or
- `target_flow_type === FLOW_TOP_PERFORMER_MIMIC_IMAGE`, or
- Grounding resolves to single-frame deep reference (`mimicImageReferenceEligible`).

Otherwise image mimic candidates are **skipped** at expansion.

### 10.2 Parallel lanes

`format-routing.ts` assigns:

- `mimic_carousel` lane for carousel mimic
- `mimic_image` lane for image mimic
- Standard `carousel` lane for `FLOW_CAROUSEL`

This allows one idea to produce both a templated carousel job and a mimic carousel job when both flows are enabled.

### 10.3 Creative intelligence boost

Ideas with `grounding_insight_ids` starting with `ci_` get higher `past_performance` score (`CREATIVE_INTEL_PLANNER_PAST_PERFORMANCE_BOOST`).

---

## 11. Review app integration (`apps/review`)

| Feature | API / component |
|---------|-----------------|
| Mimic carousel edits | `MimicCarouselEdits.tsx` |
| DocAI layer position editor | `MimicDocAiLayerPositionEditor.tsx` |
| Mode override per insight | `POST .../signal-packs/:packId/mimic-mode-override` |
| Mimic image audits | `GET .../mimic-image-audits` |
| Layer editor panel | `MimicCarouselLayerEditorPanel.tsx` |

Review app is a **client** of Core APIs — `content_jobs` in Postgres remains source of truth.

---

## 12. Asset types

| Asset type | When created |
|------------|--------------|
| `MIMIC_BACKGROUND` | Template-bg plate (cover/body/CTA) |
| `MIMIC_VISUAL_PLATE` | Per-slide art-only plate (carousel_visual) |
| `STATIC_IMAGE` | Single-frame image mimic output |
| `CAROUSEL_IMAGE` | Final composed slide images |

---

## 13. Configuration reference (extended)

| Variable | Purpose |
|----------|---------|
| `MIMIC_CAROUSEL_TEXT_VIA_FLUX` | Legacy Flux text-bake (pipeline forces DocAI/HBS overlay today) |
| `MIMIC_USE_PROJECT_BRAND_PALETTE` | Inject brand colors into mimic prompts |
| `MIMIC_USE_BRAND_IMAGE_STYLE_HINTS` | Brand image style in prompts |
| `MIMIC_FLUX_PROMPT_LLM` | OpenAI authors Flux T2I prompts |
| `MIMIC_FULL_BLEED_COPY_REFERENCE_SCALE` | Scales reference text length targets |
| `MIMIC_COPY_CHAR_SLACK` | ± chars tolerance on copy length guards |
| `MIMIC_IMAGE_BFL_FALLBACK_DASHSCOPE` | BFL failure → DashScope |
| `MIMIC_IMAGE_NVIDIA_FALLBACK_OPENAI` | NVIDIA failure → OpenAI |
| `CAROUSEL_COMPOSITE_ENABLED` | Sharp composite vs Puppeteer-only |

---

## 14. Key file map

| Area | Files |
|------|-------|
| Flow type constants | `src/domain/top-performer-mimic-flow-types.ts` |
| Payload types | `src/domain/mimic-payload.ts`, `src/domain/mimic-carousel-package.ts` |
| Mode classification | `src/services/mimic-mode-classifier.ts`, `src/domain/mimic-text-heavy.ts` |
| Reference resolve | `src/services/mimic-reference-resolver.ts` |
| Draft prep | `src/services/mimic-draft-prep.ts` |
| LLM copy | `src/services/llm-generator.ts`, `src/services/carousel-mimic-copy-policy.ts` |
| Image generation | `src/services/mimic-image-provider.ts`, `src/services/mimic-image-job.ts` |
| Carousel render | `src/services/mimic-carousel-render.ts` |
| Prompts | `src/services/mimic-prompt-builder.ts` |
| Project config | `src/services/mimic-project-config.ts` |
| Pipeline orchestration | `src/services/job-pipeline.ts` |
| HBS template | `services/renderer/templates/carousel_mimic_bg.hbs` |
| Docs | `docs/MIMIC_IMAGE_FLOWS.md`, `docs/CREATIVE_INTELLIGENCE.md` |

---

## 15. Invariants and pitfalls

1. **`task_id`** is the execution key across `content_jobs`, `assets`, `job_drafts`, reviews.
2. **`mimic_v1`** is render truth; `mimic_carousel_package` is operator/review snapshot — do not conflate with `carousel_package`.
3. **Never** pass full `ideas_json` into mimic LLM prompts.
4. **Image mimic** requires exactly one reference frame — multi-frame references must use carousel mimic.
5. **`MIMIC_IMAGE_ENABLED=0`** blocks render even if flow types are enabled on the project.
6. **Copy generation** still requires `OPENAI_API_KEY` regardless of image provider.
7. **Re-sign URLs** at render — `refreshMimicPayloadReferenceUrls()` handles expired Supabase signed URLs.
8. **Video slides** in archived carousels are never mimicked.
9. **Mode overrides** on signal packs take precedence over automatic classification.
10. **Do not double-submit** HeyGen or other provider renders — mimic uses its own render path via `job-pipeline.ts`.

---

## 16. Glossary

| Term | Definition |
|------|------------|
| Top performer | High-performing archived social post used as visual/copy reference |
| Visual guidelines pack | `visual_guidelines_pack_v1` on signal pack derived globals |
| Nemotron | NVIDIA vision model producing `aesthetic_analysis_json`, `text_blocks`, `mimic_evaluation` |
| Art-only mimic | Image model prompt forbids baking text into pixels |
| Template bg | Text-heavy deck: extract clean background, overlay fresh copy |
| Full bleed | Image-led slide: mimic visual plate, overlay text separately |
| Grounding | Link from signal-pack idea to `insights_id` of top-performer analysis |
| Twist brief | Legal constraint: visual pattern only, no verbatim logos/faces |

---

## 17. Related HTTP endpoints (selection)

- Creative intelligence ingest: `POST /v1/creative-intelligence/:slug/top-performers/ingest`
- Signal pack styling merge: `POST /v1/creative-intelligence/:slug/signal-packs/:id/styling`
- Mimic mode override: signal pack routes in `src/routes/signal-packs.ts`
- Mimic text overlay lab: `src/routes/mimic-text-overlay-lab-routes.ts`
- Review contract paths: covered by `src/routes/review-contract.test.ts`

---

*Cross-linked from `README.md`, `AGENTS.md`, and `docs/CAF_CORE_COMPLETE_GUIDE.md`. For repo-wide doc index see `docs/layers/README.md`.*
