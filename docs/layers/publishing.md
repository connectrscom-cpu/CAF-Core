# Layer: Publishing

**Purpose:** Track **intent to post** (schedule, captions, media URLs) and **outcomes** (platform post id, URL, errors). Core can **claim** work for an external executor or **call Meta** directly when configured.

## Main modules

- **`src/routes/publications.ts`** — CRUD-style routes, **`start`**, **`complete`**, and a stable publish-payload endpoint (historically named `n8n-payload`; now a generic external-worker contract).
- **`src/repositories/publications.ts`** — SQL for **`caf_core.publication_placements`**.
- **`src/services/publication-n8n-payload.ts`** — Builds the stable JSON payload returned by `GET /v1/publications/:project_slug/:id/n8n-payload`. Filename is historical; the shape is the Core-owned publish contract for any external worker.
- **`src/services/meta-graph-publish.ts`** — **`CAF_PUBLISH_EXECUTOR=meta`**.
- **`src/services/publish-executors/dry-run.ts`** — test plumbing.

## Data model

**`caf_core.publication_placements`** — **`task_id`** + **`project_id`**, **`platform`**, **`content_format`** (`carousel` | `video` | `unknown`), **`status`**, **`scheduled_at`**, snapshots, **`result_json`**.

## Config

- **`CAF_PUBLISH_EXECUTOR`**: **`none`** | **`dry_run`** | **`meta`** (**`src/config.ts`**).
- Meta tokens may be overridden per channel via env (**`CAF_META_*`**) or **`project_integrations`**.

## Inputs

- Approved job context (client copies **`media_urls`** / **`video_url`** from **`generation_payload`** / assets).

## Outputs

- Placement rows; optional **`posted_url`** / **`platform_post_id`**.

## Boundaries

- **Does not** replace organic platform analytics — performance feedback may use separate **[learning.md](./learning.md)** / metrics ingestion.

## See also

- [../LIFECYCLE.md](../LIFECYCLE.md)
- `README.md` (publications route table)
