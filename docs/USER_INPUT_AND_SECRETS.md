# Everything you need to provide (save this checklist)

Use this as your **single vault checklist**. Copy values only into `.env`, password managers, Vercel/Fly/n8n—never into git.

For variable names and comments, see also [`.env.example`](../.env.example) and [`ENV_AND_SECRETS_INVENTORY.md`](../ENV_AND_SECRETS_INVENTORY.md).

---

## 1. CAF Core API (this service)

| Item | Required? | Where it goes | Notes |
|------|------------|---------------|--------|
| **Postgres `DATABASE_URL`** | **Yes** | `.env` | Supabase pooler URI, Neon, RDS, or local Docker (see `docker-compose.yml`). |
| **`CAF_CORE_API_TOKEN`** | Recommended prod | `.env` / Fly secret | Random long string; pair with `CAF_CORE_REQUIRE_AUTH=1`. |
| **`PORT` / `HOST`** | Optional | `.env` | Defaults `3847` / `0.0.0.0`. |
| Scoring weights (`SCORE_WEIGHT_*`, `DEFAULT_MIN_SCORE_TO_GENERATE`, etc.) | Optional | `.env` | Tuning only. |

**If you already applied migrations before the ledger existed:** baseline the ledger once:

```sql
INSERT INTO caf_core.schema_migrations (filename) VALUES ('001_caf_core_schema.sql')
ON CONFLICT DO NOTHING;
```

---

## 2. Legacy Review app (Next.js on Vercel)

| Item | Required? | Notes |
|------|------------|--------|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Public URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only; never expose to browser. |
| `REVIEW_WRITE_TOKEN` | Yes for POST decisions | Sent as `x-review-token`. |
| `NEXT_PUBLIC_REVIEW_WRITE_TOKEN` | Optional | Avoid in prod if possible. |
| `GOOGLE_REVIEW_QUEUE_SPREADSHEET_ID` | Yes for queue | Can be comma-separated list. |
| `GOOGLE_REVIEW_QUEUE_SHEET_NAME` | Optional | Default `Review Queue`. |
| `GOOGLE_SERVICE_ACCOUNT_JSON` **or** OAuth trio | One path required | SA JSON string **or** `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` + `GOOGLE_REFRESH_TOKEN`. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Local only | Path to SA key file. |
| `NEXT_PUBLIC_APP_URL` | Recommended | Used for `preview_url` / links. |
| `DECISION_WEBHOOK_URL` | Optional | Called after sheet decision. |
| `RENDERER_BASE_URL`, `VIDEO_ASSEMBLY_BASE_URL` | As needed | For UI proxies / tools. |

---

## 3. Google Sheets (operational inventory — document in vault)

Not env vars on Core, but you must know **which spreadsheet is which**:

| Workbook | You record |
|----------|-----------|
| VALIDATION (Review Queue tab) | Spreadsheet ID |
| CREATION – Runtime (Signal_Packs, Content_Jobs, …) | ID |
| PROCESSING – Insights (Overall + platform tabs) | ID |
| Flow Engine (global) | ID |
| Per-project CREATION config | IDs per brand |

Align those IDs with n8n Google Sheets credentials and with `GOOGLE_REVIEW_QUEUE_*` for the review app.

---

## 4. Fly.io (renderer / video-assembly / gateway)

| Item | Notes |
|------|--------|
| Fly app name(s) | e.g. media-gateway machine. |
| `FLY_API_TOKEN` | GitHub secret for deploy workflow. |
| `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` on Fly | Same project as uploads. |
| `OPENAI_API_KEY` on Fly | Only if using Whisper / mux alignment. |
| `CAF_TEMPLATE_API_URL` | Next app base URL if renderer pulls `.hbs` from API. |

Mux/renderer tuning vars are listed in `.env.example` (timeouts, burn style, etc.)—set as needed.

---

## 5. n8n

| Item | Notes |
|------|--------|
| n8n base URL | For ops / webhook docs. |
| Credentials (in n8n UI) | Google Sheets OAuth, OpenAI, Supabase, HeyGen, HTTP Bearer to Fly URLs, Apify, etc. |
| **New:** CAF Core URL + token | For `POST /v1/decisions/plan` and optional `POST /v1/jobs/ingest`—store as Header Auth or env expression. |

---

## 6. Third-party APIs (vault)

| Provider | Typical secret |
|----------|----------------|
| OpenAI | API key (+ org/project if scoped). |
| HeyGen | API key / account. |
| Apify | Token + actor IDs you use. |

---

## 7. Optional future adapters (nothing required today)

When you build sheet→Core sync, you will need:

- Read access to the same spreadsheet IDs as §3.
- A service account or OAuth identity **shared** on those sheets (Editor where writes are needed).
- Mapping decisions: which tabs map to `content_jobs`, `editorial_reviews`, etc.

---

## 8. End-state “done when” checklist

- [ ] `DATABASE_URL` set; `npm run migrate` succeeds; `npm run dev` responds on `/health`.
- [ ] If auth on: `CAF_CORE_REQUIRE_AUTH=1` + token; n8n sends header on Core calls.
- [ ] Review app envs set on Vercel; queue loads.
- [ ] Fly apps deployed; n8n `RENDERER_BASE_URL` / `VIDEO_ASSEMBLY_BASE_URL` point to them.
- [ ] All Google sheet IDs documented in vault and match n8n.
- [ ] No secrets committed; `.env` gitignored.

---

*This file is safe to commit. It contains no secret values.*
