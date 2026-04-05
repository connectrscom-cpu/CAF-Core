# Supabase schema and architecture (CAF backend)

This document summarizes how **Supabase** is used in this repo: **migrations** that ship with the project, **Storage**, and how the **Next.js** app and **video-assembly** service read/write data. It is **not** a full dump of a production database — the base **`tasks`** / **`assets`** tables may have been created outside these migrations.

**Related:** `AGENTS.md` (Review Queue vs Supabase), `lib/supabase/server.ts`, `lib/data/review-queue.ts`, `supabase/migrations/*.sql`, `docs/caf-services-media-renderer-video.md`.

---

## 1. Architectural role

| Concern | Supabase usage |
|---------|----------------|
| **Task and asset records** | Rows in **`public.tasks`** and **`public.assets`** hold generated content metadata and URLs; n8n and services insert/update rows. |
| **Review Console display** | Server loads **`tasks`** + **`assets`** by `task_id`, merges **Google Sheet** columns on top for the workbench (sheet is gate + decision sink). |
| **Template Playground** | **`public.templates`** stores custom `.hbs` sources; Next.js **`/api/templates`** reads/writes via service role. |
| **Media files** | **`storage.buckets.assets`** (public read) holds carousels, videos, audio, subtitles, etc. |
| **Video assembly** | **`video-assembly`** uploads to Storage and optionally updates **`tasks`** URL columns. |

**Auth model (this repo)**

- **Next.js API routes** use **`getSupabase()`** in `lib/supabase/server.ts`: **service role** key, **no** end-user session — bypasses RLS for server operations.
- **Storage policies** in migration allow **authenticated** insert/update/delete and **anon** read on bucket **`assets`** (so browser previews work with public URLs).

---

## 2. Client initialization

**File:** `lib/supabase/server.ts`

- **`NEXT_PUBLIC_SUPABASE_URL`** — project URL.
- **`SUPABASE_SERVICE_ROLE_KEY`** — server-only; never expose to the browser.

```typescript
createClient(url, serviceRoleKey, { auth: { persistSession: false } });
```

**Video assembly** (`services/video-assembly/server.js`) builds its own client with the same env vars (accepts `SUPABASE_URL` or `NEXT_PUBLIC_SUPABASE_URL`).

---

## 3. Tables defined or altered in repo migrations

### 3.1 `public.templates` — **CONFIRMED** `CREATE TABLE`

| Column | Type | Notes |
|--------|------|--------|
| `name` | `text` **PRIMARY KEY** | Must end with `.hbs` (enforced in app). |
| `source` | `text` **NOT NULL** | Full Handlebars template source. |
| `updated_at` | `timestamptz` **NOT NULL DEFAULT now()** | |

**Migration:** `20250305120000_create_templates_table.sql`

---

### 3.2 `public.tasks` — **partial** (ALTER only)

There is **no** `CREATE TABLE tasks` in this repo. Migrations **add** columns:

| Migration | Columns added |
|-----------|----------------|
| `20250304000000_add_review_columns_to_tasks.sql` | `decision`, `notes`, `rejection_tags`, `validator`, `submit`, `submitted_at` |
| `20250305200000_add_final_override_columns_to_tasks.sql` | `final_title_override`, `final_hook_override`, `final_caption_override`, `final_slides_json_override` |
| `20250306100000_add_template_key_to_tasks.sql` | `template_key` |
| `20260316000000_add_video_assembly_urls_to_tasks.sql` | `merged_video_url`, `final_video_url`, `voiceover_url`, `subtitles_url` |

**Comments in SQL** describe `decision` as `APPROVED | NEEDS_EDIT | REJECTED`. **Note:** the current Review API writes decisions to the **Google Sheet** only; these DB columns may be **legacy**, parallel pipelines, or future use — see **`AGENTS.md`**.

---

### 3.3 `public.assets` — **partial** (ALTER only)

| Migration | Columns added |
|-----------|----------------|
| `20250305150000_assets_table_bucket_columns.sql` | `bucket`, `object_path` |

Assumes a pre-existing **`assets`** table with at least `task_id`, `public_url`, `asset_type`, `position` (as referenced in comments and app code).

---

## 4. Storage

**Migration:** `20250305140000_storage_assets_bucket.sql`

- Ensures bucket **`assets`** exists with **`public: true`**.
- **RLS policies** on `storage.objects`:
  - **authenticated:** insert / update / delete where `bucket_id = 'assets'`
  - **anon:** select where `bucket_id = 'assets'` (public CDN-style URLs)

**URL shape** (used in `review-queue.ts` when `public_url` is null):

`{NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/{bucket}/{object_path}`

**Video assembly** uploads with bucket from **`SUPABASE_ASSETS_BUCKET`** (default **`assets`**).

---

## 5. How the Next.js app queries data

### 5.1 Review queue list / task detail

**File:** `lib/data/review-queue.ts`

1. **Google Sheets** supply allowed **`task_id`** list and row overlay (status, generated\_\*, overrides, etc.).
2. **`tasks`** loaded in chunks of **200** ids:

   - List view: slim select  
     `task_id, project, run_id, platform, flow_type, risk_score, qc_status, status, final_video_url, merged_video_url, created_at, generated_title, generated_hook, generated_caption, recommended_route`  
     If Postgres returns **undefined column** (`42703`), falls back to **`*`**.
   - Other variants: **`*`**.

3. **`assets`** for those tasks:  
   `select task_id, public_url, asset_type, bucket, object_path`  
   ordered by **`position` ascending**, chunked by **400** ids.

4. **Preview URL logic:** prefers **`final_video_url`** / **`merged_video_url`** on task, then best **video-typed** asset by a priority list, then Storage probing for video-like paths (`VIDEO_ASSET_TYPE_PRIORITY`, `pickBestVideoUrlFromStorage`).

5. **`expandTaskIdsForMediaLookup`:** sheet ids may differ from DB ids (suffixes such as `__v1`, `__SCENE_BUNDLE`); expansion is applied for both **`tasks`** and **`assets`** queries.

### 5.2 Stable content view

**`getTaskByTaskIdFromSupabase`:** `select *` from **`tasks`** with expanded ids, pick row (prefers one with **`final_video_url`**), merge assets the same way, set **`video_url`** for UI.

### 5.3 Decisions

**`updateTaskDecision`** persists to the **sheet** only (not Supabase `tasks`), invalidates caches — **CONFIRMED** in `review-queue.ts`.

### 5.4 Templates API

Routes under `app/api/templates` use **`getSupabase()`** against **`templates`** (not fully listed here; see route handlers).

---

## 6. How video-assembly uses Supabase

- **Upload:** binary buffers written to **`assets`** bucket at paths from request (`output_path`, `output_path_final`, etc.).
- **Optional sync:** updates **`tasks`** (e.g. `final_video_url`, `merged_video_url`, …) when **`task_id`** is passed in mux/stitch payloads (see `server.js` implementation).

---

## 7. Legend: confidence levels

| Label | Meaning |
|-------|---------|
| **CONFIRMED** | Stated in a committed migration or clearly in application code. |
| **PARTIAL** | Only ALTERs / selects exist; full table DDL not in repo. |
| **INFERRED** | Reasonable assumption (e.g. foreign key `assets.task_id` → `tasks.task_id`) not shown in migrations here. |

---

## 8. `RUN_IN_DASHBOARD_*.sql` files

Under `supabase/migrations/` some files are named **`RUN_IN_DASHBOARD_*`**. They are **manual** Supabase SQL Editor snippets (duplicate or one-off fixes), not necessarily applied by CLI migration order. Treat them like **optional** recipes unless your pipeline runs them explicitly.

---

## 9. Rebuild checklist

1. Create Supabase project; set **`NEXT_PUBLIC_SUPABASE_URL`** and **`SUPABASE_SERVICE_ROLE_KEY`** on Vercel / local `.env`.
2. Apply migrations (or run equivalent SQL) for **`templates`**, **`storage.buckets`**, **`tasks`** columns, **`assets`** columns.
3. Ensure **`tasks`** and **`assets`** base tables exist with **`task_id`** compatible with sheet + n8n.
4. Confirm **Storage** bucket **`assets`** is **public** if the Review UI loads media without signed URLs.
5. Point **video-assembly** at the same project if you use stitch/mux uploads.

---

*End of Supabase schema and architecture overview.*
