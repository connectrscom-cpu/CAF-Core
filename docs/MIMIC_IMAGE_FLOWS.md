# Top-performer image / carousel mimic

Optional flows that mimic archived top-performer visuals using reference-conditioned image edits (`MIMIC_IMAGE_PROVIDER`: OpenAI `gpt-image-1` or NVIDIA NIM `qwen-image-edit`).

## Mimic carousel draft package (`mimic_carousel_package`)

**Distinct from `FLOW_CAROUSEL` / `carousel_package`.** Only `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` uses this type.

After Generate + mimic prep, `generation_payload.draft_package_snapshot` holds:

| Slice | Source |
|-------|--------|
| `copy` | LLM slides, caption, hashtags |
| `render_plan` | Upstream vision analysis via `classifyMimicMode` — `template_background` (listicle/text-heavy) or `per_slide_mimic` (strong imagery) |
| `visual_reference` | Archived inspection media paths (`bucket`, `object_path`, folder prefix) |
| `visual_guideline` | Slim top-performer row: format pattern, deck system, replication blueprint |

`mimic_v1` remains the render source of truth; the composed package is for review, content log, and operators.

## Enable (both required)

1. **Env:** `MIMIC_IMAGE_ENABLED=1` and either `OPENAI_API_KEY` (`MIMIC_IMAGE_PROVIDER=openai`, default) or `NVIDIA_NIM_API_KEY` (`MIMIC_IMAGE_PROVIDER=nvidia` for free/cheap Qwen edits via the same NIM key as Nemotron)
2. **Project:** enable `FLOW_TOP_PERFORMER_MIMIC_IMAGE` and/or `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` in allowed flow types; set plan cap &gt; 0

Flows are seeded **disabled** via `seedMimicFlowTypesSkeleton()` (like product flows).

Migration **`061_mimic_flow_prompts.sql`** adds Flow Engine `flow_definitions` + `prompt_templates` for both mimic flows (inherits carousel output schema). Carousel **template-bg** renders use `carousel_mimic_bg.hbs` (background plate from gpt-image-1).

## Prerequisites

- Top-performer passes with Supabase archive (`stored_inspection_media_json`)
- Signal pack with `visual_guidelines_pack_v1`
- Ideas grounded to top-performer `insights_id` values

## Operator workflow

1. **Plan run** — mimic flows compete in parallel with regular carousel flows when both enabled
2. **Resolve reference** (before LLM) — `mimic_v1` + `mimic_render_context` on the job; listicle / ≥200-char on-screen text → `template_bg`
3. **Generate Jobs** — LLM copy informed by render plan; then `mimic_carousel_package` snapshot; status **GENERATED**
4. **Review** — inspect copy and mimic metadata (no assets yet)
5. **Render** — Sharp composite on stored background plates (`carousel_composite_templates`) when `CAROUSEL_COMPOSITE_ENABLED` (default on), else gpt-image-1 background extract + `carousel_mimic_bg.hbs`; per-slide full-bleed mimic unchanged; status **IN_REVIEW**

## Carousel composite templates (alternative to .hbs)

Listicle / `template_bg` mimic carousels prefer **stored background plates + Sharp text overlay** (layout aligned with `carousel_mimic_bg.hbs` padding and font sizes).

| Piece | Location |
|-------|----------|
| DB table | `caf_core.carousel_composite_templates` |
| Layout defaults | `src/domain/carousel-composite-layout.ts` |
| Compositor | `src/services/carousel-composite-render.ts` |
| Mimic template build | `src/services/mimic-composite-template-builder.ts` (once per `source_insights_id`) |
| Default listicle pin | `composite:listicle_stack_v1` via `ensureDefaultListicleCompositeTemplate` |

Pin `composite:{template_key}` on a project to force a composite layout. **All stored composite templates for the project also join the implicit pool automatically** — normal `FLOW_CAROUSEL` jobs pick deterministically (per `task_id`) between eligible `.hbs` templates and every active composite row, without requiring a pin.

| Variable | Default |
|----------|---------|
| `CAROUSEL_COMPOSITE_ENABLED` | `true` (set `0` to force Puppeteer .hbs only) |

## Mimic modes (`mimic_v1.mode`)

| Mode | When | Render |
|------|------|--------|
| `image_full` | Single-frame top performer (exactly **one** archived reference image) | One `STATIC_IMAGE` with **new** on-image copy from LLM (not reference text) |
| `template_bg` | Text-heavy template carousel | Background extract + `carousel_mimic_bg.hbs` slides |
| `carousel_visual` | Image-led carousel (**2+** reference frames, or multi-slide deck) | Per-slide mimic (full bleed or HBS) |

**Routing:** `FLOW_TOP_PERFORMER_MIMIC_IMAGE` is for **post**-format ideas with a **single** archived frame. Carousel-format ideas and references with 2+ slides must use `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`. Generate fails early if image mimic resolves to multiple reference frames.

## Config

| Variable | Default |
|----------|---------|
| `MIMIC_IMAGE_ENABLED` | `false` |
| `MIMIC_IMAGE_PROVIDER` | `openai` (`nvidia` → Qwen image edit on NVIDIA NIM) |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` |
| `MIMIC_IMAGE_NVIDIA_MODEL` | `qwen/qwen-image-edit` |
| `MIMIC_IMAGE_INPUT_FIDELITY` | `high` (OpenAI only) |
| `MIMIC_IMAGE_QUALITY` | `high` (OpenAI only) |
| `MIMIC_IMAGE_DEFAULT_SIZE` | `1024x1536` |
