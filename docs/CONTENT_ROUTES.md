# CAF Content Routes Catalog

Human-facing **lanes** for project setup. Implementation source of truth: [`src/domain/content-routes.ts`](../src/domain/content-routes.ts).

**Choose lanes in the [project setup checklist](./PROJECT_SETUP_CHECKLIST.md)** (§ Content routes / pack §6). Import applies recognized “Enabled content routes” labels. Review Brand profile → Content routes remains available to adjust later.

When a lane is **off**:

1. Related `allowed_flow_types` rows are `enabled = false` (no content jobs).
2. Related idea-generation buckets are set to **0** (no ideas for that format).
3. Review Ideas / cart only offers enabled lanes.

| Lane id | Label | Flow types | Idea buckets (primary) |
|---------|-------|------------|------------------------|
| `niche_carousels` | Niche carousels | `FLOW_CAROUSEL` | `niche_carousel_text` |
| `product_carousels` | Product carousels | `FLOW_CAROUSEL` | `product_carousel_text` |
| `visual_first_carousels` | Brand visual carousels | `FLOW_VISUAL_FIRST_CAROUSEL` | `niche_carousel_visual`, `product_carousel_visual` |
| `top_performer_mimic_carousel` | Recreate top performers | `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` | (planning from TP-eligible ideas; no dedicated bucket) |
| `why_mimic_carousels` | Why Mimic carousels | `FLOW_WHY_MIMIC_CAROUSEL` | (advanced; no dedicated bucket) |
| `avatar_video_script` | Avatar video (script) | `FLOW_VID_SCRIPT` | `niche_video_script_avatar` |
| `avatar_video_prompt` | Avatar video (prompt) | `FLOW_VID_PROMPT` | `niche_video_prompt_avatar` |
| `video_no_avatar` | Video without avatar | `FLOW_VID_PROMPT_NO_AVATAR` | `niche_video_no_avatar` |
| `hook_first_video` | Hook-first video | `FLOW_VID_HOOK_FIRST` | `niche_video_hook_first` |
| `ugc_video` | UGC creator video | `FLOW_VID_UGC` | `niche_video_ugc`, `product_video_ugc` |
| `product_marketing_videos` | Product marketing videos | `FLOW_PRODUCT_*` (6) | `product_video` + angle buckets |
| `linkedin_posts` | LinkedIn posts | `FLOW_LINKEDIN_TEXT_POST`, `FLOW_LINKEDIN_DOCUMENT_POST` | `*_linkedin_text`, `*_linkedin_document` |
| `reddit_posts` | Reddit posts | `FLOW_REDDIT_POST` | `*_reddit_post` |
| `instagram_threads` | Instagram threads | `FLOW_INSTAGRAM_THREAD` | `*_instagram_thread` |

**Not in marketer menu:** unwired `FLOW_IMG_*`, deprecated utility flows, scene-assembly (operator-only unless added later).

`FLOW_CAROUSEL` stays enabled if **either** niche or product carousels is on.
