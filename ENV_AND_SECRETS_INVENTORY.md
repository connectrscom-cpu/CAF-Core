# Environment variables and secrets inventory (CAF)

**Purpose:** One checklist of **every** configuration name used by this repo and adjacent ops (n8n, Fly, Vercel), where to set it, and whether it is secret.

**External readers:** See also **`docs/EXTERNAL_CONTEXT_PACK.md`** (Tier 1 includes this file + `.env.example`) and **`docs/REBUILD_FROM_DOCS.md`** (minimum env for bootstrap).

**Security — non-negotiable**

- **Never** commit real tokens, keys, JSON service accounts, or refresh tokens to git.
- Copy **`.env.example`** → **`.env`** locally (`.env` is gitignored).
- Store production values in **Vercel / Fly secrets / n8n credentials / your vault** only.
- The **“Your value (vault only)”** column below is for you to fill **outside** the repo.

---

## Legend

| Column | Meaning |
|--------|---------|
| **Secret?** | `yes` = treat like a password; `no` = non-sensitive URL or flag; `optional secret` = only if you use that feature |
| **Where to set** | Typical location for production |

---

## 0. CAF Core API (repo root) — `src/config.ts`

**Canonical list:** every variable is defined in **`src/config.ts`** (Zod) with defaults. Comments in **`.env.example`**.

| Variable | Secret? | Required | Purpose |
|----------|---------|----------|---------|
| `DATABASE_URL` | **yes** | **yes** | PostgreSQL connection (`caf_core` schema) |
| `OPENAI_API_KEY` | **yes** | for LLM | Generation, QC helpers, mimic copy, insights |
| `OPENAI_MODEL` | no | recommended | Default chat model |
| `PORT` / `HOST` | no | optional | API listen (default **3847**) |
| `CAF_CORE_REQUIRE_AUTH` | no | optional | `1` to require token on protected routes |
| `CAF_CORE_API_TOKEN` | **yes** | when auth on | `x-caf-core-token` or `Authorization: Bearer` |
| `CAF_RUN_MIGRATIONS_ON_START` | no | optional | Apply migrations on startup (default on) |
| `RENDERER_BASE_URL` | no | for carousel | Carousel worker URL |
| `VIDEO_ASSEMBLY_BASE_URL` | no | for video | ffmpeg worker URL |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_ASSETS_BUCKET` | **yes** / no | for assets | Object storage uploads |
| `HEYGEN_API_KEY` | **yes** | for HeyGen flows | Video agent / avatar renders |
| `MIMIC_IMAGE_ENABLED` | no | optional | Master switch for mimic render |
| `MIMIC_IMAGE_PROVIDER` | no | optional | `bfl` \| `dashscope` \| `nvidia` \| `openai` |
| `BFL_API_KEY`, `DASHSCOPE_API_KEY`, `NVIDIA_NIM_API_KEY` | **yes** | per provider | Mimic image edit providers |
| `CAF_PUBLISH_EXECUTOR` | no | optional | `none` \| `dry_run` \| `meta` |
| `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC` | no | optional | Human gate after QC (default true) |
| `CAF_OUTPUT_SCHEMA_VALIDATION_MODE` | no | optional | `skip` \| `warn` \| `enforce` |

Mimic-specific vars: **§10** below. Full bootstrap: **`docs/REBUILD_FROM_DOCS.md`**.

---

## 1. Review app (`apps/review`) — Vercel / local

Review is a **Next.js client of CAF Core** — job state lives in Postgres via Core APIs, not in the Review app database.

| Variable | Secret? | Required | Where to set | Used for |
|----------|---------|----------|--------------|----------|
| `CAF_CORE_URL` | no | **yes** | Vercel env, `apps/review/.env.local` | Core API base (e.g. `http://localhost:3847`) |
| `CAF_CORE_TOKEN` | **yes** | when Core auth on | Vercel env | Sent to Core as `x-caf-core-token` |
| `CAF_CORE_API_TOKEN` | **yes** | optional alias | Some routes | Alternate name used by a few API routes |
| `REVIEW_WRITE_TOKEN` | **yes** | optional | Vercel env | Protects `POST /api/task/.../decision` in Review |
| `RENDERER_BASE_URL` | no | recommended | Vercel env | Carousel preview proxies (default `http://localhost:3333`) |
| `NEXT_PUBLIC_APP_URL` | no | recommended | Vercel env | Absolute links in UI |
| `PROJECT_SLUG` | no | optional | Vercel env | Lock workbench to one tenant; empty = all active projects |
| `REVIEW_ALL_PROJECTS` | no | optional | Vercel env | `1`/`true` = cross-project queue even if `PROJECT_SLUG` set |
| `REVIEW_FALLBACK_PROJECT_SLUG` | no | optional | Vercel env | Fallback when older Core lacks `/v1/review-queue-all/*` |

**Legacy (not used by current Core-backed Review):** Google Sheets queue vars (`GOOGLE_REVIEW_QUEUE_*`, `GOOGLE_SERVICE_ACCOUNT_JSON`, etc.) may appear in old deploy notes — the current app reads the review queue from **Core `/v1/` APIs**.

---

## 2. Renderer service (`services/renderer`) — Fly or local

| Variable | Secret? | Required | Where to set | Used for | Your value (vault only) |
|----------|-----------|----------|--------------|----------|-------------------------|
| `PORT` | no | optional | Fly, local | Listen (default **3333**) | |
| `CAF_TEMPLATE_API_URL` | no | optional | Fly secret | Base URL of **this** Next app for Supabase-backed templates | |
| `RENDERERS_BEFORE_RESET` | no | optional | Fly | Puppeteer restarts after N renders (default 12) | |
| `RENDERER_SHUTDOWN_SECRET` | **yes** | optional | Fly secret | `POST /shutdown` protection | |

---

## 3. Video assembly (`services/video-assembly`) — Fly or local

| Variable | Secret? | Required | Where to set | Used for | Your value (vault only) |
|----------|-----------|----------|--------------|----------|-------------------------|
| `PORT` | no | optional | Fly, local | Listen (default **3334**) | |
| `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL` | no | yes | Fly secret | Upload target project | |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | yes | Fly secret | Storage + optional `tasks` update | |
| `SUPABASE_ASSETS_BUCKET` | no | optional | Fly secret | Bucket (default `assets`) | |
| `OPENAI_API_KEY` | **yes** | optional | Fly secret | Whisper alignment when requested | |
| `OPENAI_WHISPER_MODEL` | no | optional | Fly | Default `whisper-1` | |
| `OPENAI_WHISPER_TIMEOUT_MS` | no | optional | Fly | Whisper HTTP timeout | |
| `VIDEO_ASSEMBLY_FETCH_TIMEOUT_MS` | no | optional | Fly | Download clips/video | |
| `VIDEO_ASSEMBLY_FFMPEG_TIMEOUT_MS` | no | optional | Fly | ffmpeg processes | |
| `VIDEO_ASSEMBLY_JOB_TIMEOUT_MS` | no | optional | Fly | Whole stitch/mux job | |
| `FFMPEG_PATH` | no | optional | Fly | Override binary | |
| `FFPROBE_PATH` / `FFPROBE_TIMEOUT_MS` | no | optional | Fly | Probe media | |
| `TMP_DIR` | no | optional | Fly | Temp working dir | |
| `MUX_BURN_SUBTITLE_FORCE_STYLE` | no | optional | Fly | ASS `force_style` | |
| `MUX_BURN_ENCODE_PRESET` / `MUX_BURN_ENCODE_CRF` | no | optional | Fly | Burn-in encode | |
| `MUX_CHUNK_SCRIPT_MAX_CHARS` | no | optional | Fly / body | TTS chunking | |
| `MUX_MIN_CAPTION_SEC` | no | optional | Fly | Caption pacing | |
| `MUX_CAPTION_WEIGHT_EXPONENT` | no | optional | Fly | Caption pacing | |
| `MUX_CAPTION_TIMING_MODE` | no | optional | Fly | `equal` / `weighted` | |
| `MUX_USE_SCENE_DURATION_FOR_SRT` | no | optional | Fly | Legacy timing | |
| `MUX_SUBTITLE_DURATION_SCALE` | no | optional | Fly | Scale scene SRT | |
| `MUX_SUBTITLE_ALIGN` | no | optional | Fly | e.g. whisper | |
| `MUX_WHISPER_CAPTION_SOURCE` | no | optional | Fly | `payload` / `transcript` | |
| `MUX_SYNC_SUPABASE_TASK` | no | optional | Fly | `0` to skip task row update | |
| `SUPABASE_UPLOAD_MAX_ATTEMPTS` / `SUPABASE_UPLOAD_RETRY_MS` | no | optional | Fly | Upload retry | |

---

## 4. Media gateway (`services/media-gateway`) — Fly

| Variable | Secret? | Required | Where to set | Used for | Your value (vault only) |
|----------|-----------|----------|--------------|----------|-------------------------|
| `PORT` | no | optional | Fly | Gateway listen (default **8080**) | |
| `RENDERER_PORT` | no | optional | Fly | Child renderer port | |
| `VIDEO_ASSEMBLY_PORT` | no | optional | Fly | Child video-assembly port | |

Child processes inherit **same env** as gateway on Fly — set Supabase and mux vars on the **gateway app** so stitch/mux can upload.

---

## 5. GitHub Actions (deploy Fly media-gateway)

| Name | Type | Secret? | Where to set | Used for | Your value (vault only) |
|------|------|---------|--------------|----------|-------------------------|
| `FLY_API_TOKEN` | repository **Secret** | **yes** | GitHub → Settings → Secrets | `flyctl deploy` (`.github/workflows/fly-renderer.yml`) | |
| `FLY_RENDERER_APP` | repository **Variable** | no | GitHub → Settings → Variables | Override Fly app name (`-a`) | |

---

## 6. n8n (instance credentials — not in `.env.example`)

Store these in **n8n → Credentials**, not in the CAF repo.

| Credential type | Typical use in CAF flows | Your value (vault only) |
|-----------------|--------------------------|---------------------------|
| Google Sheets OAuth2 | CREATION, VALIDATION, INPUT, PROCESSING, Signal Pack | |
| OpenAI API | LLM, TTS, Sora/video nodes | |
| Supabase | Direct DB/REST if any node uses it | |
| HeyGen | Video render | |
| HTTP Header Auth / Bearer | `RENDERER_BASE_URL`, `VIDEO_ASSEMBLY_BASE_URL`, mux async poll | |
| Custom | Apify, webhooks, etc. | |

Also record:

| Item | Your value (vault only) |
|------|-------------------------|
| n8n base URL | |
| n8n admin auth method | |
| Per-workflow webhook URLs (if used) | |

---

## 7. Google Cloud / Sheets (operational inventory)

Fill in **outside** the repo (which spreadsheet belongs to which env).

| Resource | Example / note | Your value (vault only) |
|----------|----------------|-------------------------|
| GCP project for Sheets API | | |
| OAuth consent / Desktop or Web client | | |
| Service account email (if used) | Share each spreadsheet with Editor | |
| **VALIDATION** spreadsheet ID | Review Queue tab | |
| **CREATION - Runtime** spreadsheet ID | Signal_Packs, Content_Jobs, … | |
| **PROCESSING** insights spreadsheet ID | Write Signal Pack reads from here | |
| **Flow Engine** spreadsheet ID | Global | |
| **CREATION - Project Config** per brand | | |

---

## 8. Other platforms (from `09_external_integrations.md`)

| Platform | What to store | Your value (vault only) |
|----------|---------------|-------------------------|
| **Supabase** | Project ref, dashboard URL, service role key (above), anon key if any client use | |
| **Fly.io** | Org, app name(s) for gateway/renderer, region | |
| **Vercel** | Project name, team, env vars (mirror §1) | |
| **OpenAI** | Org / project IDs if using scoped keys | |
| **HeyGen** | API key, account | |
| **Apify** | API token, actor IDs | |

---

## 9. Quick “first deploy” checklist

- [ ] Supabase: project created; migrations or SQL applied; bucket `assets` public as needed  
- [ ] Vercel: §1 vars; `NEXT_PUBLIC_APP_URL` = production URL  
- [ ] Google: Review Queue sheet shared with SA or OAuth account (Editor)  
- [ ] Fly (optional): deploy media-gateway; set Supabase + mux + optional `CAF_TEMPLATE_API_URL`  
- [ ] GitHub: `FLY_API_TOKEN` (+ optional `FLY_RENDERER_APP` variable)  
- [ ] n8n: credentials + `RENDERER_BASE_URL` / `VIDEO_ASSEMBLY_BASE_URL` pointing at stable URLs  
- [ ] Rotate any credential that ever touched a public repo  

---

## 10. CAF Core API — top-performer mimic (`src/config.ts`)

Set on the **Core** host (repo root `.env` / Fly secrets). Copy generation requires **`OPENAI_API_KEY`** even when render uses BFL/DashScope/NVIDIA.

| Variable | Secret? | Default | Purpose |
|----------|---------|---------|---------|
| `MIMIC_IMAGE_ENABLED` | no | `false` | Master switch for mimic draft/render |
| `MIMIC_IMAGE_PROVIDER` | no | `bfl` | `bfl` \| `dashscope` \| `nvidia` \| `openai` |
| `BFL_API_KEY` | **yes** | — | BFL FLUX edits when provider=`bfl` |
| `DASHSCOPE_API_KEY` | **yes** | — | Alibaba Qwen edit when provider=`dashscope` |
| `NVIDIA_NIM_API_KEY` | **yes** | — | NIM Qwen edit when provider=`nvidia` |
| `MIMIC_IMAGE_BFL_MODEL` | no | `flux-2-klein-4b` | BFL model slug |
| `MIMIC_VISUAL_SIMILARITY_PCT` | no | `70` | Reference-edit fidelity hint |
| `MIMIC_IMAGE_INPUT_MODE` | no | `reference_edit` | `reference_edit` or `analysis_t2i` |
| `MIMIC_IMAGE_DEFAULT_SIZE` | no | `1024x1536` | Output dimensions |
| `LLM_MIMIC_*_MAX_CHARS` | no | see `.env.example` | Mimic prompt context caps |

Full list: **`.env.example`** (comments) and **`docs/MIMIC_FLOWS_COMPLETE_GUIDE.md`** §13.

---

## 11. Duplicate reference

Canonical **comments** for many Next.js vars also live in **`.env.example`** at the repo root. Prefer updating **`.env.example`** when adding new app-level vars, and add a row here in the matching section.

---

*Inventory version: aligned with repo scan 2026-06-15. Update when new `process.env.*` appears in code.*
