# Everything you need to provide (save this checklist)

Use this as your **single vault checklist**. Copy values only into `.env`, password managers, or deployment secret stores (Vercel / Fly) — never into git.

For variable names and comments, see also [`.env.example`](../.env.example) and [`ENV_AND_SECRETS_INVENTORY.md`](../ENV_AND_SECRETS_INVENTORY.md).

---

## 1. CAF Core API (this service)

| Item | Required? | Where it goes | Notes |
|------|------------|---------------|--------|
| **Postgres `DATABASE_URL`** | **Yes** | `.env` / Fly secret | Supabase pooler URI, Neon, RDS, or local Docker (see `docker-compose.yml`). |
| **`CAF_CORE_API_TOKEN`** | Recommended prod | `.env` / Fly secret | Long random string; pair with **`CAF_CORE_REQUIRE_AUTH=1`**. |
| **`PORT` / `HOST`** | Optional | `.env` | Defaults `3847` / `0.0.0.0`. |
| **`OPENAI_API_KEY`** / **`OPENAI_MODEL`** | Yes for generation | `.env` / Fly secret | Required for LLM generation, scene clips (Sora), TTS. |
| **`HEYGEN_API_KEY`** / **`HEYGEN_API_BASE`** | Yes for HeyGen video | `.env` / Fly secret | Only if using HeyGen avatar / video-agent flows. |
| **`SUPABASE_URL`** / **`SUPABASE_SERVICE_ROLE_KEY`** / **`SUPABASE_ASSETS_BUCKET`** | Yes for asset uploads | `.env` / Fly secret | Where render outputs (carousel PNGs, video MP4s, scene clips) are stored. |
| **`RENDERER_BASE_URL`** / **`VIDEO_ASSEMBLY_BASE_URL`** | Yes for rendering | `.env` / Fly secret | Point at `services/renderer`, `services/video-assembly`, or the combined `media-gateway`. |
| **`CAROUSEL_TEMPLATES_DIR`** | Optional | `.env` | Directory served via `GET /api/templates/*` for the renderer. |
| **`CAF_PUBLISH_EXECUTOR`** | Optional | `.env` | `none` (default) / `dry_run` / `meta`. For `meta`, add page tokens + **`META_GRAPH_API_VERSION`** (or per-project rows in `project_integrations`). |
| **`CAF_OUTPUT_SCHEMA_VALIDATION_MODE`** | Optional | `.env` | `skip` / `warn` / `enforce`; legacy **`CAF_SKIP_OUTPUT_SCHEMA_VALIDATION`** is still honored as a fallback. |
| Scoring & caps (`SCORE_WEIGHT_*`, `DEFAULT_MIN_SCORE_TO_GENERATE`, …) | Optional | `.env` | Tuning only. See `src/config.ts`. |

**Migrations:**

- Applied via **`npm run migrate`**, or automatically on API startup when **`CAF_RUN_MIGRATIONS_ON_START`** is true (default).
- Tracked in **`caf_core.schema_migrations`**.
- If you already applied migrations before the ledger existed, baseline it once:

```sql
INSERT INTO caf_core.schema_migrations (filename) VALUES ('001_caf_core_schema.sql')
ON CONFLICT DO NOTHING;
```

---

## 2. Review app (`apps/review` — Next.js 14)

The Review workbench is a **pure client of CAF Core**. It does not own its own database, queue, or third-party credentials — everything it shows comes from Core `/v1/*` routes.

| Item | Required? | Notes |
|------|------------|--------|
| **`CAF_CORE_URL`** | **Yes** | Public URL of your Core deployment (e.g. `https://caf-core.fly.dev`); `http://localhost:3847` for local dev. |
| **`CAF_CORE_TOKEN`** | Yes when Core has `CAF_CORE_REQUIRE_AUTH=1` | Must match **`CAF_CORE_API_TOKEN`** on Core. Sent as `x-caf-core-token` / `Authorization: Bearer`. |
| **`REVIEW_WRITE_TOKEN`** | Recommended prod | Gate decision writes from the UI; leave empty for local dev. |
| **`NEXT_PUBLIC_APP_URL`** | Recommended | Used for preview/link building. |
| **`PROJECT_SLUG`** | Optional | Empty = load all active projects' queues. Set (e.g. `SNS`, `connecrts`) to lock the workbench to one tenant. |
| **`REVIEW_ALL_PROJECTS`** | Optional | `1` / `true` forces cross-project queue even when `PROJECT_SLUG` is set. |
| **`REVIEW_FALLBACK_PROJECT_SLUG`** | Optional | Used only when Core lacks `/v1/review-queue-all/*` (older deploy). Default fallback is `SNS`. |

All Core-dependent configuration (HeyGen, Supabase, Meta publishing, Google/OAuth credentials) stays on **Core** and `project_integrations` — not on the Review app.

---

## 3. Media services on Fly.io

| Item | Notes |
|------|--------|
| Fly app names | e.g. `caf-core`, `media-gateway` (renderer + video-assembly). |
| **`FLY_API_TOKEN`** | GitHub Actions secret for the deploy workflow. |
| **`SUPABASE_URL`** + **`SUPABASE_SERVICE_ROLE_KEY`** on Fly | Same Supabase project as Core uploads. |
| **`OPENAI_API_KEY`** on Fly (if needed) | Only when the video-assembly uses Whisper / mux alignment. |
| **`CAF_TEMPLATE_API_URL`** | Core base URL, so the renderer can fetch `.hbs` templates via `GET /api/templates/*`. |
| Renderer / mux tuning | Timeouts, burn style, retries — listed in `.env.example`. |

See also [`FLY_PRODUCTION_CHECKLIST.md`](./FLY_PRODUCTION_CHECKLIST.md).

---

## 4. Third-party provider accounts (vault)

| Provider | Typical secret | Used by |
|----------|----------------|---------|
| **OpenAI** | API key (+ org / project id if scoped) | LLM generation, Sora scene clips, TTS, approval-review vision |
| **HeyGen** | API key / account | Avatar and video-agent renders |
| **Supabase** | Service-role key | Asset storage bucket |
| **Meta Graph** | Page tokens (per `project_integrations`) | Publishing when `CAF_PUBLISH_EXECUTOR=meta` |

Per-project overrides (e.g. separate Meta tokens per brand) live in **`caf_core.project_integrations`**, not in env.

---

## 5. External publish workers (optional)

If you run a downstream worker to actually post content, it consumes Core's stable publish payload:

- **Endpoint:** `GET /v1/publications/:project_slug/:id/n8n-payload` (route name is historical — the shape is the Core-owned contract for any external publisher).
- **Auth:** `x-caf-core-token` / `Authorization: Bearer` when `CAF_CORE_REQUIRE_AUTH=1`.
- **Outcomes:** workers call back into `POST /v1/publications/.../complete` (or patch the placement) to record `published` / `failed` state.

Nothing in Core requires a specific external orchestrator; the publish executor is selectable via **`CAF_PUBLISH_EXECUTOR`** (`none` / `dry_run` / `meta`).

---

## 6. End-state "done when" checklist

- [ ] `DATABASE_URL` set; `npm run migrate` succeeds; `npm run dev` responds on `/health`.
- [ ] If auth on: `CAF_CORE_REQUIRE_AUTH=1` + `CAF_CORE_API_TOKEN`; every client (Review app, scripts, workers) sends the matching token.
- [ ] Review app deployed with `CAF_CORE_URL` (public) + optional `CAF_CORE_TOKEN`; review queue loads.
- [ ] Fly apps deployed; Core's `RENDERER_BASE_URL` / `VIDEO_ASSEMBLY_BASE_URL` point at the deployed media services.
- [ ] `OPENAI_API_KEY`, `HEYGEN_API_KEY`, and `SUPABASE_*` set wherever they are needed (Core, and on Fly for the media stack that uploads assets).
- [ ] `CAF_PUBLISH_EXECUTOR` set explicitly for production (`meta` with project-integration tokens, or `none` / `dry_run` while testing).
- [ ] No secrets committed; `.env` is git-ignored.

---

*This file is safe to commit. It contains no secret values.*
