# Top-performer mimic flows (quick reference)

Optional pipeline lanes that recreate **visual patterns** from archived top-performer posts while generating **fresh copy**. Full detail: **[MIMIC_FLOWS_COMPLETE_GUIDE.md](./MIMIC_FLOWS_COMPLETE_GUIDE.md)** (PDF: `MIMIC_FLOWS_COMPLETE_GUIDE.pdf`).

## Flow types

| Flow | Format | Reference tier |
|------|--------|----------------|
| `FLOW_TOP_PERFORMER_MIMIC_IMAGE` | Single post | `top_performer_deep` (exactly **one** frame) |
| `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` | Carousel | `top_performer_carousel` | Manual mimic picks |
| `FLOW_VISUAL_FIRST_CAROUSEL` | Carousel | `top_performer_carousel` | Visual-first ideas (`carousel_style: visual_first` / `mixed`) |
| `FLOW_TOP_PERFORMER_MIMIC_VIDEO` | Video | `top_performer_video` | Routes to **HeyGen** (`FLOW_VID_*`) — not pixel mimic |

TP-grounded carousel lanes (`mimic_carousel`, `visual_first_carousel`) share render/copy (`isTpGroundedCarouselRenderFlow`) but have **separate** plan caps and prompts.

## Enable (both required)

1. **Env:** `MIMIC_IMAGE_ENABLED=1`, `OPENAI_API_KEY` (copy), and a render provider key for `MIMIC_IMAGE_PROVIDER` (default **`bfl`** → `BFL_API_KEY`; also `dashscope`, `nvidia`, `openai`).
2. **Project:** enable mimic flow types + plan cap &gt; 0 (seeded **disabled** by default).

## Payload keys

| Key | Role |
|-----|------|
| `mimic_v1` | **Render source of truth** — mode, references, slide plans |
| `mimic_carousel_package` | Review snapshot for TP-grounded carousel flows (`FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`, `FLOW_VISUAL_FIRST_CAROUSEL`) — **not** `carousel_package` |
| `mimic_render_context` | Copy-time hints (slide count, template path) |
| `mimic_job_grounding` | Per-slide layout for copy LLM |

## Mimic modes (`mimic_v1.mode`)

| Mode | When | Render |
|------|------|--------|
| `image_full` | Single reference frame | One `STATIC_IMAGE` via image edit + LLM on-image copy |
| `template_bg` | Text-heavy / listicle deck | Background plate → `carousel_mimic_bg.hbs` or Sharp composite + text overlay |
| `carousel_visual` | Image-led carousel (2+ frames) | Per-slide art-only plates + HBS/DocAI text overlay |

Classifier: `classifyMimicMode()` — reviewer override → Nemotron `mimic_evaluation.recommended_mode` → heuristics (`src/services/mimic-mode-classifier.ts`).

**Text invariant (all TP-grounded carousels, including `FLOW_VISUAL_FIRST_CAROUSEL`):** image models produce **art-only plates**. LLM copy is composited via **HTML/CSS** (Puppeteer HBS or DocAI `docai_layer_positions`). `MIMIC_CAROUSEL_TEXT_VIA_FLUX` is ignored at render — never bake typography into Flux for these jobs.

## Operator workflow

1. **Plan run** — mimic flows compete with `FLOW_CAROUSEL` when both enabled.
2. **Resolve reference** (before LLM) — `mimic_v1`, `mimic_render_context`, `template_storage_decision`.
3. **Template backgrounds** (`template_bg` only, optional pre-copy) — extract plates → `MIMIC_BACKGROUND`.
4. **Generate** — OpenAI copy; carousel mimic writes `mimic_carousel_package` snapshot → **GENERATED**.
5. **Review** — TP-grounded workbench for both lanes (layer editor, per-slide regen, reprint overlay). Manual mimic adds original-vs-generated compare; visual-first does not.
6. **Render** — image provider + Puppeteer/DocAI overlays → **IN_REVIEW**.

## Prerequisites

- Top-performer archive in Supabase (`stored_inspection_media_json` on visual-guidelines entries).
- Signal pack `visual_guidelines_pack_v1` + ideas grounded to `insights_id`.
- See also **[CREATIVE_INTELLIGENCE.md](./CREATIVE_INTELLIGENCE.md)** for ingest.

## Config (defaults from `src/config.ts`)

| Variable | Default |
|----------|---------|
| `MIMIC_IMAGE_ENABLED` | `false` |
| `MIMIC_IMAGE_PROVIDER` | `bfl` |
| `MIMIC_IMAGE_BFL_MODEL` | `flux-2-klein-4b` |
| `MIMIC_VISUAL_SIMILARITY_PCT` | `70` |
| `MIMIC_IMAGE_INPUT_MODE` | `reference_edit` (`analysis_t2i` = Flux T2I prompts) |
| `MIMIC_IMAGE_DEFAULT_SIZE` | `1024x1536` |
| `CAROUSEL_COMPOSITE_ENABLED` | `true` |

Per-project overrides: `project_system_constraints.mimic_*` columns (migrations `066`–`069`).

## Key modules

| Area | Path |
|------|------|
| Prep / snapshot | `src/services/mimic-draft-prep.ts` |
| Carousel render | `src/services/mimic-carousel-render.ts`, `mimic-image-job.ts` |
| Image providers | `src/services/mimic-image-provider.ts` |
| Payload types | `src/domain/mimic-payload.ts`, `mimic-carousel-package.ts` |
| Pipeline hook | `src/services/job-pipeline.ts` |

## Migrations

`060`–`069` — flow types, prompts, copy rules, grounding, BFL model, render settings, image input mode.
