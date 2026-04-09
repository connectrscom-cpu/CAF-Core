# CAF — Validation Layer + Publishing Layer

This document explains how CAF’s **validation** and **publishing** layers work (and should evolve) during migration, with **CAF Core** as the database-first truth source while remaining compatible with legacy orchestration (n8n + Sheets + Supabase).

CAF’s funnel context:

**Signal Pack → Candidates → Decision Engine → Content Jobs → Drafts → Rendering → Review → Publishing → Learning**

---

## Validation layer (QC + routing + human review + rework)

### What “validation” means in CAF
Validation is the phase where CAF decides whether generated content is:
- safe enough and formatted correctly (**QC / risk gates**)
- acceptable to publish (**human review decisions**)
- in need of iteration (**NEEDS_EDIT → rework**)

Validation is not just UI; it is a **state machine with durable memory**.

---

### Canonical entities (CAF Core)
Validation is represented in CAF Core via these tables (text-ID joins are intentional):

- **`caf_core.content_jobs`**: the executable unit keyed by `task_id` (central entity)
- **`caf_core.editorial_reviews`**: human decision rows
  - `decision`: `APPROVED | NEEDS_EDIT | REJECTED`
  - `rejection_tags`, `notes`
  - `overrides_json` (structured “do this next time” / concrete override payload)
- **`caf_core.job_state_transitions`**: immutable audit trail of state changes
- **`caf_core.auto_validation_results`**: heuristic/automatic checks (format + banned substrings + scoring)
- **`caf_core.job_drafts`**: revision memory (attempts and rework rounds)
- **`caf_core.assets`**: preview artifacts used by reviewers (and later by publishing)

Join rules to preserve:
- use `(project_id, task_id)` for job-scoped joins
- use `(project_id, run_id)` for run-scoped joins
- do not replace `task_id` as the primary execution key

References:
- `03_domain_model.md`
- `08_current_ids_and_state_conventions.md`

---

### Validation states (practical, migration-compatible)
CAF currently has “status families” rather than one perfect enum registry. In practice:

- **Generation/render pipeline states** live primarily on `content_jobs.status` plus JSON in `generation_payload` / `render_state`.
- **Human decision** lives in `editorial_reviews.decision` (latest decision is what powers review queue tabs).

The Review Queue semantics in Core today are effectively:
- **In review**: job status in `('GENERATED','IN_REVIEW','READY_FOR_REVIEW')` and no submitted decision yet
- **Approved**: latest `editorial_reviews.decision = 'APPROVED'`
- **Rejected**: latest `editorial_reviews.decision = 'REJECTED'`
- **Needs edit**: latest `editorial_reviews.decision = 'NEEDS_EDIT'`

Implementation reference: `src/repositories/review-queue.ts`.

---

### Human review flow (Review App → CAF Core)
The Review App submits decisions to CAF Core via:

- **`POST /v1/reviews`**
  - inputs: `task_id`, `decision`, `notes`, `rejection_tags[]`, `validator`, `submit`
  - payload also supports structured overrides (stored as `overrides_json` in Core)

Reference: `docs/API_REFERENCE.md`, handlers in `src/routes/v1.ts`.

What CAF Core must guarantee:
- decisions are **durable** (insert, not overwrite)
- “latest decision” is easy to compute for queues and reporting
- review decisions can be linked to downstream rework and learning

---

### Rework (NEEDS_EDIT → regenerate → re-review)

#### Why rework must be first-class
Rework is the operational bridge between “human taste feedback” and “improved next generation.”

If CAF only records `NEEDS_EDIT` but has no repeatable rework workflow, then:
- editorial feedback exists but can’t be applied safely
- revision history gets overwritten or lost
- learning loops can’t reliably map “what changed” to “what improved”

#### What CAF Core implements today
CAF Core already provides a rework executor endpoint:

- **`POST /v1/pipeline/:project_slug/task/:task_id/rework`**
  - expects: the job exists in `caf_core.content_jobs`
  - expects: latest `caf_core.editorial_reviews` decision for that `task_id` is `NEEDS_EDIT`

Implementation reference:
- endpoint: `src/routes/pipeline.ts`
- logic: `src/services/rework-orchestrator.ts`
- trace field: `content_jobs.rework_parent_task_id` (migration `migrations/004_rework_and_publish_fields.sql`)

#### Rework modes (behavior)
CAF Core infers a rework mode from `rejection_tags` and `notes`:

- **OVERRIDE_ONLY**
  - condition: reviewer provided clean overrides (or tagged it as override-only)
  - action: merge overrides into the existing job’s `generation_payload.generated_output`
  - state: update `content_jobs.status = 'IN_REVIEW'` and insert a `job_state_transitions` event (`NEEDS_EDIT → IN_REVIEW`)
  - identity: **same `task_id`** (no new job created)

- **PARTIAL_REWRITE** / **FULL_REWORK**
  - action: create a new child job with a new `task_id`
  - set: `rework_parent_task_id = <original_task_id>`
  - store: human feedback + mode + new `draft_id` in the new job’s `generation_payload`
  - run: the standard pipeline on the new job (generation → optional rendering → back to review queue)

#### Audit trail requirements
Even during migration, rework must be queryable without relying on Sheets:

- `caf_core.editorial_reviews` is the durable record of “what the human asked for”
- `caf_core.job_state_transitions` is the durable record of “what state changed, when, and why”
- `rework_parent_task_id` is the durable lineage link between the original job and the reworked child job

Target-state strengthening (recommended): write a `caf_core.job_drafts` row per rework attempt so revision memory is not trapped in JSON.

---

### Auto-validation (heuristic checks)
CAF Core supports automatic format/risk checks via:

- **`POST /v1/auto-validation`** (see `docs/API_REFERENCE.md`)
  - inserts rows into `caf_core.auto_validation_results`

Auto-validation should be treated as a **routing signal**, not a final arbiter:
- it can force human review
- it can trigger `NEEDS_EDIT` in some QC policies
- it should feed learning (e.g. repeated “format failures”)

---

## Publishing layer (eligibility + attempts + executors + metrics)

### Why publishing must be a workflow
Publishing is not “write a URL somewhere.” It must be:
- gated (publish only approved, asset-complete jobs)
- idempotent (safe retries)
- observable (attempt logs + state)
- linkable (provider post IDs map back to `task_id` for metrics)

---

### Legacy reality to preserve (n8n Meta Graph publishing)
Current n8n flows for IG/FB publishing generally operate with fields like:
- `publish_target` (`Instagram` | `Facebook`)
- `publish_caption`
- carousel: `publish_media_urls` / `publish_media_urls_json`
- video: `publish_video_url`
- results: `post_success`, `platform_post_id`, `posted_url`, `publish_error`

These are useful contracts to keep stable while Core becomes the canonical ledger.

---

### Publish-ready eligibility gates (CAF Core-owned)
Before any executor runs, CAF Core should enforce gates such as:

- **Approval**: latest `editorial_reviews.decision = 'APPROVED'`
- **Assets present**: required `caf_core.assets.public_url` exist and are stable
- **Metadata present**: caption/hashtags/etc. for the platform
  - helper/reference: `src/services/publish-metadata-enrich.ts`

If a gate fails, publishing should not proceed; the failure reason should be stored so an operator can fix and retry.

---

### Publishing attempt lifecycle (recommended Core model)
Keep publishing state separate from `content_jobs.status` so it doesn’t conflict with rework/review.

Minimum viable attempt states:
- `SCHEDULED → PUBLISHING → PUBLISHED | FAILED`

Each attempt should store:
- the publish request snapshot (caption, asset URLs, target)
- provider response snapshot
- `platform_post_id` + `posted_url` when successful
- error reason when failed

Idempotency key (recommended): `(project_id, task_id, platform, idempotency_key)`.

---

### Executors/adapters
Implement publishing behind an interface so the first executor can remain “call n8n workflow,” while later executors can publish directly.

Executor contract (conceptual):
- input: `task_id`, `platform`, asset URLs, caption, config
- output: `platform_post_id`, `posted_url`, raw provider response

---

### Performance ingestion (Market Learning Loop C)
CAF Core already supports ingesting performance data as first-class rows:

- **`POST /v1/metrics`** (see `docs/API_REFERENCE.md`)
- stored in: `caf_core.performance_metrics` keyed by `(project_id, task_id)`
- learning analysis: `src/services/market-learning.ts`

Required hardening as publishing matures:
- reliably map **provider post id → task_id**
- store both `metric_window = early | stabilized`
- make ingestion idempotent via a batch ID / unique key (so re-runs don’t duplicate)

---

## Cross-links
- `02_current_architecture.md` (operational ownership)
- `03_domain_model.md` (entities)
- `07_learning_layer_spec.md` (learning loops)
- `08_current_ids_and_state_conventions.md` (IDs + state compatibility)
- `docs/API_REFERENCE.md` (HTTP endpoints)
