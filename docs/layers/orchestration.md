# Layer: Run orchestration

**Purpose:** Turn a **signal pack** + **enabled flows** into **`content_jobs`** and advance **run** status.

## Main module

- **`src/services/run-orchestrator.ts`** — **`startRun(db, config, runUuid)`**, **`replanRun`** (re-exported / used from runs routes).

## Flow (start)

1. Load **`caf_core.runs`** by UUID; require **`status === CREATED`** (or documented reset paths).
2. Require **`signal_pack_id`** and (current wiring) require planner rows to be present on the run as **`runs.candidates_json`**.
3. **Delete** existing jobs for that **`run_id`** (cleanup).
4. Set run **`PLANNING`**.
5. **`ensureDefaultAllowedFlowsIfNone`**, **`listAllowedFlowTypes`**; drop **offline** flows (**`offline-flow-types.ts`**).
6. Optionally route/expand planner rows for scene assembly (LLM seed expansion).
7. Build in-memory candidate rows × enabled flows from **`runs.candidates_json`** (materialized from the signal pack via `POST /v1/runs/:project_slug/:run_id/candidates`).
8. **`decideGenerationPlan`** — scoring, caps, suppression, learning boosts → **`selected`** jobs.
9. Persist prompt/context snapshots, then loop **`upsertContentJob`** + **`insertJobStateTransition`** for each planned row.
10. Set run **`PLANNED`** / **`GENERATING`** / **`COMPLETED`** / **`FAILED`** as appropriate.

## Inputs

- Run row (**`signal_pack_id`**, **`run_id`**, **`project_id`**).
- Planner rows on the run (**`runs.candidates_json`**) materialized from the signal pack.
- Project slug (for decision engine).

## Outputs

- Rows in **`caf_core.content_jobs`** (**`PLANNED`**) with **`generation_payload`** containing **`signal_pack_id`**, **`candidate_data`**, **`prompt_*`** fields from the plan.

## State owned

- **`caf_core.runs`** status fields and counters.
- **`caf_core.decision_traces`** (when not dry run).

## Boundaries

- **Depends on:** decision engine, jobs repository, signal pack repository, project config.
- **Does not:** run LLM generation itself — that is **[job-pipeline.md](./job-pipeline.md)**.

## See also

- [decision-engine.md](./decision-engine.md)
- [../LIFECYCLE.md](../LIFECYCLE.md)
