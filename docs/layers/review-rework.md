# Layer: Review & rework

**Purpose:** Record **human decisions** on jobs, update **status**, and drive **rework** (partial/full regeneration, caption-only video paths, HeyGen overrides).

## Review (API)

- **`src/routes/v1.ts`** — review queue, job detail, **`executeEditorialReviewDecision`** pattern: inserts **`caf_core.editorial_reviews`**, updates **`content_jobs.status`** to **`APPROVED`**, **`REJECTED`**, or **`NEEDS_EDIT`**, **`insertJobStateTransition`**.
- Body may include **overrides**: title, hook, caption, hashtags, slides JSON, **spoken script**, HeyGen ids, **`skip_video_regeneration`**, **`skip_image_regeneration`**, **`rewrite_copy`**, etc.

## Rework execution

- **`src/services/rework-orchestrator.ts`** — **`executeRework`**, prepares payload for another pipeline pass (linked from **`pipeline.ts`** routes).
- When reading the prior draft off **`generation_payload.generated_output`**, prefer **`pickGeneratedOutput` / `pickGeneratedOutputOrEmpty`** from **`src/domain/generation-payload-output.ts`** so rework code does not silently treat missing output as an empty object.

## Review app

- **`apps/review`** — Next.js; **proxies** Core (**`caf-core-client.ts`**). **Source of truth remains Postgres via Core**, not the Review DB.

## Inputs

- **`project_slug`**, **`task_id`**, decision + optional overrides.

## Outputs

- **`editorial_reviews`** row; **`content_jobs`** status and merged **`generation_payload`** / **`overrides_json`** as applicable.

## State owned

- **Editorial** history on **`editorial_reviews`**; job **current** status on **`content_jobs`**.

## See also

- [../LIFECYCLE.md](../LIFECYCLE.md)
- [../GENERATION_GUIDANCE.md](../GENERATION_GUIDANCE.md) (rework prompt injection)
- [publishing.md](./publishing.md)
