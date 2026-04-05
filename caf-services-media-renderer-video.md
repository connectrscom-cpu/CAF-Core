# CAF backend services — media-gateway, renderer, video-assembly

This document describes the three **Node.js / Express** services in this repo that handle **media generation and assembly**. For stitch/mux **request bodies**, **n8n** patterns, and Whisper setup, see **`docs/video-assembly.md`**. For deploy topology (Fly, env vars), see **`AGENTS.md`**.

---

## 1. Overview

| Service | Directory | Default port (standalone) | Role |
|---------|-----------|-----------------------------|------|
| **Renderer** | `services/renderer` | `3333` (`PORT`) | HTML (Handlebars) → PNG slides via Puppeteer |
| **Video assembly** | `services/video-assembly` | `3334` (`PORT`) | Remote ffmpeg: concatenate scene clips (**stitch**), mux voiceover + subtitles (**mux**), upload to Supabase Storage |
| **Media gateway** | `services/media-gateway` | `8080` (`PORT`) | Single public host: spawns renderer + video-assembly as children and **reverse-proxies** to them |

**Typical URLs**

- n8n / automation: `RENDERER_BASE_URL` → renderer **or** gateway (same paths under `/render*`, `/templates*`, …).
- Video: `VIDEO_ASSEMBLY_BASE_URL` → video-assembly **or** gateway (`/stitch`, `/mux`).

When using the gateway, one base URL can serve **both** families of routes.

---

## 2. Media gateway (`services/media-gateway`)

### Purpose

- Expose **one** HTTP port (e.g. on Fly) while running **renderer** and **video-assembly** as **separate processes** on localhost.
- Apply long **proxy timeouts** (renderer **10 min**, video-assembly **20 min**) so slow Puppeteer/ffmpeg jobs are less likely to be cut off by the gateway than by a dumb edge proxy.

### Behavior

1. On listen, **`startChildren()`** spawns:
   - `node server.js` in `../renderer` with `PORT=RENDERER_PORT` (default **3333**).
   - `node server.js` in `../video-assembly` with `PORT=VIDEO_ASSEMBLY_PORT` (default **3334**).
2. **`http-proxy-middleware`** forwards requests with **`pathRewrite`** so the **original URL** (e.g. `/templates/foo.hbs`) reaches the child unchanged.

### Routes proxied to **renderer**

Prefix match (same paths as standalone renderer):

- `/render`, `/render-binary`, `/render-carousel`, `/render/status`, `/templates`, `/templates/source`, `/output`, `/version`, `/ready`, `/reset`, `/warmup`

### Routes proxied to **video-assembly**

- `/stitch`, `/mux` (includes `/mux/chunk-script`, `/mux/status/...` by prefix)

### Gateway-only endpoint

- **`GET /health`** — JSON: `ok`, `service: "media-gateway"`, child **ports** (does **not** deep-check Chromium or ffmpeg).

### CORS

- Allows `*` origin, `GET/POST/OPTIONS`, `Content-Type` header.

### Lifecycle

- **SIGINT / SIGTERM**: terminates child processes then exits.

### Environment

| Variable | Default | Meaning |
|----------|---------|---------|
| `PORT` | `8080` | Gateway listen port |
| `RENDERER_PORT` | `3333` | Child renderer |
| `VIDEO_ASSEMBLY_PORT` | `3334` | Child video-assembly |

---

## 3. Renderer (`services/renderer`)

### Purpose

- Compile **Handlebars** templates (`.hbs` on disk under `services/renderer/templates/`, optionally merged with templates from the **CAF Next app**).
- Render HTML in **headless Chromium** (Puppeteer), screenshot the **`.slide`** element for the requested **1-based** `slide_index`, write **PNG** under `services/renderer/output/`.
- Serve generated files under **`GET /output/...`**.

### Stack

- **Express**, **Puppeteer**, **Handlebars**.
- **Serialized renders**: a global queue ensures **one** active page at a time (memory safety on small VMs).
- **Browser lifecycle**: optional periodic **`resetBrowser()`** after `RENDERERS_BEFORE_RESET` successful renders (default **12**); **`POST/GET /reset`** closes browser; **`GET /ready`** waits for browser launch; **`GET /warmup`** starts launch in background.

### Template resolution

1. If **`CAF_TEMPLATE_API_URL`** is set: `GET {base}/api/templates/:name` for source (name must end with `.hbs`).
2. Else: file `templates/{name}` on disk.

**`GET /templates`** returns sorted union of disk `*.hbs` and remote names from **`GET {CAF_TEMPLATE_API_URL}/api/templates`**.

### Body normalization (all POST render routes)

- Accepts JSON; tolerates nested `body` wrapper.
- **`data`** may be an object or a **JSON string** (common n8n mistake).
- **`data.render`** may be object or JSON string; becomes the Handlebars context (carousel shape: `body_slides`, `cta_slide`, `cover_slide`, etc. — see **`AGENTS.md`**).
- Strips redundant **`slides_all`** when `body_slides` is present (OOM mitigation).
- **Pack cache** (10 min): if `slide_index` requests arrive with empty `body_slides` but same `task_id` / `job_id`+`run_id`, reuses cached pack from an earlier item.

### Template selection

- `body.template`, or `data.render.html_template_name`, or `data.render.template_key` (`.hbs` appended if missing).

### Endpoints

| Method | Path | Summary |
|--------|------|---------|
| `POST` | `/render` | JSON result with `result_url` path under `/output/...`. Query **`?async=1`**: **202** + `request_id`, poll **`GET /render/status/:requestId`**, then **`GET /output/{relativePath}`**. |
| `POST` | `/render-binary` | Sync: **PNG bytes** (`Content-Type: image/png`). **`?async=1`**: same async contract as `/render` (**JSON** response — not a file). |
| `GET` | `/render/status/:requestId` | `pending` \| `done` \| `error`; when `done`, includes `relativePath`, `result_url`. Jobs expire from memory after **1 hour**. |
| `GET` | `/output/*` | Static files from `output/`. |
| `POST` | `/render-carousel` | Same body as `/render` but **no** `slide_index`; loops all slides (cover + body + CTA). |
| `POST` | `/preview-template` | Playground: forces **slide 1**; body `{ template, data }`. |
| `GET` | `/templates` | List template names. |
| `GET` | `/templates/source/:name` | Raw template source. |
| `GET` | `/health` | `ok`, `version`, `uptime_seconds`. |
| `GET` | `/version` | Version string. |
| `GET` | `/ready` | **503** until browser ready (timeout **60s**). |
| `GET` | `/warmup` | Fire-and-forget browser launch. |
| `POST` / `GET` | `/reset` | Close browser and clear queue. |
| `POST` | `/shutdown` | Exit process if `RENDERER_SHUTDOWN_SECRET` matches header or query. |

### Important request fields

- **`slide_index`** (required for `/render` and `/render-binary`): integer **≥ 1**, 1-based index into **`.slide`** elements.
- **`run_id`**, **`task_id`**: optional; if both used, output path becomes `output/{safe_run_id}/{safe_task_id}/NNN_slide.png`.

### Operational notes

- Viewport **1080×1350**, `deviceScaleFactor: 2`.
- Timeout **90s** per slide (`RENDER_TIMEOUT_MS`).
- Templates must emit one or more elements with class **`.slide`**.
- Fly / heavy templates: avoid SVG noise + blocking Google Fonts on every slide (see **`AGENTS.md`**).

### Environment (subset)

| Variable | Role |
|----------|------|
| `PORT` | Listen port (default 3333) |
| `CAF_TEMPLATE_API_URL` | Next app base URL for Supabase-backed templates |
| `RENDERERS_BEFORE_RESET` | Browser restart cadence (default 12) |
| `RENDERER_SHUTDOWN_SECRET` | Protects `POST /shutdown` |

---

## 4. Video assembly (`services/video-assembly`)

### Purpose

- Run **ffmpeg** (bundled **`ffmpeg-static`** if installed, else **PATH**) to:
  - **Download** scene MP4s from URLs, **concatenate** to one file, **upload** to Supabase Storage (**stitch**).
  - **Download** merged video + voiceover (or per-segment audio), build subtitles (optional **Whisper** alignment with **`OPENAI_API_KEY`**), **burn-in** or sidecar, upload artifacts (**mux**).
- Optional **Supabase `tasks` row update** for `final_video_url` / related columns when `task_id` is provided (see code paths in `server.js`).

### Dependencies

- **`@supabase/supabase-js`** with **`SUPABASE_URL`** / **`NEXT_PUBLIC_SUPABASE_URL`** + **`SUPABASE_SERVICE_ROLE_KEY`** for uploads (and optional DB sync).
- Bucket: **`SUPABASE_ASSETS_BUCKET`** (default **`assets`**).

### Endpoints

| Method | Path | Summary |
|--------|------|---------|
| `GET` | `/health` | Service id, uptime, ffmpeg path, **capability flags** (stitch, mux, burn, whisper, etc.). |
| `POST` | `/stitch` | Body: `parent_id`, `task_id`, `output_path`, `clips[]` with `scene_number`, `url`, optional `scene_id`, `duration_sec`. Query **`?async=1`**: **202** + `job_id`, poll **`GET /stitch/status/:jobId`**. |
| `GET` | `/stitch/status/:jobId` | Job snapshot. |
| `POST` | `/mux` | Large body: `parent_id`, `merged_video_url`, `output_path_final`, voiceover (`voiceover_audio_url` **or** `voiceover_segments`), optional `subtitles_srt`, `scenes_for_srt`, `spoken_script`, `burn_subtitles`, `subtitle_align: "whisper"`, etc. **`?async=1`**: **202** + poll **`GET /mux/status/:jobId`**. |
| `GET` | `/mux/status/:jobId` | Job snapshot. |
| `POST` | `/mux/chunk-script` | Split `script` into TTS-sized `chunks[]` for segmented voiceover. |

### Timeouts and env (subset)

| Variable | Role |
|----------|------|
| `VIDEO_ASSEMBLY_FETCH_TIMEOUT_MS` | HTTP fetch for remote media (default 120000) |
| `VIDEO_ASSEMBLY_FFMPEG_TIMEOUT_MS` | ffmpeg (default 600000) |
| `VIDEO_ASSEMBLY_JOB_TIMEOUT_MS` | Whole job (default 900000) |
| `MUX_BURN_SUBTITLE_FORCE_STYLE` | libass `force_style` override |
| `MUX_BURN_ENCODE_PRESET` / `MUX_BURN_ENCODE_CRF` | Burn-in encode |
| `OPENAI_API_KEY` | Whisper alignment when `subtitle_align` requests it |

Full payload commentary is inline above **`POST /mux`** in `services/video-assembly/server.js` and expanded in **`docs/video-assembly.md`**.

### Error handling

- **uncaughtException**: process **exits** except for **`ENOENT`** (logged; process stays up — temp-file races).

---

## 5. How the three services fit together

```
                    ┌─────────────────┐
                    │  Media gateway  │  :8080 (example)
                    │  (optional)     │
                    └────────┬────────┘
            proxy /render*     proxy /stitch, /mux
                    │                    │
         ┌──────────▼──────────┐  ┌──────▼──────────────┐
         │      Renderer       │  │   Video assembly    │
         │  Puppeteer + HBS    │  │  ffmpeg + Storage   │
         └─────────────────────┘  └─────────────────────┘
```

- **Carousel / image** pipelines: n8n → **renderer** → upload PNGs to Storage (outside this doc) → Supabase `assets` / sheet.
- **Video** pipelines: scene URLs → **stitch** → merged MP4 URL → TTS / audio URL → **mux** → final MP4 + optional SRT.

---

## 6. Related repo files

| Area | Path |
|------|------|
| Gateway | `services/media-gateway/server.js` |
| Renderer | `services/renderer/server.js`, `services/renderer/templates/*.hbs` |
| Video | `services/video-assembly/server.js` |
| Fly / gateway image | `services/media-gateway/`, `fly.media-gateway.toml`, `AGENTS.md` |
| Contracts doc | `docs/video-assembly.md` |

---

*End of CAF services overview.*
