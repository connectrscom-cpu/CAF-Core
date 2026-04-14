## Goal

Reduce time-to-complete and eliminate common Fly.io failure modes (timeouts, cold starts, wrong base URLs, renderer/video-assembly hangs) for **CAF Core** + **CAF Renderer/Media Gateway** deployments.

## Biggest latency contributors (where to look)

- **LLM generation (OpenAI chat)**: `src/services/openai-chat.ts`, `src/services/llm-generator.ts`
- **Carousel rendering** (per-slide Puppeteer): `services/renderer/server.js` + Core caller in `src/services/job-pipeline.ts` (`POST /render-binary` per slide)
- **Scene video assembly**:
  - **Sora polling**: `src/services/sora-scene-clips.ts` (OpenAI Videos API polling + download/upload)
  - **HeyGen polling**: `src/services/heygen-renderer.ts`
  - **Concat/mux**: `services/video-assembly/server.js` (ffmpeg)

## Fly deployment shapes (pick one)

### Option A (recommended): combined gateway on one Fly app

Deploy **`services/media-gateway`** image (spawns renderer + video-assembly on localhost).

- **Pros**: one stable public base URL for both render + video endpoints; avoids “wrong base URL” errors; easiest for `RENDERER_BASE_URL`/`VIDEO_ASSEMBLY_BASE_URL`.
- **Deploy**: `fly deploy -c fly.caf-renderer.toml`
- **Public endpoints**:
  - Renderer: `POST /render-binary`, `GET /renderer/ready`, `GET /renderer/health`, `GET /templates/*`
  - Video assembly: `POST /concat-videos`, `POST /mux`, `GET /status/:id`, `POST /full-pipeline`
  - Gateway readiness: `GET /ready`

### Option B: standalone services (only if you must)

- **`services/renderer`** Fly app: Puppeteer only.
- **`services/video-assembly`** Fly app: ffmpeg only.
- **Downside**: you must set two different base URLs and ensure the “status polling” endpoint is exposed on the same host you use for async jobs.

## Required env vars (exact)

### On `caf-core` (Fly app `caf-core`)

- **`RENDERER_BASE_URL`**:
  - If using combined gateway: `https://caf-renderer.fly.dev`
  - If using standalone renderer: `https://<your-renderer-app>.fly.dev`
- **`VIDEO_ASSEMBLY_BASE_URL`**:
  - If using combined gateway: `https://caf-renderer.fly.dev`
  - If using standalone video-assembly: `https://<your-video-assembly-app>.fly.dev`

Constraints / gotchas:

- **No trailing slash** is safest (Core trims it, but keep it consistent).
- `VIDEO_ASSEMBLY_BASE_URL` must serve **both** `POST /concat-videos?async=1` **and** `GET /status/:requestId`. If you point it at a host that only proxies the POST routes, Core will fail during polling.

### On `caf-renderer` (combined gateway app)

- **Recommended**:
  - `CAF_TEMPLATE_API_URL=https://caf-core.fly.dev` (so renderer can fetch missing templates from Core)
  - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ASSETS_BUCKET` (so video-assembly can upload outputs and return `public_url`)
- **Timeout hardening** (safe production defaults):
  - `VIDEO_ASSEMBLY_FETCH_TIMEOUT_MS=180000`
  - `VIDEO_ASSEMBLY_FFMPEG_TIMEOUT_MS=1200000`
  - `VIDEO_ASSEMBLY_JOB_TIMEOUT_MS=1800000`

### OpenAI timeout hardening (CAF Core)

- `OPENAI_CHAT_TIMEOUT_MS=180000`
- `OPENAI_CHAT_MAX_RETRIES=2`

Notes:

- These are used by `src/services/openai-chat.ts` and `src/services/openai-chat-multimodal.ts` to prevent “hang forever” calls.

## Fly health checks (readiness vs liveness)

- **caf-core**: Fly should check `GET /readyz` (DB connectivity)
- **caf-renderer (combined gateway)**: Fly should check `GET /ready` (Chromium launch + ffmpeg present)

## Observability (minimal, production-safe)

- **Video-assembly** logs durations for `stitch`, `concat`, `mux`, and full-pipeline runs.
- **OpenAI chat** emits a console log when a call takes \(\ge 20s\), including attempt number and tokens.
- **Core video render** emits a console log when the overall render step takes \(\ge 20s\).

## Fly smoke test plan

### 1) Readiness

- `curl https://caf-core.fly.dev/readyz`
- `curl https://caf-renderer.fly.dev/ready`

### 2) Dependency wiring sanity

- `curl https://caf-core.fly.dev/health/rendering`
  - Confirm `rendering.renderer.ok=true`
  - Confirm `rendering.video_assembly.ok=true`

### 3) Minimal renderer test

- `curl -X POST https://caf-renderer.fly.dev/render-binary -H \"content-type: application/json\" -d '{\"template\":\"carousel_sns_chat_story\",\"data\":{\"render\":{\"slides\":[{\"headline\":\"Hello\",\"body\":\"World\"}]}}}' --output out.png`

### 4) Minimal video-assembly async test (concat)

- Start:
  - `curl -X POST \"https://caf-renderer.fly.dev/concat-videos?async=1\" -H \"content-type: application/json\" -d '{\"video_urls\":[\"<public-mp4-1>\",\"<public-mp4-2>\"]}'`
- Poll:
  - `curl https://caf-renderer.fly.dev/status/<request_id>`

### 5) End-to-end Core pipeline (small)

- Create a run with 1 candidate and process it (or use existing admin helpers).
- Watch logs:
  - Core logs for OpenAI timeouts/retries and overall video render durations.
  - Renderer/gateway logs for /ready readiness and any puppeteer errors.
  - Video-assembly logs for ffmpeg duration and any watchdog timeouts.

