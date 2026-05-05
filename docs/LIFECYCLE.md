# CAF Core — Lifecycles

State machines for **runs**, **content jobs**, and how they connect to **review** and **publishing**. Status strings are **text** in Postgres; clients must not invent new values without migration and pipeline updates.

## Run lifecycle

Runs live in **`caf_core.runs`**. The orchestrator in **`src/services/run-orchestrator.ts`** drives planning when you call **`POST /v1/runs/:project_slug/:run_id/start`**.

| Phase | Typical `runs.status` | What happens |
|-------|------------------------|--------------|
| Created | `CREATED` | Run row exists; **`signal_pack_id`** should be set before start (via create or **`PATCH`**). |
| Planning | `PLANNING` | Signal pack loaded; candidates built; **`decideGenerationPlan`** runs; **`content_jobs`** inserted **`PLANNED`**. |
| Planned / generating | `PLANNED` then `GENERATING` | **`startRun`** sets **`PLANNED`** (total_jobs) then **`GENERATING`** after jobs exist. |
| Execution | `GENERATING` → `RENDERING` → `REVIEWING` | Updated by **`job-pipeline`** / run processing as jobs advance (see run repository). |
| Terminal | `COMPLETED`, `FAILED`, `CANCELLED` | Failure on planning errors; **`COMPLETED`** when work finishes with zero or more jobs. |

Allowed values are constrained in SQL (see **`migrations/002_project_config_and_runs.sql`**):  
`CREATED`, `PLANNING`, `PLANNED`, `GENERATING`, `RENDERING`, `REVIEWING`, `COMPLETED`, `FAILED`, `CANCELLED`.

**Important:** **`startRun`** requires **`signal_pack_id`** on the run. **`CREATED`** runs with no pack will fail start.

**Important (current wiring):** **`startRun`** also expects planner rows to already exist on the run as **`runs.candidates_json`**.
- Create/materialize them via **`POST /v1/runs/:project_slug/:run_id/candidates`** while the run is still `CREATED`.
- `start` will error if `candidates_json` is missing/unusable.

## Content job lifecycle

Jobs are **`caf_core.content_jobs`**, unique on **`(project_id, task_id)`**.

Typical pipeline path (**`src/services/job-pipeline.ts`**):

```
PLANNED → GENERATING → GENERATED → (QC) → RENDERING → IN_REVIEW → APPROVED | REJECTED | NEEDS_EDIT
```

Notes:

- **`GENERATING`** — job picked up; LLM may run.
- **`GENERATED`** — LLM output present in **`generation_payload`**.
- After **`runQcForJob`**, status may become **`BLOCKED`**, **`QC_FAILED`**, **`REJECTED`**, **`NEEDS_EDIT`**, or advance toward render/review depending on **`recommended_route`** and flow type.
- **`IN_REVIEW`** — waiting for human decision (default path after QC + render when using **`CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC`**).
- **`APPROVED` / `REJECTED` / `NEEDS_EDIT`** — set from review APIs (**`src/routes/v1.ts`**). **`NEEDS_EDIT`** often triggers **rework** (**`rework-orchestrator.ts`**).

QC can short-circuit: **`routeJobAfterQc`** maps **`DISCARD`** → **`REJECTED`**, **`REWORK_REQUIRED`** → **`NEEDS_EDIT`**.

Video jobs may stay **`RENDERING`** for a long time while HeyGen/Sora poll; **`RenderNotReadyError`** keeps status **`RENDERING`** for retry.

## Editorial decision (human)

Stored in **`caf_core.editorial_reviews`**; **`decision`** is one of:

- `APPROVED`
- `NEEDS_EDIT`
- `REJECTED`

Applied via review endpoints that update **`content_jobs.status`** to match.

## Publication placement lifecycle

**`caf_core.publication_placements`**: **`status`** values include **`draft`**, **`scheduled`**, **`publishing`**, **`published`**, **`failed`**, **`cancelled`** (see **`src/routes/publications.ts`**). Linked to jobs by **`(project_id, task_id)`**, not a FK to **`content_jobs`**.

## Learning rules (lifecycle)

**`caf_core.learning_rules`**: **`status`** includes **`pending`**, **`active`**, **`superseded`**, **`rejected`**, **`expired`**. Activation **`applyLearningRule`** sets **`active`** and **`applied_at`**. Only **active** rules with valid **`valid_from` / `valid_to` / `expires_at`** participate in planning or generation (see **`GENERATION_GUIDANCE.md`** and **`src/repositories/core.ts`**).

## Where to trace in code

| Concern | File |
|---------|------|
| Start run, create jobs | `src/services/run-orchestrator.ts` |
| Process jobs | `src/services/job-pipeline.ts` |
| QC routing after pass/fail | `src/services/validation-router.ts`, `qc-runtime.ts` |
| Human review | `src/routes/v1.ts` |
| State transition log | **`caf_core.job_state_transitions`** via **`src/repositories/transitions.ts`** |

## Related docs

- [ARCHITECTURE.md](./ARCHITECTURE.md) — abbreviated lifecycle
- [layers/job-pipeline.md](./layers/job-pipeline.md) — execution layer
- [.cursor/rules/caf-domain-model.mdc](../.cursor/rules/caf-domain-model.mdc) — ID conventions
