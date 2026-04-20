# Layer: HTTP API

**Purpose:** Expose CAF Core over **HTTP**, register routes, optional **auth**, and **CORS** for browser clients.

## Entry point

- **`src/server.ts`** — builds Fastify, loads **`loadConfig()`**, **`createPool`**, optional **`runPendingMigrations`**, registers all route modules, **`listen`** on **`PORT`** / **`HOST`**.

## Route modules (representative)

| Prefix / concern | Registration |
|------------------|--------------|
| **`/v1/*` integration** | `registerV1Routes` — `src/routes/v1.ts` |
| **Runs** | `src/routes/runs.ts` |
| **Signal packs** | `src/routes/signal-packs.ts` |
| **Pipeline** (generate, qc, full, rework) | `src/routes/pipeline.ts` |
| **Project config** | `src/routes/project-config.ts` |
| **Flow engine metadata** | `src/routes/flow-engine.ts` |
| **Learning** | `src/routes/learning.ts` |
| **Publications** | `src/routes/publications.ts` |
| **Admin** | `src/routes/admin.ts` |
| **Renderer templates** (public GETs for workers) | `src/routes/renderer-templates.ts` |
| **Integrations** | `src/routes/project-integrations.ts` |

## Auth

When **`CAF_CORE_REQUIRE_AUTH`** and **`CAF_CORE_API_TOKEN`** are set, a **`preHandler`** requires **`x-caf-core-token`** or **`Authorization: Bearer`** except for **`/health`**, **`/robots.txt`**, and public template paths (**`isRendererTemplatesPublicPath`**).

## Inputs / outputs

- **Inputs:** JSON bodies (Zod-validated per route), multipart for signal pack upload.
- **Outputs:** JSON; errors as HTTP status + `{ ok: false, error }` patterns where implemented.

## State owned

None durable in the API process — all truth is **Postgres**.

## Boundaries

- **Clean:** HTTP is thin; heavy logic lives in **`src/services/`** and **`src/repositories/`**.
- **Leaky:** **`v1.ts`** and **`admin.ts`** are very large — prefer adding handlers in services and keeping routes small.

## See also

- [orchestration.md](./orchestration.md)
- [../TECH_STACK.md](../TECH_STACK.md)
