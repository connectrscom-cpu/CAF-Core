# CAF Core — Domain model

**Purpose:** External-facing copy of the CAF domain rules (IDs, entities, lifecycles, joins). Cursor agents also use `.cursor/rules/caf-domain-model.mdc`; **this file is for humans, ChatGPT, and other repositories**.

**Pipeline funnel:**

**Signal Pack → Candidates → Decision Engine → Content Jobs → Drafts → Rendering → Review → Publishing → Learning**

---

## Entity hierarchy

| Entity | Description |
|--------|-------------|
| **Project** | Named content brand (e.g. SNS). Container for strategy, flows, prompts, learning rules. Stored in `caf_core.projects`; URLs use `slug`. |
| **Run** | One execution cycle for a project, tied to a signal pack. Groups all work from a single evidence window. |
| **Signal pack** | Research bundle attached to a run. Curated planner rows live in `jobs_json` (dual-written with legacy `ideas_json`). Legacy intake also used `overall_candidates_json`. |
| **Candidate** | One idea × one flow type. Built **in memory** from signal pack rows × enabled flows. Scored by the decision engine. **Not** persisted as first-class DB rows in current app code (historical `caf_core.candidates` table exists but is not the planning source of truth). |
| **Content job** | Atomic executable unit. Created from planned candidates. **Central entity** — rendering, review, publishing, and learning key off `task_id`. |
| **Job draft** | One LLM generation attempt for a job (`attempt_no`, `revision_round`). |
| **Asset** | Produced media (carousel image, video, audio, subtitles) linked to a job. |
| **Editorial review** | Human approval / rejection / edit decision on a job. |
| **Diagnostic audit** | Machine-generated quality evaluation. |
| **Performance metric** | Post-publication outcome data. |
| **Learning rule** | Structured insight that changes future behavior (prompt selection, routing, scoring). |
| **Experiment** | Controlled intervention to measure impact of changes. |
| **Publication placement** | Scheduled or completed publish intent per platform. |

### Inputs pipeline entities (upstream of signal packs)

| Entity | Description |
|--------|-------------|
| **Evidence import** | XLSX or scraper ingest → `inputs_evidence_imports` + `inputs_evidence_rows`. |
| **Evidence insights** | Row-level LLM/vision passes → `inputs_evidence_row_insights` (broad, top-performer tiers). |
| **Ideas** | Structured idea list → `ideas`, `signal_pack_ideas`, `inputs_ideas`. |
| **Creative Intelligence** | Archived top-performer media + vision analysis → `creative_*` tables. |

See **`docs/CAF_INPUTS_PIPELINE_ROADMAP.md`** and **`docs/CREATIVE_INTELLIGENCE.md`**.

---

## ID conventions

| Entity | Field | Pattern | Example |
|--------|-------|---------|---------|
| Run | `run_id` | `{PROJECT}_{period}` | `SNS_2026W09` |
| Candidate | `candidate_id` | `{run_id}_{platform}_{NNNN}` or `{base}_{flow_type}` | `SNS_2026W09_Instagram_0002` |
| Job | `task_id` | `{run_id}__{platform}__{flow_type}__row{NNNN}__{variation}` | `SNS_2026W09__Instagram__FLOW_CAROUSEL__row0002__v1` |
| Draft | `draft_id` | `d_{random12}` | `d_mn398eopb4y3` |
| Asset | `asset_id` | `{candidate_id}__{ASSET_TYPE}_v{version}` | `SNS_2026W09_Multi_0005__VIDEO_v1` |
| Scene | `scene_id` | `{task_id}__scene_{NN}` | `...row0012__scene_01` |

**`task_id`** is the main execution key. Downstream tables (`job_drafts`, `assets`, `editorial_reviews`, `job_state_transitions`, `diagnostic_audits`, `performance_metrics`, `auto_validation_results`) reference it.

---

## Relationships (text joins, not UUID FKs)

- `content_jobs.run_id` = `runs.run_id` (same text key, scoped by `project_id`)
- `content_jobs.candidate_id` = decision-engine candidate id (text)
- `job_drafts.task_id` = `content_jobs.task_id`
- Cross-table joins use **`(project_id, task_id)`** or **`(project_id, run_id)`**

---

## Run lifecycle

```
CREATED → PLANNING → PLANNED → GENERATING → RENDERING → REVIEWING → COMPLETED
                                                              ↘ FAILED / CANCELLED
```

**Planning prerequisite:** Materialize planner rows into `runs.planned_jobs_json` (canonical; dual-written with legacy `candidates_json`) via `POST /v1/runs/:project_slug/:run_id/jobs` before `POST .../start`.

---

## Job lifecycle

Typical path:

```
PLANNED → GENERATING → GENERATED → (QC) → RENDERING → IN_REVIEW → APPROVED | REJECTED | NEEDS_EDIT
```

QC may route to `BLOCKED`, `QC_FAILED`, or short-circuit to `REJECTED` / `NEEDS_EDIT`. Video jobs may remain `RENDERING` during HeyGen/Sora polls.

Full detail: **`docs/LIFECYCLE.md`**.

---

## Editorial decisions

`APPROVED` | `NEEDS_EDIT` | `REJECTED`

---

## Critical JSON contract: `generation_payload`

On **`caf_core.content_jobs`**. Integration hub for pipeline, Review, and admin.

| Slice | Canonical helpers |
|-------|-------------------|
| `generated_output` | `src/domain/generation-payload-output.ts` |
| `qc_result` | `src/domain/generation-payload-qc.ts` — write via **`mergeGenerationPayloadQc` only** |
| `render_state` | `src/domain/content-job-render-state.ts` — **`hasActiveProviderSession`** for HeyGen idempotency |
| Mimic render truth | `mimic_v1` on `generation_payload` (`src/domain/mimic-payload.ts`) |
| Carousel mimic review | `mimic_carousel_package` — **only** `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`; not `carousel_package` |

---

## Invariants (do not break without explicit approval)

1. **`task_id`** remains the primary execution key across all job-related tables.
2. Do not rename or restructure the ID hierarchy casually.
3. Preserve parent-child traceability (scene bundles: `parent_id` / `parent_candidate_id`).
4. New tables follow the **text-ID join** pattern.
5. Status values stay compatible with existing state machines.
6. **`content_jobs`** is the source of truth for job state.

---

## Flow type families (planning / pipeline)

| Family | Examples | Notes |
|--------|----------|-------|
| Carousel | `FLOW_CAROUSEL` | Standard HBS renderer path |
| Video | `FLOW_*` video kinds, HeyGen, scene assembly | See `flow-kind.ts` |
| Product video | `FLOW_PRODUCT_*` | Product-focused video flows |
| Mimic | `FLOW_TOP_PERFORMER_MIMIC_IMAGE`, `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` | Requires `MIMIC_IMAGE_ENABLED` |
| Image product | `FLOW_IMG_*` | Registered; not fully wired to generation |
| Offline | Various | Excluded from pipeline — `offline-flow-types.ts` |

---

## See also

- [EXTERNAL_CONTEXT_PACK.md](./EXTERNAL_CONTEXT_PACK.md) — what to upload to external LLMs
- [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) — table catalog
- [LIFECYCLE.md](./LIFECYCLE.md) — full state machines
- [ARCHITECTURE.md](./ARCHITECTURE.md) — where code lives
