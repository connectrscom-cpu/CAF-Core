# CAF Core — Tech stack

What runs **in this repo**, what runs **beside** it, and how configuration ties them together. All env validation lives in **`src/config.ts`** (Zod).

## Core API (this repository)

| Concern | Choice |
|---------|--------|
| Runtime | **Node.js** ≥ 20 (`package.json` `engines`) |
| Language | **TypeScript** (ESM, `import` with `.js` in compiled output) |
| HTTP server | **Fastify 5** (`src/server.ts`) |
| Validation | **Zod** (routes, config) |
| Database driver | **`pg`** (connection pool `src/db/pool.ts`) |
| DB schema | **PostgreSQL**, schema **`caf_core`**, versioned **`migrations/*.sql`** |
| Testing | **Vitest** (`npm test`) |

## Data & persistence

- **Canonical store:** Postgres tables under **`caf_core.*`** (projects, runs, signal packs, content jobs, job drafts, assets, reviews, learning, publications, flow-engine metadata, etc.).
- **Migrations:** Applied via **`npm run migrate`** or optionally on API startup (**`CAF_RUN_MIGRATIONS_ON_START`**, default true).

## LLM & AI

| Use | Integration |
|-----|-------------|
| Text / JSON generation | **OpenAI** Chat Completions (`src/services/openai-chat.ts`, **`OPENAI_API_KEY`**, **`OPENAI_MODEL`**) |
| Structured output | Prompt templates + **`output_schemas`** validation; tri-state rollout via **`CAF_OUTPUT_SCHEMA_VALIDATION_MODE`** (`skip` / `warn` / `enforce`) with legacy **`CAF_SKIP_OUTPUT_SCHEMA_VALIDATION`** as fallback |
| Video clips (scene path) | **OpenAI Videos API** / Sora when **`SCENE_ASSEMBLY_CLIP_PROVIDER=sora`** (`src/config.ts`) |
| Vision / approval review | Configurable model **`OPENAI_APPROVAL_REVIEW_MODEL`** |

## Media & rendering (out-of-process services)

| Service | Role | Default base URL (config) |
|---------|------|---------------------------|
| **Carousel renderer** | Puppeteer + Handlebars → slide PNGs | **`RENDERER_BASE_URL`** (e.g. `http://localhost:3333`) |
| **Video assembly** | ffmpeg concat, mux, subtitle burn | **`VIDEO_ASSEMBLY_BASE_URL`** (e.g. `http://localhost:3334`) |
| **Templates for renderer** | Core serves **`GET /api/templates/*`** from **`CAROUSEL_TEMPLATES_DIR`** | Same host as Core or separate |

Core **calls** these over HTTP; it does not embed Puppeteer/ffmpeg for carousel/video assembly in the main API process.

## Third-party APIs (optional)

| Provider | Purpose | Env |
|----------|---------|-----|
| **HeyGen** | Avatar / video agent renders | **`HEYGEN_API_KEY`**, **`HEYGEN_API_BASE`** |
| **Supabase** | Object storage for assets | **`SUPABASE_URL`**, **`SUPABASE_SERVICE_ROLE_KEY`**, **`SUPABASE_ASSETS_BUCKET`** |
| **Meta Graph** | Publishing when **`CAF_PUBLISH_EXECUTOR=meta`** | Page tokens + **`META_GRAPH_API_VERSION`** |

## Review & operator UI

| App | Stack | Talks to Core via |
|-----|-------|-------------------|
| **Review workbench** | **Next.js 14**, React 18, Tailwind (`apps/review/package.json`) | **`CAF_CORE_URL`**, optional **`CAF_CORE_TOKEN`** |

## Deployment hints (from repo)

- **Fly.io:** **`fly.toml`**, **`Dockerfile`** at root for Core; **`services/media-gateway/`** has its own Fly config.
- **Review:** **`apps/review/vercel.json`** — Vercel-oriented.

## Why this stack fits

- **Postgres** gives durable, queryable pipeline state and joins for review queues.
- **Fastify** keeps the API process small; heavy CPU stays in **renderer** / **video-assembly** workers.
- **OpenAI + HeyGen + Sora** are **replaceable HTTP boundaries** — costs and quotas are operational, not schema-level.

## Observability

- **Structured pipeline log helper:** **`src/services/pipeline-logger.ts`** (`logPipelineEvent(level, stage, message, ctx)`) emits a single JSON line per event to stderr with correlation fields (`project_id`, `run_id`, `task_id`, `job_id`, `flow_type`). Zero deps; opt-in alongside existing `console.*` calls. Intended target for container log collectors.

## Typed `content_jobs` payload slices

- **`src/domain/`** carves typed subsets out of the `generation_payload` / `render_state` JSONB columns so new code does not re-cast raw JSON: **`generation-payload-qc.ts`** (Zod + canonical writer), **`generation-payload-output.ts`** (`generated_output` readers), **`content-job-render-state.ts`** (HeyGen idempotency invariant `hasActiveProviderSession`).

## Coherence vs complexity

- **Coherent:** One API process, one DB schema, HTTP workers for media.
- **Complex:** Large **`config.ts`** surface, multiple video providers (HeyGen vs Sora vs ffmpeg), env-driven behavior — see **`ENV_AND_SECRETS_INVENTORY.md`**.

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [layers/http-api.md](./layers/http-api.md)
- [layers/rendering.md](./layers/rendering.md)
- `README.md` — quick start
