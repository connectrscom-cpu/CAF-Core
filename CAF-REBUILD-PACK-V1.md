# CAF REBUILD PACK — V1 (PARTIAL)

**Scope:** Evidence drawn primarily from this repository (`CAF` backend: Next.js app, `lib/`, `services/renderer`, `services/video-assembly`, `services/media-gateway`, `supabase/migrations`, `docs/`, `.env.example`, `AGENTS.md`, `README.md`). **§6A (Signal Pack)** additionally cites an **external n8n workflow export** (`Write Signal_Pack`) supplied out-of-band — not committed as a workflow file in this repo.  
**Version:** 1 — iterative; extend, do not replace, when new sources arrive.  
**Date note:** Pack authored against repo state as of 2026-04-05; §6A added same date from `Write Signal_Pack (2).json`.

---

## 1. Executive Summary

This repo implements a **CAF Backend** slice: a **Review Console** and **Template Playground** on Next.js, backed by **Supabase** (tasks, assets, templates), **Google Sheets** (Review Queue as gate + decision sink), an **Express + Puppeteer renderer** (`services/renderer`), and **video assembly** (`services/video-assembly`: stitch + mux) optionally fronted by **media-gateway** on one host. **n8n and upstream “Validation” pipelines are not in-repo**; their behavior is inferred only where documentation or comments reference them. **Signal pack creation** is specified from an external **Write Signal_Pack** n8n export in **§6A** (migration target for CAF Core); bundled creation/validation workflow JSON under `docs/` supplements downstream field usage.

**Source-of-truth split (confirmed in code):**

- **Which tasks appear in the review workbench:** Google Sheet row state (merged across one or more spreadsheets), not “all Supabase tasks.”
- **Decisions after submit:** Written **only to the Google Sheet** (not to Supabase `tasks` in `updateTaskDecision`).
- **Task body for display:** Sheet columns **overlay** Supabase `tasks` fields (e.g. `generated_slides_json` from sheet wins when present).

---

## 2. Observed Components

| Component | Location | Role |
|-----------|----------|------|
| Next.js app | `app/` | Review workbench (`/`), task viewer routes, content view, playground, settings, API routes |
| Review / queue logic | `lib/data/review-queue.ts`, `lib/google-sheets.ts`, `lib/cache.ts` | Sheet read/merge, Supabase merge, caching, decision write |
| Types / filters | `lib/types.ts`, `lib/filters.ts` | Row shapes, list filters |
| Task ID normalization | `lib/task-media-ids.ts` | Sheet vs DB ID variants (`__v1`, `__SCENE_BUNDLE`, etc.) |
| Optional webhook | `lib/webhook.ts`, `DECISION_WEBHOOK_URL` | POST after decision |
| Renderer | `services/renderer/server.js` | `/render`, `/render-binary`, async jobs, `/render-carousel`, `/preview-template`, templates |
| Video assembly | `services/video-assembly/server.js` | `/stitch`, `/mux`, `/mux/chunk-script`, job status |
| Media gateway | `services/media-gateway/server.js` | Single port: proxy to renderer + video-assembly children |
| Supabase schema hints | `supabase/migrations/*.sql` | Partial DDL for `tasks`, `assets`, `templates`, storage |
| Docs | `AGENTS.md`, `README.md`, `docs/video-assembly.md`, `docs/review-queue-oauth-setup.md` | Architecture and API contracts |

---

## 3. Review App Reconstruction

### Purpose

Human **validation** of generated content: browse queue tabs (in review, approved, rejected, waiting for rework), open a task, preview media/slides, submit **APPROVED / NEEDS_EDIT / REJECTED** with notes, tags, and optional **final\_\*** overrides.

### Architecture

- **Client:** `app/page.tsx` loads `/api/tasks` with query params (status tab + filters). Facets from `/api/facets`.
- **Server aggregation:** `getReviewQueue(status)` reads Google Sheet(s) → list of `task_id`s per tab → loads `tasks` and `assets` from Supabase → merges sheet row onto DB row → derives `video_url` / thumbnails from task columns, assets, or capped Storage probes (`REVIEW_QUEUE_STORAGE_THUMB_MAX`).
- **First load side effect:** Tasks that appear as `GENERATED` + `READY` get sheet updated to `IN_REVIEW` + `preview_url` (see §6).

### Routes (App Router)

| Route | Notes |
|-------|--------|
| `/` | Workbench (tabs, filters, table) |
| `/t/[task_id]` | Task viewer (confirmed by `app/t/[task_id]/page.tsx` in file listing) |
| `/content/[task_id]` | Stable content view (sheet-independent Supabase-first load for shareable `preview_url`) |
| `/r/[run_id]` | Run-scoped view |
| `/playground` | Template Playground |
| `/settings/renderer` | Renderer health / settings UI |
| `/approved` | Approved listing (uses `/api/approved`) |

### API routes (observed)

- `GET /api/tasks` — paginated, filtered queue (`getReviewQueue` + `filterRows` / `sortRows` / `paginateRows`).
- `GET /api/task/[task_id]` — detail; **requires task to exist in sheet merge path** via `getTaskByTaskId` (404 if not in any sheet bucket).
- `POST /api/task/[task_id]/decision` — auth `x-review-token` vs `REVIEW_WRITE_TOKEN`; writes sheet; optional webhook.
- `GET /api/content/[task_id]` — **Supabase-first** `getTaskByTaskIdFromSupabase`, else queue merge (`getTaskByTaskId`).
- `GET /api/task/[task_id]/assets` — assets for task.
- `GET /api/facets` — facet values for filters.
- `GET /api/approved` — approved tab data.
- `GET /api/renderer/*` — health, templates, preview proxies to `RENDERER_BASE_URL`.
- `GET/POST /api/templates` — Supabase-backed template catalog for Playground.

### Components (non-exhaustive)

- `WorkbenchFilters`, `TaskTable`, `TaskViewer`, `DecisionPanel`, `CarouselEdits`, `CarouselSlider`, UI primitives under `components/ui/`.

### Data fetching

- **List:** `fetch('/api/tasks?…')`.
- **Decision:** `POST /api/task/${taskId}/decision` with JSON body (decision, notes, `rejection_tags[]`, validator, overrides, `template_key`).

### How review items are loaded

1. `getReviewQueueTaskIdsFromSheet()` — parses one or more spreadsheets, tab name `GOOGLE_REVIEW_QUEUE_SHEET_NAME` (default **`Review Queue`**), range `A:AZ`.
2. Row inclusion for **In Review:** `(status == GENERATED && review_status == READY) || (status == IN_REVIEW && review_status == READY)`, and `submit` is not `TRUE`. Header aliases for columns are flexible (e.g. `task_id` / `taskid`, `status` / `pipeline_status`).
3. **Approved / Rejected / Needs edit:** `submit == TRUE` and effective decision from `decision` or review/status columns.
4. Supabase `.from('tasks').select(...).in('task_id', expandedIds)` with ID expansion from `expandTaskIdsForMediaLookup`.

### How decisions are written

- `updateReviewQueueRow(taskId, fields)` — finds row by `task_id`, batch-updates only columns that exist. Write field map in `WRITE_FIELD_TO_HEADERS` in `lib/google-sheets.ts` (submit, decision, notes, rejection_tags, validator, submitted_at, final\_\* overrides, template_key, preview_url; **review_status** maps to first matching column among `status` or `review_status` per code).
- **Note:** `POST /api/task/.../decision` builds an internal `payload` with `review_status: "SUBMITTED"` for typing/webhook, but `updateTaskDecision` writes **`review_status: payload.decision`** (i.e. **APPROVED | NEEDS_EDIT | REJECTED**) to the sheet’s status/review column — **confirmed** in `lib/data/review-queue.ts`. Webhook receives `review_status: "SUBMITTED"` from the route’s payload object.

### Dependencies

- **Supabase:** service role server client (`lib/supabase/server.ts`).
- **Google Sheets API:** `googleapis`, OAuth2 or service account.
- **Renderer:** `RENDERER_BASE_URL` from Next.js for playground/settings.
- **Env:** see `.env.example` (sheet IDs, tokens, `NEXT_PUBLIC_APP_URL`, cache TTL, etc.).

### Task state assumptions

- Sheet rows drive **visibility**; Supabase must contain a matching `tasks.task_id` (possibly after ID expansion) for rich rows.
- `DecisionPanel` forces **NEEDS_EDIT** if user chose Approve but `hasEdits` is true (client-side).

### Limitations / coupling

- **Empty queue** if sheet IDs missing or auth missing (no fallback to “all DB tasks”).
- **Hardcoded** optional merge of a specific “Cuisina” spreadsheet ID in `lib/google-sheets.ts` unless `REVIEW_QUEUE_NO_CUISINA_SHEET` is set.
- **`.env.example` comment** says decisions live in Supabase — **contradicts** current code path (decisions → sheet only); treat comment as **stale** unless a future version writes DB again.

---

## 4. Supabase Reconstruction

Legend: **CONFIRMED** = migration or code reference; **INFERRED** = partial / naming only; **UNKNOWN** = not in repo.

### Tables

| Table | CONFIRMED in migrations | Notes |
|-------|-------------------------|--------|
| `public.tasks` | Partial | Review columns: `decision`, `notes`, `rejection_tags`, `validator`, `submit`, `submitted_at` (`20250304000000`). Overrides: `final_title_override`, `final_hook_override`, `final_caption_override`, `final_slides_json_override` (`20250305200000`). `template_key` (`20250306100000`). Video URLs: `merged_video_url`, `final_video_url`, `voiceover_url`, `subtitles_url` (`20260316000000`). **No `CREATE TABLE tasks` in this repo** — base columns (**UNKNOWN** beyond what code selects). |
| `public.assets` | Partial | `bucket`, `object_path` added (`20250305150000`). Code selects `task_id`, `public_url`, `asset_type`, `bucket`, `object_path`, ordered by `position`. **Full original schema UNKNOWN.** |
| `public.templates` | **CONFIRMED** | `name` PK, `source`, `updated_at` (`20250305120000`). |

### Storage

- **CONFIRMED:** Migrations and comments refer to bucket **`assets`** (`20250305140000_storage_assets_bucket.sql`, video-assembly upload paths).
- **INFERRED:** Public URLs built as `{SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}` in `review-queue.ts`.

### Entity structures (from code usage)

- **Task row (queue list select):** `task_id, project, run_id, platform, flow_type, risk_score, qc_status, status, final_video_url, merged_video_url, created_at, generated_title, generated_hook, generated_caption, recommended_route` — **CONFIRMED** string in `review-queue.ts` (slim select); falls back to `*` on 42703.
- **ReviewQueueRow:** `Record<string, string | undefined>` — merged sheet + DB — **CONFIRMED** type.

### Relationships

- **INFERRED:** `assets.task_id` → `tasks.task_id` (foreign key not shown in migrations here).

### Source of truth

- **Workbench visibility + post-submit decisions + overlay content columns:** **Google Sheet** — **CONFIRMED**.
- **Canonical task record + assets for media:** **Supabase** — **CONFIRMED** for storage; sheet overlays on read.

---

## 5. Fly / Service Layer Reconstruction

### media-gateway (`services/media-gateway`)

- **CONFIRMED:** Listens `PORT` (default 8080); spawns child processes: renderer (`../renderer/server.js`, `RENDERER_PORT` default 3333), video-assembly (`../video-assembly/server.js`, `VIDEO_ASSEMBLY_PORT` default 3334).
- **Proxies:** Renderer paths `/render`, `/render-binary`, `/render-carousel`, `/render/status`, `/templates`, `/templates/source`, `/output`, `/version`, `/ready`, `/reset`, `/warmup`. Video: `/stitch`, `/mux`.
- **Health:** `GET /health` returns gateway + child ports (not deep downstream check).

### Renderer (`services/renderer`)

- **CONFIRMED endpoints** (from `grep` + partial read): `POST /render`, `POST /render-binary` (`?async=1` → 202 + `request_id`, poll `GET /render/status/:requestId`, then `GET /output/...`), `GET /render/status/:id`, `GET /output/*`, `GET /health`, `GET /version`, `GET /ready`, `GET|POST /reset`, `GET /warmup`, `GET /templates`, `GET /templates/source/:name`, `POST /preview-template`, `POST /render-carousel`.
- **Job pattern:** In-memory `asyncJobs` map; statuses `pending` | `done` | `error` — **CONFIRMED** for render-binary async path.
- **Body hints:** `slide_index` required for render-binary; `template` or nested `data.render.html_template_name` / `template_key`; `job_id`, `run_id`, `task_id` optional for paths — **CONFIRMED** in `server.js` excerpt.

### Video assembly (`services/video-assembly`)

- **CONFIRMED:** `POST /stitch` — body `parent_id`, `task_id`, `output_path`, `clips[]` (`scene_number`, `url`, optional `scene_id`, `duration_sec`). Async: `?async=1` → 202, `job_id`, `GET /stitch/status/:jobId`.
- **CONFIRMED:** `POST /mux` — large body per comment block in `server.js` and `docs/video-assembly.md` (`merged_video_url`, `voiceover_audio_url` or `voiceover_segments`, optional SRT/scenes, burn, Whisper align, `output_path_*`, optional `task_id` for Supabase sync).
- **CONFIRMED:** `POST /mux/chunk-script`, `GET /mux/status/:jobId`, `GET /health`.
- **Storage:** Upload to Supabase using service env vars — **CONFIRMED** by code comments and doc.

### Error handling (pattern)

- JSON `{ ok: false, error: "..." }` with 4xx/5xx — **CONFIRMED** in excerpts.
- **INFERRED:** Fly proxy timeouts documented in `AGENTS.md` / `fly.toml` (not fully re-read here).

---

## 6. Google Sheets Reconstruction

### Workbook / tab

- **Tab name:** default **`Review Queue`** (`GOOGLE_REVIEW_QUEUE_SHEET_NAME`).
- **Multiple spreadsheets:** `GOOGLE_REVIEW_QUEUE_SPREADSHEET_ID` (can be list), `GOOGLE_REVIEW_QUEUE_SPREADSHEET_IDS_EXTRA`, optional built-in third ID (Cuisina) — **CONFIRMED** `parseReviewQueueSpreadsheetIds()`.
- **Merge order:** Earlier spreadsheet wins for duplicate `task_id` on read; **writes** try Cuisina spreadsheet first when enabled — **CONFIRMED**.

### Column roles (read)

- **Identifiers:** `task_id` (alias `taskid`) — **CONFIRMED**.
- **Status gating:** `status` (aliases `pipeline_status`, `task_status`); optional `review_status` (aliases `queue_status`, `validation_status`, `review_state`) — defaults to treated as **`READY`** if column missing — **CONFIRMED**.
- **Submit flag:** `submit` or `submitted` — **CONFIRMED**.
- **Decision:** `decision` or `review_decision` — **CONFIRMED** for submitted rows.
- **All headers** normalized to keys like `generated_slides_json` — **CONFIRMED** `normalizeSheetHeaderKey`.

### Columns written on decision (when present on sheet)

From `WRITE_FIELD_TO_HEADERS` — **CONFIRMED:**  
`submit`, `status`/`review_status` (same logical field for “review_status” write key), `decision`, `notes`, `rejection_tags`, `validator`, `submitted_at`, `final_title_override`, `final_hook_override`, `final_caption_override`, `final_hashtags_override` / `hashtags_override`, `final_slides_json_override`, `template_key`, `preview_url`.

### Role in system

- **Gate** for Review Console + **audit trail** for human decisions and overrides — **CONFIRMED**.

---

## 6A. Signal Pack contract (Write Signal_Pack workflow)

**Status:** Extraction and formalization only — **no redesign**. This section is the intended **source of truth** for a future **CAF Core** implementation of “write signal pack”; today the logic lives in **n8n** (Code node) plus **Google Sheets** I/O.

**Primary evidence:** n8n export **`Write Signal_Pack (2).json`** (workflow name `Write Signal_Pack`). Node names below match that export.

### 6A.1 Placement in CAF architecture

| Layer | Responsibility (as stated by product direction) |
|-------|--------------------------------------------------|
| **Input** | n8n + Google Sheets (insights ingestion — upstream of this workflow) |
| **Processing** | n8n (orchestration, including this workflow until migrated) |
| **CAF Core (future)** | Only the **Write Signal Pack** step is targeted for migration; sheets may remain sources/sinks until further changes. |

### 6A.2 Google Sheets dependencies (**CONFIRMED** from workflow JSON)

**Source workbook (read-only pulls):** spreadsheet titled **`PROCESSING - SNS Insights`** (`documentId` `1T4AcFdDqd3JFvlzflqobjqo7xl1jy6giJL7IyyM2Ga4`). Six tabs are read in parallel (each via a **Get row(s)** style Google Sheets node — no row filters in the export):

| Tab (cached name in export) | Role |
|----------------------------|------|
| **Overall** | Pool of candidate rows; filtered in Code by fields below |
| **IG Summary** | Instagram summary rows |
| **TikTok Summary** | TikTok summary rows |
| **Reddit Summary** | Reddit summary rows |
| **FB Summary** | Facebook summary rows |
| **HTML Summary** | HTML / web summary rows |

**Target workbook (write):** spreadsheet titled **`CREATION - Runtime`** (`documentId` `1fUl6iIhCRe9dzM2Ueq4HOZV_fg1x6DvsgVZzqp3qlcI`), tab **`Signal_Packs`** (`gid=0`). Operation: **`appendOrUpdate`** with **`mappingMode`: `autoMapInputData`**. **`matchingColumns`** in the export is an **empty array** — **CONFIRMED** as serialized; **INFERRED:** runtime behavior depends on n8n/Google Sheets node version (whether upsert key falls back to first column or always appends).

**INFERRED (environment drift):** The creation-router workflow in `docs/CAF creation layer.json` references a **different** `CREATION - Runtime` spreadsheet id (`1q3S7YifpJkGsdMTDcd7PLwbRjWI-B8l05ewQA4GllpY`) for **Signal_Packs**. Treat **column names and JSON shapes** as the stable contract; **spreadsheet ids** are deployment-specific.

### 6A.3 Control flow (**CONFIRMED**)

1. **Manual trigger** fans out to all six **Get** nodes.
2. All six outputs feed a **Merge** node (`numberInputs: 6`).
3. **Merge** → **Code** (`Code in JavaScript`, mode *run once for all items*).
4. **Code** → **Append or update row in sheet**.

**Code access pattern:**

- Platform summaries: `$items("Get IG Summary")`, `$items("Get TikTok Summary")`, `$items("Get Reddit Summary")`, `$items("Get FB Summary")`, `$items("Get HTML Summary")` — each mapped to `json` row objects.
- Rows arriving as `items` on the Code input: treated as the **Overall** stream (`items.map(i => i.json)`).

**INFERRED:** Exact item ordering and cardinality from **Merge** depend on n8n Merge node configuration (export only sets `numberInputs`). The Code node does **not** rely on Merge to supply IG/TT/etc. rows; it re-fetches those by node name. It **does** rely on `items` containing **Overall** rows (plus any other merged rows that pass or fail the candidate filter).

### 6A.4 Constants (**CONFIRMED** from Code)

| Constant | Value | Meaning |
|----------|--------|---------|
| `PROJECT` | `"SNS"` | Written as `project` on the signal pack row |
| `SOURCE_WINDOW` | `"last_7_days"` | Written as `source_window` (label only; see `DAYS`) |
| `DAYS` | `7` | Rolling window for **`generated_at`** filter on **Overall** candidate rows |

### 6A.5 Time window and row selection (**CONFIRMED**)

- **`cutoff`:** now minus `DAYS` calendar days.
- **`filterRecent(rows, dateField)`:** keeps rows where `generated_at` parses to a date **≥ cutoff**.
- **`newestRow(rows, dateField)`:** among rows with a valid `generated_at`, returns the single row with the **latest** `generated_at` (used for each platform summary sheet).

Default date field name: **`generated_at`**.

### 6A.6 Overall “candidate” row filter (**CONFIRMED**)

From the merged Overall stream, a row is treated as a **candidate** only if all are truthy:

- `platform`
- `format`
- `content_idea`

Then **`filterRecent`** is applied with `generated_at`. If **no** rows remain, the Code node returns **`[]`** — **no row is written** to **Signal_Packs**.

**INFERRED:** The filter is **not** keyed on sheet name — any item in `items` with truthy `platform`, `format`, and `content_idea` is treated as a candidate. If non-Overall merge inputs ever contained those columns, they could be mixed into `overall_candidates_json`.

**INFERRED:** Full column set on **Overall** sheet is **not** in the export; only the fields **read by the Code** are specified below (**CONFIRMED** usages).

### 6A.7 Fields read from each Overall candidate row (**CONFIRMED**)

| Field | Use |
|-------|-----|
| `generated_at` | Recency filter; ordering for `created_at` |
| `platform` | Candidate gate |
| `format` | Candidate gate; contributes to `global_winning_formats` |
| `content_idea` | Candidate gate; contributes to `cross_platform_themes` |
| `trend_or_trigger` | Tokenized for `global_engagement_triggers` and `global_rising_keywords` |
| `keywords_hashtags` | Tokenized for `global_rising_keywords` |
| `confidence_score` | Numeric; averaged into `confidence_score_avg` |
| `evidence_urls` | Flattened into `reference_post_ids` (embedded in `notes` only) |

### 6A.8 Platform summary row usage (**CONFIRMED**)

For each platform sheet, **one** row is chosen: **`newestRow`** by `generated_at`. The **entire row object** is `JSON.stringify`’d into the corresponding `*_summary_json` column, or `""` if no row.

**Platform-specific fields for `platform_alignment_summary` only** (first line or fallback):

| Source | Fields (expression in Code) |
|--------|----------------------------|
| IG | `row["key_takeaways (short bullets)"]` — first line split by `\n` |
| TikTok | same as IG |
| Reddit | `reddit.winning_formats` |
| Facebook | `fb.winning_post_types` **or** `fb.winning_formats` |
| HTML | `html.winning_formats` **or** `html.winning_angles` |

**INFERRED:** Full schemas of IG / TikTok / Reddit / FB / HTML summary tabs are **whatever columns exist** in those sheets; only the above keys are referenced by this workflow.

### 6A.9 Transformations and enrichment (**CONFIRMED**)

- **`splitKeywords(s)`:** remove `#`; replace non-`[\w\s-]` with space; split on whitespace, comma, semicolon, pipe, newline; trim; lowercase; drop tokens with length **≤ 2**.
- **`joinSemi(arr, limit)`:** dedupe (trimmed string uniqueness), cap at `limit`, join with **`"; "`** (semicolon + space).
- **`global_winning_formats`:** `joinSemi(overallRecent.map(r => r.format), 10)`.
- **`global_engagement_triggers`:** `joinSemi` over `overallRecent.flatMap(r => splitKeywords(r.trend_or_trigger))`, limit **20**.
- **`global_rising_keywords`:** `joinSemi` of `splitKeywords` on both `trend_or_trigger` and `keywords_hashtags` across all recent candidates, limit **30**.
- **`cross_platform_themes`:** `joinSemi(overallRecent.map(r => r.content_idea), 15)`. Code comment: *“v1 themes: from content ideas (replace later with true themes)”* — **CONFIRMED** as author intent in workflow, not as production rule elsewhere.
- **`reference_post_ids`:** `joinSemi(overallRecent.map(r => r.evidence_urls).filter(Boolean), 20)` — **only** appended into **`notes`** string, not a dedicated column.
- **`platform_alignment_summary`:** single string, segments joined with **`" | "`**, templates `IG → …`, `TikTok → …`, `Reddit → …`, `FB → …`, `HTML → …`, with `"(empty)"` or `"summary"` fallbacks per branch.
- **`created_at`:** `overallRecent` sorted descending by `generated_at`; take **`overallRecent[0].generated_at`**, or `new Date().toISOString()` if missing.
- **`run_id`:** `` `${PROJECT}_${isoWeekId(created_at)}` `` where `isoWeekId` is **ISO week** `YYYY` + `W` + zero-padded week number (UTC-based algorithm in Code).
- **`total_candidates_count`:** `overallRecent.length`.
- **`confidence_score_avg`:** mean of numeric `confidence_score` over recent candidates, **one decimal** as string; **`""`** if none numeric.
- **`notes`:** template string including cutoff days and flattened `reference_post_ids` or `"(none)"`.

### 6A.10 Output row schema — **Signal_Packs** (**CONFIRMED** column ids from Append node `schema`)

All values are produced by the Code node as a **single** `json` object; the sheet node maps fields **by name** (`autoMapInputData`).

| Column / key | Type (logical) | Definition |
|--------------|------------------|------------|
| `run_id` | string | `{PROJECT}_{isoWeekId}` |
| `project` | string | Constant `SNS` |
| `created_at` | string (ISO-like) | Newest candidate `generated_at` or now |
| `source_window` | string | `last_7_days` |
| `ig_summary_json` | string | JSON string of newest IG summary row, or empty |
| `tiktok_summary_json` | string | JSON string of newest TikTok summary row, or empty |
| `reddit_summary_json` | string | JSON string of newest Reddit summary row, or empty |
| `fb_summary_json` | string | JSON string of newest FB summary row, or empty |
| `html_summary_json` | string | JSON string of newest HTML summary row, or empty |
| `overall_candidates_json` | string | **`JSON.stringify(overallRecent)`** — array of **Overall** rows after candidate + 7-day filters |
| `platform_alignment_summary` | string | Human-readable cross-platform one-liner |
| `cross_platform_themes` | string | Semicolon-joined **content_idea**s (cap 15) |
| `global_rising_keywords` | string | Semicolon-joined cleaned tokens (cap 30) |
| `global_winning_formats` | string | Semicolon-joined **format** values (cap 10) |
| `global_engagement_triggers` | string | Semicolon-joined tokens from **trend_or_trigger** (cap 20) |
| `total_candidates_count` | number | Count of recent candidates |
| `confidence_score_avg` | string | Mean or empty |
| `notes` | string | Audit / debug prose including evidence flattening |

**Canonical bundle for downstream parsers:** `overall_candidates_json` is the **structured** list consumed by creation layer (**CONFIRMED** in `docs/CAF creation layer.json`: `JSON.parse(latestPack.overall_candidates_json)`). Other `*_summary_json` fields are **opaque JSON strings** unless downstream code parses them.

### 6A.11 Minimum logical schema of one element inside `overall_candidates_json` (**CONFIRMED** as required by this workflow)

For a row to **enter** `overallRecent` and thus the written JSON:

- **Required (non-empty / truthy):** `platform`, `format`, `content_idea`
- **Required for time filter:** parseable `generated_at` within last **7** days

**Optional but read if present:** `trend_or_trigger`, `keywords_hashtags`, `confidence_score`, `evidence_urls`

**INFERRED:** Additional columns on **Overall** pass through into `overall_candidates_json` unchanged (they remain in each object inside the stringified array) and may be used by **downstream** n8n or Core — **not** read by this Code node.

### 6A.12 Downstream assumptions (**CONFIRMED** from `docs/CAF creation layer.json` creation router)

The **Create Run + Candidate (Router)** workflow expects a **Signal_Packs** sheet read and uses at least:

- `overall_candidates_json` — parsed as JSON array of **candidates**; each candidate object includes fields like `platform`, `format`, `row_number`, hooks/CTAs/ideas per that workflow’s Code (e.g. `hook_template`, `cta_template`, `idea_description` — **CONFIRMED** there, **not** in Write Signal_Pack Code).

**INFERRED — contract gap:** Write Signal_Pack only **requires** `platform`, `format`, `content_idea` on Overall rows. The router also references **`row_number`**, **`hook_template`**, **`cta_template`**, **`idea_description`** when building tasks. Those columns must be present on **Overall** rows **in production** for the router to behave as authored, or the router must tolerate missing fields — **not specified** in Write Signal_Pack export. Flag as **assumption** for integration testing.

Other downstream uses (**INFERRED**): `run_id`, `project`, `signal_pack_run_id` (often aliased from `run_id` in later nodes), and platform summary JSONs for **context** objects in carousel/video prep — see bundled workflows in `docs/CAF creation layer.json`.

### 6A.13 Non-goals (this extraction)

- Replacing **`PROJECT` / `DAYS` / keyword rules** with configurable Core flags.
- Defining the **Overall** or summary sheet **DDL** beyond used keys.
- Resolving **spreadsheet id** discrepancies across exports.

---

## 7. Recoverable Data Contracts

| Field / concept | Purpose | Type (as used) | Confidence |
|-----------------|---------|----------------|------------|
| `task_id` | Primary task key in sheet + DB | string; variants with `__v1`, `__SCENE_BUNDLE`, etc. | **CONFIRMED** |
| `run_id` | Filter / grouping | string | **CONFIRMED** in selects and filters |
| `project`, `platform`, `flow_type` | Facets | string | **CONFIRMED** |
| `candidate_id` | Optional facet column | string | **INFERRED** — used in `filters.ts`; not in slim task select; **UNKNOWN** DB column presence |
| Sheet `status` | Pipeline row state (`GENERATED`, `IN_REVIEW`, …) | string (normalized uppercase) | **CONFIRMED** |
| Sheet `review_status` | Queue readiness (`READY`, …) | string | **CONFIRMED** |
| `submit` | Whether decision was submitted | `TRUE` / empty | **CONFIRMED** |
| Decision values | Human outcome | `APPROVED`, `NEEDS_EDIT`, `REJECTED` | **CONFIRMED** (`lib/types.ts`, API) |
| `rejection_tags` | Issue taxonomy | API: string[] → sheet string (JSON.stringify in route) | **CONFIRMED** |
| `preview_url` | Stable link to `/content/{task_id}` | URL string | **CONFIRMED** |
| `generated_slides_json` | Carousel JSON for UI | string (JSON in cell) | **CONFIRMED** as expected column |
| `template_key` | Rerender template hint | string | **CONFIRMED** (DB migration + sheet write) |
| Render `request_id` | Async render job id | UUID string | **CONFIRMED** |
| Stitch `job_id` | Async stitch job | string (`stitch_*`) | **CONFIRMED** |
| Mux `job_id` | Async mux job | string (`mux_*`) | **CONFIRMED** |
| `asset_type` | Asset classification | string (e.g. `final_video`, `merged_video`, `scene_clip`, `video`) | **CONFIRMED** in review-queue priority list |
| `clips[].scene_number` | Stitch ordering | number | **CONFIRMED** |
| Signal pack `run_id` | Weekly-ish id `SNS_{ISOWeek}` etc. | string | **CONFIRMED** §6A (Write workflow) |
| `overall_candidates_json` | Array of Overall rows (string in sheet) | string → JSON array | **CONFIRMED** §6A; consumed by creation router in `docs/CAF creation layer.json` |
| `ig_summary_json` / `tiktok_summary_json` / … | Newest platform summary row stringified | string (JSON) | **CONFIRMED** §6A |
| `global_rising_keywords` / `global_winning_formats` / `global_engagement_triggers` | Semicolon-joined derived fields | string | **CONFIRMED** §6A |
| `platform_alignment_summary` | Single cross-platform summary line | string | **CONFIRMED** §6A |

---

## 8. Confirmed End-to-End Flow (In-Repo Only)

1. **Upstream** (not in repo) writes a row to **Review Queue** sheet with `GENERATED` + `READY`, `submit` not true, and creates/updates **Supabase** `tasks` (+ `assets`).
2. **Reviewer** opens CAF Backend `/`; server reads sheet → task_id list → loads Supabase → merges → returns rows.
3. On first listing, rows still `GENERATED` get sheet patch to **`IN_REVIEW`** and **`preview_url`**.
4. **Reviewer** opens task, submits decision → **POST** with token → **`updateReviewQueueRow`** only → caches invalidated → optional **`DECISION_WEBHOOK_URL`** POST (payload includes `review_status: "SUBMITTED"`).
5. **Content link** `/content/[task_id]` loads primarily from Supabase so link survives removal from queue.

**Parallel path (not fully wired in this doc):** n8n calls **renderer** and **video assembly** at deployed base URLs; results land in **Storage** / **tasks** columns per migrations and `docs/video-assembly.md`.

**Signal pack path:** Upstream n8n + Google Sheets produce a **Signal_Packs** row (§6A). The bundled creation workflow `3.1 - Create Run + Candidate (Router)` in `docs/CAF creation layer.json` reads **latest** pack row(s), parses **`overall_candidates_json`**, and fans out **Content_Jobs** / tasks — **CONFIRMED** from that export’s Code node comments and sheet node names.

---

## 9. Inferred System Behavior

- **Validation layer** is a separate process that maintains the Google Sheet; **INFERRED** from architecture docs and absence of sheet-write code outside decisions + IN_REVIEW marking.
- **`candidate_id` format** in examples looks like `{project}_{run}_{ordinal}` — **INFERRED** from `docs/video-assembly.md` and `caf-doc-extract.txt` (extract file is **not verified** as authoritative).
- **n8n** orchestrates render → upload → sheet append — **INFERRED** from `AGENTS.md` / `.env.example`.
- **DB columns `decision`, `submit` on tasks** may be **legacy or parallel** to sheet; current decision API does not update them — **INFERRED**.

---

## 10. Missing CAF Layers (Not in This Repo)

- **Full `tasks` / `assets` DDL** and RLS policies.
- **Most n8n workflows** and exact JSON shapes produced by generators — **partially addressed** for **Write Signal_Pack** output + **Signal_Packs** columns in **§6A**; creation/validation bundles under `docs/CAF * layer.json` are **archives**, not executed source.
- **Validation / sheet append** automation (how rows get `GENERATED` + `READY`).
- **Auth beyond review write token** (no end-user login model described in reviewed files).
- **Production monitoring, rate limits, multi-tenant isolation** beyond env-based config.
- **Complete renderer input schema** (only partial from `server.js`).

---

## 11. Rebuild Implications

- Reimplementing the Review Console **requires** Google Sheet contract + Supabase rows with **matching `task_id` discipline** (or the same `expandTaskIdsForMediaLookup` rules).
- A greenfield CAF could **replace the sheet** with a DB queue table, but must re-spec visibility rules currently encoded in `parseReviewQueueSheetGrid`.
- **Media-gateway** pattern is optional for deploy; services can run on separate URLs (`RENDERER_BASE_URL` vs `VIDEO_ASSEMBLY_BASE_URL`).

---

## 12. Unknowns / Open Questions

- Exact **canonical `task_id` grammar** across all pipelines (only **partial** rules in `task-media-ids.ts`).
- Whether **Supabase task decision columns** are still written by any external job.
- **Full list** of sheet columns used by Validation in the wild vs what the app writes.
- **RLS** and service-role usage boundaries in production.
- Whether **`caf-doc-extract.txt`** matches production (treat as **unverified** reference).

---

## 13. Extension Guidelines for Future Updates

**Env / secrets checklist (do not put values in git):** see **`docs/ENV_AND_SECRETS_INVENTORY.md`** and **`docs/caf-handoff/README.md`**.

1. **Integrate new sources** by appending a **“Change log”** subsection at the end of this file (date, source id, author) and editing the **relevant section** only.
2. **Section mapping:**  
   - n8n / orchestration → §6A (signal pack write), §8, §9, §10.  
   - DB schema dumps → §4, §7.  
   - Sheet template changes → §6, §6A, §7.  
   - New services → §5, §7.  
   - UI behavior → §3.
3. **Contradictions:** Keep **both** statements with labels **CONFIRMED (source A)** vs **CONFIRMED (source B)** until reconciled; never silent overwrite.
4. **Upgrade inferred → confirmed:** Require **primary evidence** (code, migration, or authenticated runtime capture). Replace **INFERRED** with **CONFIRMED** and cite file path or doc anchor.
5. **Versioning:** Bump heading to **V2**, **V3**, … when: (a) any **CONFIRMED** fact is retracted or replaced, or (b) a **new subsystem** is added. Minor additions only extend Vn with changelog.

---

## 14. Migration Starter Pack

### A. Safe to reuse immediately

- `lib/google-sheets.ts` (minus org-specific spreadsheet ID if undesired), `lib/data/review-queue.ts`, `lib/task-media-ids.ts`, `lib/cache.ts`, `lib/filters.ts`, `lib/types.ts` (with env review).
- `services/renderer` and `services/video-assembly` as **contracts** (expect env + Puppeteer/ffmpeg runtime).
- `supabase/migrations` as **additive** hints (validate against your real DB).
- `docs/video-assembly.md` for stitch/mux integration.

### B. Must be rewritten or reconfigured

- **Hardcoded Cuisina spreadsheet ID** in `google-sheets.ts` — remove or parameterize for your org.
- **DEFAULT_APP_URL** in `review-queue.ts` (`https://caf-review.vercel.app`) — set `NEXT_PUBLIC_APP_URL`.
- **`.env.example`** decision/Supabase wording if you adopt sheet-only decisions.
- **Fly / deploy** configs — app names, regions, secrets (repo-specific).

### C. Missing dependencies still required

- **Supabase project** with compatible `tasks` / `assets` / optional `templates`.
- **Google Cloud** project + Sheet shared with OAuth or service account.
- **Deployed renderer** (Puppeteer-capable host) and optional **video assembly** host.
- **Secrets:** `REVIEW_WRITE_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, sheet auth, optional `DECISION_WEBHOOK_URL`, `RENDERER_BASE_URL`, `VIDEO_ASSEMBLY_BASE_URL`.

---

*End of CAF REBUILD PACK — V1 (PARTIAL).*
