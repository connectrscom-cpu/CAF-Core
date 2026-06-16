# Creative intelligence (top performers)

Project-agnostic layer: ingest reference media from high-performing social posts, store assets (Supabase when configured), run multimodal vision analysis, persist structured insights, expose styling cues on signal packs, and optionally mint carousel `.hbs` templates for the Puppeteer renderer.

## Data flow

1. `POST /v1/creative-intelligence/:project_slug/top-performers/ingest` — download/store slides or video (+ ffmpeg frames when available), optional inline OpenAI vision → `creative_visual_analyses` + `creative_insights` with stable **`insight_ref`** values like `ci_<hex>`.
2. `POST /v1/creative-intelligence/:project_slug/insights/generate` — aggregate multiple completed analyses into additional `creative_insights` (`ci_agg_*`).
3. `POST /v1/creative-intelligence/:project_slug/signal-packs/:signal_pack_id/styling` — merges `creative_design_intelligence_v1` and `top_performer_styling_cues_v1` into `signal_packs.derived_globals_json`.
4. `POST .../mimic-carousel-template` — writes `services/renderer/templates/<name>.hbs` (from `carousel_notes_app_minimal.hbs` + palette) and pins the template on the project.
5. `POST .../jobs/:task_id/apply-template` — sets `generation_payload` render keys for that job.

## Tables (`migrations/055_creative_intelligence.sql`)

| Table | Purpose |
|-------|---------|
| `caf_core.creative_source_assets` | Media rows (slides, video blob, thumbnail, `extracted_frame`), `source_group_id`, metrics/metadata JSON. |
| `caf_core.creative_visual_analyses` | Structured vision output + `raw_model_output_json`. |
| `caf_core.creative_insights` | Operator-facing insight; **`insight_ref`** is used in `ideas_json.grounding_insight_ids` (prefix `ci_`). |
| `caf_core.creative_carousel_mimic_templates` | Stored `.hbs` source + file name for traceability. |

## Signal pack hints

`signal_pack_publication_hints` (via `buildCreationPack`) includes **`top_performer_styling_cues`** from `derived_globals_json.top_performer_styling_cues_v1`.

## Planner weighting

When materializing ideas to planner rows, any idea whose `grounding_insight_ids` contains a ref starting with **`ci_`** gets a higher **`past_performance`** score (config `CREATIVE_INTEL_PLANNER_PAST_PERFORMANCE_BOOST`).

## Grounding uniqueness

`POST /v1/signal-packs/.../ideas` rejects duplicate **`grounding_insight_ids`** across ideas (each insight id may ground at most one idea).

## Generation prompts

When `CREATIVE_INTEL_INJECT_IN_GENERATION=1`, a capped **creative style guidance** block is appended to the system prompt (and `creative_style_guidance` is available as a template placeholder but omitted from `{{creation_pack_json}}`).

## Sample ingest

```json
{
  "platform": "Instagram",
  "items": [
    {
      "source_url": "https://example.com/p/abc",
      "external_source_id": "abc",
      "media_type": "carousel",
      "media_urls": ["https://cdn.example.com/1.jpg", "https://cdn.example.com/2.jpg"],
      "caption": "Hook text",
      "metrics": { "likes": 1200, "saves": 200 }
    }
  ],
  "selection_reason": "top_performer_scrape"
}
```

## Limits

- Video temporal understanding requires a **direct downloadable** MP4 (or similar) and **ffmpeg** on the Core host (or frames are skipped).
- OpenAI vision needs **HTTPS** image URLs (Supabase `public_url` after upload works).
- Template mimicry v1 adjusts **palette variables only** — not full layout cloning.

## Downstream: top-performer mimic flows

When **`visual_guidelines_pack_v1`** entries include archived inspection media (`stored_inspection_media_json`) and Nemotron **`mimic_evaluation`**, signal-pack ideas grounded to those **`insights_id`** values can become **`FLOW_TOP_PERFORMER_MIMIC_IMAGE`** or **`FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`** jobs (requires **`MIMIC_IMAGE_ENABLED=1`** on Core).

| Doc | Content |
|-----|---------|
| [MIMIC_FLOWS_COMPLETE_GUIDE.md](./MIMIC_FLOWS_COMPLETE_GUIDE.md) | Full mimic pipeline (modes, payloads, render providers) |
| [MIMIC_IMAGE_FLOWS.md](./MIMIC_IMAGE_FLOWS.md) | Operator quick reference |
| [CAF_INPUTS_PIPELINE_ROADMAP.md](./CAF_INPUTS_PIPELINE_ROADMAP.md) | Admin inputs → top-performer insight tiers |
