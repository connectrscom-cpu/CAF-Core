# Environment variables and secrets inventory (CAF)

**Purpose:** One checklist of **every** configuration name used by this repo and adjacent ops (n8n, Fly, Vercel), where to set it, and whether it is secret.

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

## 1. Next.js app (Vercel / local) — `lib/`, `app/api/`

| Variable | Secret? | Required | Where to set | Used for | Your value (vault only) |
|----------|-----------|----------|--------------|----------|-------------------------|
| `NEXT_PUBLIC_SUPABASE_URL` | no | yes | Vercel env, local `.env` | Supabase project URL (browser + server) | |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes** | yes | Vercel env, local `.env` | Server API: tasks, assets, templates (bypasses RLS) | |
| `REVIEW_WRITE_TOKEN` | **yes** | yes (for POST decision) | Vercel env, local `.env` | `x-review-token` on `POST /api/task/.../decision` | |
| `NEXT_PUBLIC_REVIEW_WRITE_TOKEN` | **yes** | optional | Vercel env | Client-side DecisionPanel when you embed token (prefer header from secure origin in prod) | |
| `DECISION_WEBHOOK_URL` | optional secret | no | Vercel env | POST after sheet decision | |
| `RENDERER_BASE_URL` | no | recommended | Vercel env | Proxy to renderer: health, templates, preview | |
| `VIDEO_ASSEMBLY_BASE_URL` | no | optional | Vercel env | If UI or tools call stitch/mux via app | |
| `CAF_TEMPLATE_API_URL` | no | optional | Vercel env | Not required on Next.js for DB templates; **renderer** uses this to pull `.hbs` from `GET /api/templates` | |
| `GOOGLE_REVIEW_QUEUE_SPREADSHEET_ID` | no* | yes* | Vercel env | Validation sheet ID(s); comma/semicolon/newline for merge | |
| `GOOGLE_REVIEW_QUEUE_SPREADSHEET_IDS_EXTRA` | no | optional | Vercel env | Additional queue spreadsheets | |
| `GOOGLE_REVIEW_QUEUE_SHEET_NAME` | no | optional | Vercel env | Tab name (default `Review Queue`) | |
| `REVIEW_QUEUE_NO_CUISINA_SHEET` | no | optional | Vercel env | `1` / `true` to skip hardcoded Cuisina merge in `google-sheets.ts` | |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | **yes** | one auth path | Vercel env (string) | Sheets API as service account | |
| `GOOGLE_APPLICATION_CREDENTIALS` | no (path) | local only | local `.env` | Path to SA key file | |
| `GOOGLE_CLIENT_ID` | no | OAuth path | Vercel env | Sheets OAuth (see `review-queue-oauth-setup.md`) | |
| `GOOGLE_CLIENT_SECRET` | **yes** | OAuth path | Vercel env | OAuth client secret | |
| `GOOGLE_REFRESH_TOKEN` | **yes** | OAuth path | Vercel env | Long-lived refresh token | |
| `NEXT_PUBLIC_APP_URL` | no | recommended | Vercel env | Absolute `preview_url` / content links | |
| `CACHE_TTL_SECONDS` | no | optional | Vercel env | Sheet/queue cache TTL | |
| `REVIEW_QUEUE_STORAGE_THUMB_MAX` | no | optional | Vercel env | Cap Storage probes for video thumbs on list | |

\*If Review Queue is disabled/missing, console shows empty queue (still set for production).

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

## 10. Duplicate reference

Canonical **comments** for many Next.js vars also live in **`.env.example`** at the repo root. Prefer updating **`.env.example`** when adding new app-level vars, and add a row here in the matching section.

---

*Inventory version: aligned with repo scan 2026-04-05. Update when new `process.env.*` appears in code.*
