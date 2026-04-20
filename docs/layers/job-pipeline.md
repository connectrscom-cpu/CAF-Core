# Layer: Job pipeline (execution)

**Purpose:** Move a single **`content_job`** through **generation → QC → diagnostic → render → review-ready status**, and run **batch** processing for a whole run.

## Main module

- **`src/services/job-pipeline.ts`** — **`processContentJobById`**, **`processRunJobs`**, **`reprocessJobFromScratch`**, carousel/video branching, **HeyGen/Sora** retry semantics.

## Stages (conceptual)

1. **Offline flows** — early exit for types in **`offline-flow-types.ts`**.
2. **PLANNED → GENERATING** — **`advanceToGenerating`**.
3. **LLM** — **`generateForJob`** if no **`generated_output`** yet.
4. **QC** — **`runQcForJob`** persists results through **`mergeGenerationPayloadQc`** (`src/domain/generation-payload-qc.ts`, typed by `qcResultSchema`) — see **[../QUALITY_CHECKS.md](../QUALITY_CHECKS.md)**.
5. **Post-QC routing** — **`routeJobAfterQc`** (**`validation-router.ts`**) for DISCARD / REWORK.
6. **Diagnostic** — **`runDiagnosticAudit`**.
7. **Render** — carousel slides via **`RENDERER_BASE_URL`**; video via HeyGen / scene pipeline / video-assembly (flow-dependent).
8. **Terminal pre-review** — **`IN_REVIEW`**, **`finalJobStatusAfterRender`**.

## Inputs

- **`job.id`** (UUID) or **`task_id`** + project; **`AppConfig`** for URLs and flags.

## Outputs

- Updates **`content_jobs`** (status, **`generation_payload`**, **`render_state`**, **`scene_bundle_state`**, **`asset_id`**).
- **`caf_core.assets`** inserts.
- **`job_state_transitions`** rows.

## State owned

- Job row is SSOT; pipeline **merges** JSON into **`generation_payload`**. The `qc_result` slice has a canonical writer (`mergeGenerationPayloadQc`); other subsystems update their slices directly via SQL — coordinate changes.

## Failure modes

- **`RenderNotReadyError`** — poll timeouts; job may stay **`RENDERING`**.
- **`markJobFailedPipeline`** — **`FAILED`** with transition log.

## Provider idempotency (HeyGen / Sora)

The canonical "don't double-submit" check is **`hasActiveProviderSession(renderState)`** in `src/domain/content-job-render-state.ts`. The pipeline uses it in `isVideoRenderingSafelyRetryable`. New render branches must call this helper before any provider submit.

## Observability

For new pipeline-stage logs, prefer **`logPipelineEvent(level, stage, message, { run_id, task_id, job_id, flow_type, data })`** (`src/services/pipeline-logger.ts`) over `console.*`. It emits a single JSON line per event with correlation fields, so one job is easy to trace across generate → QC → render → review in container log collectors.

## Boundaries

- **Depends on:** **`llm-generator`**, **`qc-runtime`**, **`diagnostic-runner`**, **`validation-router`**, render helpers, **Supabase** upload.
- **See:** [generation.md](./generation.md), [rendering.md](./rendering.md), [../LIFECYCLE.md](../LIFECYCLE.md).
