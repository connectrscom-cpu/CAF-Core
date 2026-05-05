# CAF Core Knowledge Drift Report

Snapshot anchor:
- Date: 2026-05-05
- Repo: CAF-Core
- Branch: master
- Commit: 64c85a3d3a4fac6ac70bf6ccf896e2f22f0a2f1d

This report is written as “things a typical CAF mental model gets wrong” vs what the repo actually does today, anchored on the code and migrations present in this workspace. Treat items below as **corrections to project memory** when ingesting CAF Core knowledge.

## Critical drift

| Area | Old understanding (common) | Current repo reality | Impact | Fix |
|---|---|---|---|---|
| Run planning inputs | “Orchestrator reads `signal_packs` directly to plan jobs.” | Run routes require **materializing `runs.candidates_json`** from the signal pack before starting. `POST /v1/runs/:project/:run/candidates` is an explicit prerequisite, and `start` errors mention `candidates_json`/materialize. | If you skip materialization, run start fails or plans against missing data. | Update guidance to: **Signal Pack → Materialize candidates → Start/plan**. Treat `runs.candidates_json` as planning SoT for a run. |
| Output schema validation semantics | “CAF Core validates output schemas by default.” | Legacy flag `CAF_SKIP_OUTPUT_SCHEMA_VALIDATION` defaults to effectively **skip** when unset; new tri-state `CAF_OUTPUT_SCHEMA_VALIDATION_MODE` introduces **skip/warn/enforce**. | You can think you’re enforcing schemas but actually aren’t; invalid generated output can slip through to QC/render. | Ingest config rules: use `CAF_OUTPUT_SCHEMA_VALIDATION_MODE` as canonical; treat unset legacy flag as skip. |
| QC routing after pass | “QC pass can lead to auto-publish.” | `CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC` defaults to **true**, so QC is intended to route passing jobs to **human review**, not auto-publish. | Systems assuming auto-publish will stall waiting for nonexistent automation. | In docs/context: default is “QC pass → IN_REVIEW”. Auto-publish is opt-in. |
| Publishing execution meaning | “A placement means a post was published.” | Placements have executor modes. Default `CAF_PUBLISH_EXECUTOR=none` means Core returns an external payload; an external worker must post and call `/complete`. | Misreporting publication success; missing completes will leave placements in publishing/scheduled. | Treat placements as intent+status. Only `executor=meta|dry_run` implies Core attempted execution. |
| “Global learning” | “Learning rules merge project + global (caf-global) by default.” | Learning routes explicitly state **global learning is disabled** and reject global operations (“use project-scoped rules only”). | You may assume system-wide guidance is active when it isn’t. | Ingest rule: **learning is project-scoped** unless code reintroduces global. |
| Review app authority | “Review app owns state; Core reads review decisions from UI storage.” | Review decisions are written to Postgres via Core routes (`/v1/review-queue/.../decide`, `/v1/reviews`). Core updates `content_jobs.status` and writes `job_state_transitions`; Review is a client. | If memory treats Review as authoritative, you’ll mis-locate truth and debugging will be wrong. | Persist: “Postgres/Core is truth; Review is client.” |

## Moderate drift

| Area | Old understanding (common) | Current repo reality | Impact | Fix |
|---|---|---|---|---|
| Run processing vs rendering | “Start+process runs render automatically.” | Run endpoints `/process` and `/start-and-process` explicitly run “draft package generation” in background and stop jobs at `GENERATED`, with a separate `/render` step for assets. | Operators may wait for assets that will never appear until `/render` is called. | Update operator playbook: `start → process (LLM/QC/diagnostic) → render`. |
| Pipeline status vocabulary | “Job statuses are strictly PLANNED→GENERATING→RENDERING→IN_REVIEW→APPROVED/REJECTED.” | Pipeline routes set/expect statuses including `GENERATED`, `QC_FAILED`, `BLOCKED`, and use `IN_REVIEW` as a terminal of the “full” endpoint even when rendering is skipped. | Confusion in dashboards, automation, and lifecycle diagrams. | Update lifecycle docs to include the observed statuses, or clearly scope diagrams (run lifecycle vs per-job pipeline endpoint). |
| Copy-only approval | “Any approval implies a regenerate/re-render step.” | Review decision handler includes a **copy-only bypass**: approving with `regenerate=false` patches `generation_payload.generated_output` and reuses existing assets. | “Why didn’t it rerender?” confusion; billing assumptions wrong. | Document the bypass and how `regenerate` is inferred from structured validation output. |
| Asset URL accessibility | “Asset URLs stored are directly usable by UI and Meta.” | `assets` bucket is often private; Core signs URLs for review endpoints before returning and also signs known URL fields in `generation_payload`. | UI and platform fetches fail without signing. | Ingest: treat “signed URL at API response time” as canonical behavior; don’t assume stored URLs are public. |

## Minor drift

| Area | Old understanding (common) | Current repo reality | Impact | Fix |
|---|---|---|---|---|
| Health/readiness | “/health is readiness.” | `/health` is liveness; `/readyz` checks DB. `/health/rendering` probes external rendering deps. | Misconfigured deploy checks. | Use `/readyz` for platform readiness; keep `/health` simple. |
| Flow naming | “Legacy flow names like `Flow_Carousel_Copy` are canonical.” | Migration 041 introduces canonical `FLOW_*` identifiers and output schema name aliases (`OS_*`), without rewriting `task_id`. | Mixed flow identifiers in DB; mismatch in analytics. | Normalize flow_type where feasible; never assume task_id changes. |
| Editorial analysis bookkeeping | “Editorial reviews have no consumption marker.” | Migration 044 adds `editorial_analysis_consumed_at` index+column for loop-B consumption tracking. | Re-analysis may double count without respecting marker. | Treat `editorial_analysis_consumed_at` as the canonical “already analyzed” marker. |

## Docs that should be rewritten (high-priority)
- Any doc describing run start without the explicit **candidates materialization** step should be updated to include `/v1/runs/:project/:run/candidates` and the rule “start expects candidates_json”.
- Any doc implying “schema validation is on by default” should be updated to reflect:
  - legacy default: skip when unset
  - preferred: `CAF_OUTPUT_SCHEMA_VALIDATION_MODE`
- Any doc implying global learning rules are active should be updated to “disabled for now”.
- Any doc implying placements imply posts should be updated to executor-mode semantics.

## Memories/project assumptions that should be corrected
- “QC == output schema validation” → false (separate stages; different knobs).
- “Start-and-process includes rendering” → false (render is separate).
- “Review owns state” → false (Core writes status/transitions; Review consumes Core).
- “Risk rules in project config are enforced by QC” → treat as false unless `qc-runtime.ts` proves it; use the repo’s honesty endpoint guidance as canonical.

## Areas where code and docs may still disagree (explicitly track)
These require verifying against the repo docs you ingest (the items below are common contradiction zones and should be checked during ingestion):
- Whether lifecycles enumerate `GENERATED`, `QC_FAILED`, `BLOCKED` as first-class job statuses in diagrams.
- Whether docs treat candidates as DB rows (`caf_core.candidates`) vs run-local `runs.candidates_json`.
- Whether docs describe “global learning” or “caf-global” as active behavior (routes currently reject it).
