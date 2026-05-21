# Top-performer image / carousel mimic

Optional flows that mimic archived top-performer visuals using OpenAI `gpt-image-1` edits.

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

1. **Env:** `MIMIC_IMAGE_ENABLED=1` and `OPENAI_API_KEY`
2. **Project:** enable `FLOW_TOP_PERFORMER_MIMIC_IMAGE` and/or `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` in allowed flow types; set plan cap &gt; 0

Flows are seeded **disabled** via `seedMimicFlowTypesSkeleton()` (like product flows).

Migration **`061_mimic_flow_prompts.sql`** adds Flow Engine `flow_definitions` + `prompt_templates` for both mimic flows (inherits carousel output schema). Carousel **template-bg** renders use `carousel_mimic_bg.hbs` (background plate from gpt-image-1).

## Prerequisites

- Top-performer passes with Supabase archive (`stored_inspection_media_json`)
- Signal pack with `visual_guidelines_pack_v1`
- Ideas grounded to top-performer `insights_id` values

## Operator workflow

1. **Plan run** — mimic flows compete in parallel with regular carousel flows when both enabled
2. **Generate Jobs** — LLM draft + `job_drafts` row + `generation_payload.mimic_v1` (reference + mode); status **GENERATED**
3. **Review** — inspect copy and mimic metadata (no assets yet)
4. **Render** — gpt-image-1 produces assets; status **IN_REVIEW**

## Mimic modes (`mimic_v1.mode`)

| Mode | When | Render |
|------|------|--------|
| `image_full` | Single-image top performer | One `STATIC_IMAGE` |
| `template_bg` | Text-heavy template carousel | Background extract + `carousel_mimic_bg.hbs` slides |
| `carousel_visual` | Image-led carousel | Per-slide mimic (full bleed or HBS) |

## Config

| Variable | Default |
|----------|---------|
| `MIMIC_IMAGE_ENABLED` | `false` |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` |
| `MIMIC_IMAGE_INPUT_FIDELITY` | `high` |
| `MIMIC_IMAGE_QUALITY` | `high` |
| `MIMIC_IMAGE_DEFAULT_SIZE` | `1024x1536` |
