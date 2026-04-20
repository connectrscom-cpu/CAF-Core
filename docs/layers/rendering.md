# Layer: Rendering (carousel & video)

**Purpose:** Turn **approved structured JSON** into **pixels**: carousel **PNGs** via an external renderer, **HeyGen** / **Sora** / **ffmpeg** paths for video, uploads to **Supabase** when configured.

## Where it lives

Primarily **`src/services/job-pipeline.ts`** (orchestration), plus:

| Module | Role |
|--------|------|
| **`carousel-render-pack.ts`** | Slide count, template pick, **`buildSlideRenderContext`**, strip non-render fields. |
| **`heygen-renderer.ts`** | Submit/poll HeyGen, burn subtitles optional. |
| **`scene-pipeline.ts`** | Scene clips, concat, mux (**`pollVideoAssemblyJob`**, **`runScenePipeline`**). |
| **`sora-scene-clips.ts`** | Sora polling (errors surface to pipeline). |
| **`renderer-warmup.ts`** | Pre-call renderer health. |
| **`renderer-url-guard.ts`** | Misconfiguration warnings. |

## Carousel

- HTTP **`POST`** to **`RENDERER_BASE_URL`** (per-slide or batch per implementation in **`job-pipeline`**).
- Templates: **`CAROUSEL_TEMPLATES_DIR`**, Core may expose **`/api/templates/*`** for the worker.
- Retries: **`CAROUSEL_RENDERER_SLIDE_RETRY_ATTEMPTS`**, timeouts **`CAROUSEL_RENDERER_SLIDE_TIMEOUT_MS`**.

## Video

- **HeyGen** — avatar / video agent; polling **`HEYGEN_POLL_MAX_MS`**; subtitle burn via **video-assembly** when **`HEYGEN_BURN_SUBTITLES`**.
- **Scene assembly** — **`SCENE_ASSEMBLY_CLIP_PROVIDER`** (`sora` vs `heygen`), concat on **video-assembly** service, **`VIDEO_ASSEMBLY_*_POLL_MAX_MS`**.

## Provider idempotency (do NOT double-submit)

Any new render branch that talks to HeyGen or Sora must consult **`hasActiveProviderSession(renderState)`** (`src/domain/content-job-render-state.ts`) before submitting. If `video_id` or `session_id` is already persisted, the provider owns the render — re-submitting double-bills and creates orphan videos. The helper is the canonical check; do not re-implement it inline.

## Outputs

- **`caf_core.assets`** — **`public_url`**, **`asset_type`**, **`position`**.
- **`content_jobs`** — **`render_state`**, **`render_provider`**, **`asset_id`**, URLs inside **`generation_payload`**.

## Boundaries

- **Not** embedded in Core process — network failures are **operational** issues; pipeline uses **typed errors** (e.g. **`RenderNotReadyError`**, **`HeygenPollTimeoutError`**).

## See also

- [../TECH_STACK.md](../TECH_STACK.md)
- [job-pipeline.md](./job-pipeline.md)
- `docs/VIDEO_FLOWS.md`, `docs/HEYGEN_API_V3.md`
