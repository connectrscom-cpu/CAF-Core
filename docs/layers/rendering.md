# Layer: Rendering (carousel & video)

**Purpose:** Turn **approved structured JSON** into **pixels**: carousel **PNGs** via an external renderer, **HeyGen** / **Sora** / **ffmpeg** paths for video, uploads to **Supabase** when configured.

## Where it lives

Primarily **`src/services/job-pipeline.ts`** (orchestration), plus:

| Module | Role |
|--------|------|
| **`carousel-render-pack.ts`** | Slide count, template pick, **`buildSlideRenderContext`**, strip non-render fields. |
| **`mimic-carousel-render.ts`** | Top-performer carousel mimic: per-slide plates, template-bg, DocAI text overlay, **`MIMIC_BACKGROUND`** / **`MIMIC_VISUAL_PLATE`** assets. |
| **`mimic-image-job.ts`** | Single-frame **`image_full`** mimic → **`STATIC_IMAGE`**. |
| **`mimic-image-provider.ts`** | BFL / DashScope / NVIDIA / OpenAI image edit & T2I (`MIMIC_IMAGE_PROVIDER`). |
| **`mimic-template-bg-render.ts`** | Template-background plate extract + HBS path. |
| **`heygen-renderer.ts`** | Submit/poll HeyGen, burn subtitles optional. |
| **`scene-pipeline.ts`** | Scene clips, concat, mux (**`pollVideoAssemblyJob`**, **`runScenePipeline`**). |
| **`sora-scene-clips.ts`** | Sora polling (errors surface to pipeline). |
| **`renderer-warmup.ts`** | Pre-call renderer health. |
| **`renderer-url-guard.ts`** | Misconfiguration warnings. |

## Carousel

- HTTP **`POST`** to **`RENDERER_BASE_URL`** (per-slide or batch per implementation in **`job-pipeline`**).
- Templates: **`CAROUSEL_TEMPLATES_DIR`**, Core may expose **`/api/templates/*`** for the worker. Mimic template-bg uses **`carousel_mimic_bg.hbs`** (`services/renderer/templates/`).
- Retries: **`CAROUSEL_RENDERER_SLIDE_RETRY_ATTEMPTS`**, timeouts **`CAROUSEL_RENDERER_SLIDE_TIMEOUT_MS`**.

## Top-performer mimic (optional)

When **`MIMIC_IMAGE_ENABLED=1`** and flow type is **`FLOW_TOP_PERFORMER_MIMIC_*`**:

- **Image mimic** — one reference-conditioned edit → **`STATIC_IMAGE`** (`mimic-image-job.ts`).
- **Carousel mimic** — modes **`template_bg`** (bg plate + HBS/Sharp text) or **`carousel_visual`** (per-slide art-only plate + DocAI/HBS overlay). Source of truth: **`generation_payload.mimic_v1`**.
- **Providers** — **`MIMIC_IMAGE_PROVIDER`** (default **`bfl`**); copy generation still uses OpenAI regardless of render provider.
- **Text-only reprint** — reviewers can re-run overlay without re-calling image models when plates exist (`MIMIC_TEXT_OVERLAY_REPRINT_PHASE`).

See **[../MIMIC_FLOWS_COMPLETE_GUIDE.md](../MIMIC_FLOWS_COMPLETE_GUIDE.md)**.

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
- `docs/VIDEO_FLOWS.md`, `docs/HEYGEN_API_V3.md`, `docs/MIMIC_IMAGE_FLOWS.md`
