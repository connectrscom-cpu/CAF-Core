# Top-performer mimic flows (quick reference)

Optional pipeline lanes for carousel/image mimic, **new visual** carousels, and **Why Mimic**. Full detail: **[MIMIC_FLOWS_COMPLETE_GUIDE.md](./MIMIC_FLOWS_COMPLETE_GUIDE.md)**. Repo truth: **[CAF_CURRENT_STATE_CONTEXT_PACK.md](./CAF_CURRENT_STATE_CONTEXT_PACK.md)** §11.

> **Updated 2026-07:** Visual-first (`FLOW_VISUAL_FIRST_CAROUSEL`) is **not** TP frame replication — it uses `execution_mode: new_visual` with idea + BVS and empty `reference_items`.

## Flow types

| Flow | Format | Lane |
|------|--------|------|
| `FLOW_TOP_PERFORMER_MIMIC_IMAGE` | Single post | `top_performer_deep` (exactly **one** frame) |
| `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` | Carousel | Manual mimic picks; `execution_mode: classic` |
| `FLOW_VISUAL_FIRST_CAROUSEL` | Carousel | **New visual** — idea + BVS; `execution_mode: new_visual`; **no** TP frames |
| `FLOW_WHY_MIMIC_CAROUSEL` | Carousel | SIL-driven; `execution_mode: why_mimic` |
| `FLOW_TOP_PERFORMER_MIMIC_VIDEO` | Video | Routes to **HeyGen** (`FLOW_VID_*`) — not pixel mimic |

TP-grounded carousel lanes share render/copy (`isTpGroundedCarouselRenderFlow()`) but have **separate** plan caps and prompts.

## Enable (both required)

1. **Env:** `MIMIC_IMAGE_ENABLED=1`, `OPENAI_API_KEY` (copy), and a render provider key for `MIMIC_IMAGE_PROVIDER` (default **`bfl`** → `BFL_API_KEY`; also `dashscope`, `nvidia`, `openai`).
2. **Project:** enable mimic flow types + plan cap > 0 (seeded **disabled** by default).

## Payload keys

| Key | Role |
|-----|------|
| `mimic_v1` | **Render source of truth** — `execution_mode`, `mode`, references, slide plans, BVS slices |
| `bvs_v1` | Frozen Brand Visual System snapshot when enabled |
| `mimic_carousel_package` | Review snapshot for all TP-grounded carousel render flows — **not** `carousel_package` |
| `mimic_render_context` | Copy-time hints (slide count, template path) |
| `mimic_job_grounding` | Per-slide layout for copy LLM |

## `mimic_v1.execution_mode`

| Value | Flow | Notes |
|-------|------|-------|
| `classic` | `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` | TP reference frames |
| `new_visual` | `FLOW_VISUAL_FIRST_CAROUSEL` | No `reference_items`; prep in `new-visual-carousel-prep.ts` |
| `why_mimic` | `FLOW_WHY_MIMIC_CAROUSEL` | SIL on `slide_intelligence` |

## Mimic modes (`mimic_v1.mode`)

| Mode | When | Render |
|------|------|--------|
| `image_full` | Single reference frame | One `STATIC_IMAGE` via image edit + LLM on-image copy |
| `template_bg` | Text-heavy / listicle deck | Background plate (reference strip or BVS-invented T2I) → HBS/DocAI overlay |
| `carousel_visual` | Image-led carousel | Per-slide art-only plates + HBS/DocAI overlay |

New visual is always `carousel_visual` + T2I. Classifier (`classifyMimicMode()`) applies to classic/why mimic only.

**Text invariant:** image models produce **art-only plates**. Copy is composited via **HTML/CSS** (Puppeteer HBS or DocAI `docai_layer_positions`). `MIMIC_CAROUSEL_TEXT_VIA_FLUX` is **ignored** at render.

## Brand Visual System (BVS)

- **`brand_bibles`** table — versioned `brand_bible_v1` per project.
- Snapshotted to **`generation_payload.bvs_v1`** at plan when `use_brand_visual_system` is true.
- Visual-first defaults BVS on. `mimic_v1.bvs_render_plan` can invent `template_bg` plates.

## Operator workflow

1. **Plan run** — mimic flows compete with `FLOW_CAROUSEL` when both enabled.
2. **Prep** — classic/why: `mimic-draft-prep.ts`; new visual: `new-visual-carousel-prep.ts`.
3. **Generate** — OpenAI copy; TP-grounded carousel → `mimic_carousel_package` snapshot.
4. **Review** — layer editor, live preview, brand styling panel; manual mimic has compare row; visual-first does not.
5. **Reprint** (cheap) vs **regenerate slide** (expensive) for wrong visuals.
6. **Render** — image provider + Puppeteer/DocAI overlays → **IN_REVIEW**.

## Prerequisites

- **Classic / Why Mimic:** top-performer archive in Supabase; signal pack `visual_guidelines_pack_v1` + grounded ideas.
- **New visual:** idea + BVS; no TP archive required for reference frames.
- See **[CREATIVE_INTELLIGENCE.md](./CREATIVE_INTELLIGENCE.md)** for ingest.

## Config (defaults from `src/config.ts`)

| Variable | Default |
|----------|---------|
| `MIMIC_IMAGE_ENABLED` | `false` |
| `MIMIC_IMAGE_PROVIDER` | `bfl` |
| `MIMIC_VISUAL_SIMILARITY_PCT` | `70` |
| `MIMIC_IMAGE_INPUT_MODE` | `reference_edit` (`analysis_t2i` for new visual / invented plates) |
| `WHY_MIMIC_REQUIRE_SUBSTANTIVE_SIL` | `true` |
| `MIMIC_LAYOUT_QA_ENABLED` | `true` |

Per-project overrides: `project_system_constraints.mimic_*` (migrations `066`–`069`).

## Key modules

| Area | Path |
|------|------|
| Classic prep | `src/services/mimic-draft-prep.ts` |
| New visual prep | `src/services/new-visual-carousel-prep.ts` |
| BVS | `src/domain/brand-bible.ts`, `bvs-v1.ts`, `bvs-render-plan.ts` |
| Carousel render | `src/services/mimic-carousel-render.ts`, `bvs-render-overlays.ts` |
| Payload types | `src/domain/mimic-payload.ts`, `mimic-carousel-package.ts` |

## Migrations

`060`–`078` — flow types, prompts, BVS (`078_brand_bibles`), Why Mimic (`074`), visual-first (`070`), job outcomes (`075`).
