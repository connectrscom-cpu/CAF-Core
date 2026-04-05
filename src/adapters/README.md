# Adapters

Sync legacy state (Google Sheets, Supabase `public.tasks`) into the CAF Core Postgres schema.

## Sheets Adapter (`sheets/`)

Reads Google Sheets tabs and upserts into `caf_core.content_jobs` and `caf_core.editorial_reviews`.

```bash
npm run sync:sheets             # syncs both Runtime + Review Queue tabs
npm run sync:sheets runtime     # Runtime tab only
npm run sync:sheets review      # Review Queue tab only
```

Required env vars: `DATABASE_URL`, `GOOGLE_REVIEW_QUEUE_SPREADSHEET_ID`, and one of:
- `GOOGLE_SERVICE_ACCOUNT_JSON` (service account)
- `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN` (OAuth)

Optional: `PROJECT_SLUG` (default `SNS`), `GOOGLE_RUNTIME_SHEET_NAME` (default `Runtime`), `GOOGLE_REVIEW_QUEUE_SHEET_NAME` (default `Review Queue`).

## Supabase Adapter (`supabase/`)

Mirrors `public.tasks` → `caf_core.content_jobs` and `public.assets` → `caf_core.assets`.

```bash
npm run sync:supabase           # syncs both tasks + assets
npm run sync:supabase tasks     # tasks only
npm run sync:supabase assets    # assets only
```

Required env vars: `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

Optional: `PROJECT_SLUG` (default `SNS`), `SYNC_SINCE_HOURS` (default `72`).

## ID contracts

Both adapters preserve `task_id`, `run_id`, `candidate_id` as stable keys — see [08_current_ids_and_state_conventions.md](../../08_current_ids_and_state_conventions.md).
