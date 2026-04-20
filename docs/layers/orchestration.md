# Layer: Run orchestration

**Purpose:** Turn a **signal pack** + **enabled flows** into **`content_jobs`** and advance **run** status.

## Main module

- **`src/services/run-orchestrator.ts`** — **`startRun(db, config, runUuid)`**, **`replanRun`** (re-exported / used from runs routes).

## Flow (start)

1. Load **`caf_core.runs`** by UUID; require **`status === CREATED`** (or documented reset paths).
2. **Delete** existing jobs for that **`run_id`** (cleanup).
3. Set run **`PLANNING`**.
4. Require **`signal_pack_id`** → load **`caf_core.signal_packs`**.
5. **`ensureDefaultAllowedFlowsIfNone`**, **`listAllowedFlowTypes`**; drop **offline** flows (**`offline-flow-types.ts`**).
6. Optionally **`expandOverallCandidatesWithSceneAssemblyRouter`** (LLM seed expansion).
7. **`buildCandidatesFromSignalPack`** — in-memory candidate rows × flows.
8. **`decideGenerationPlan`** — scoring, caps, suppression, learning boosts → **`selected`** jobs.
9. **`setRunPromptVersionsSnapshot`**, then loop **`upsertContentJob`** + **`insertJobStateTransition`** for each planned row.
10. Set run **`PLANNED`** / **`GENERATING`** / **`COMPLETED`** / **`FAILED`** as appropriate.

## Inputs

- Run row (**`signal_pack_id`**, **`run_id`**, **`project_id`**).
- Signal pack JSON (**`overall_candidates_json`**).
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
