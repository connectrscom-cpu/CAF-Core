# CAF — Migration Strategy

## Purpose of this document

This document defines how to rebuild CAF without destroying the working system.

The migration strategy should be realistic:
- staged
- backward-compatible where needed
- focused on leverage
- hostile to fantasy rewrites

---

## Core migration principle

Do **not** try to replace the entire CAF stack in one move.

Instead:
- preserve working orchestration
- preserve working providers
- preserve current IDs
- add CAF Core as the new domain and learning center
- move ownership inward phase by phase

---

## Phase 0 — Freeze the doctrine

### Goal
Create a clean operating doctrine before major code work.

### Deliverables
- project overview
- domain model
- current architecture map
- pipeline-by-phase map
- known problems
- learning layer spec
- ID/state conventions
- integration map
- migration strategy
- source artifact pack

### Why this phase matters
Without doctrine, the new project will recreate the old problem:
the system will exist mostly in your head.

---

## Phase 1 — Build CAF Core foundations

### Goal
Create the first real backend foundation without disrupting current flows.

### What to build
- core database schema
- core entity models
- APIs or services for:
  - ingesting jobs
  - storing audits
  - storing review feedback
  - storing performance metrics
- initial admin/debug visibility into those records

### What not to change yet
- do not replace n8n creation flows
- do not replace source scrapers
- do not rebuild render providers
- do not attempt full publishing redesign first

### Outcome
CAF Core exists as a parallel durable system, even if old flows still do most of the orchestration.

---

## Phase 2 — Ingest current runtime state into CAF Core

### Goal
Start mirroring or ingesting key operational state from the existing system.

### What to connect
- `Content_Jobs`
- review decisions
- asset references / URLs
- prompt version references where available
- publishing metrics where available

### Approach
Use adapters or sync jobs that:
- read current sheet/runtime state
- write normalized records into CAF Core

### Why this phase matters
It lets CAF Core begin to understand the live system before it starts trying to control it.

---

## Phase 3 — Implement Diagnostic Learning first

### Goal
Create the first real learning loop.

### Why start here
Diagnostic learning does not require publishing maturity and can start generating value quickly by explaining failures.

### Deliverables
- DiagnosticAudit schema
- audit runner/service
- audit storage
- failure-type taxonomy
- basic operator visibility
- links from audits back to jobs

### Outcome
CAF Core stops being just a storage mirror and starts becoming an intelligence layer.

---

## Phase 4 — Add Editorial Learning

### Goal
Turn review activity into structured feedback memory.

### What to ingest
- approvals
- rejections
- edits
- override fields
- rejection tags
- validation events

### Deliverables
- EditorialReview schema
- validation event capture / sync
- structured change extraction
- first derived learning rules from review behavior

### Outcome
Human taste stops disappearing after the review step.

---

## Phase 5 — Add Market Learning

### Goal
Turn publishing results into a real learning signal.

### What to ingest
- likes
- comments
- shares
- saves
- watch-time
- engagement rates
- later: conversion metrics if available

### Deliverables
- PerformanceMetric schema
- metrics ingestion path
- reporting by flow / prompt / project / archetype
- rule generation from real outcomes

### Outcome
CAF begins to optimize against the market, not just against its own internal logic.

---

## Phase 6 — Start moving decision logic out of n8n

### Goal
Reduce business logic trapped in workflows.

### Good first candidates to migrate
- candidate scoring / prioritization
- diagnostic audit logic
- prompt selection logic
- learning rule application
- approval prediction / review routing support

### What can stay in n8n longer
- external API orchestration
- provider polling
- simple glue logic
- source retrieval
- dispatch to render services

### Outcome
n8n becomes thinner and more orchestration-focused.

---

## Phase 7 — Reduce Sheets dependence gradually

### Goal
Move away from Sheets as the place where core truth accumulates.

### Strategy
- preserve Sheets where operators still benefit from them
- stop introducing new core logic into Sheets
- stop using sheet shape as the main architecture definition
- allow Sheets to become views / ops surfaces rather than the deepest truth layer

### Important warning
Do not rip Sheets out early.
That creates operational pain before CAF Core is ready.

---

## Phase 8 — Rationalize the review and publishing layer

### Goal
Once CAF Core owns more structured state, simplify how review and publishing interact with it.

### Possible future direction
- review app reads more directly from CAF Core entities
- Sheets remain optional ops/export surfaces
- publishing and metrics ingestion become cleaner and more explicit
- approval, override, and performance history become first-class linked records

### Outcome
The system becomes easier to reason about end to end.

---

## First milestone recommendation

The first milestone for the new repo should be:

1. define core schema
2. ingest or mirror ContentJobs
3. run DiagnosticAudits
4. store audit results
5. expose them for review UI / ops use

This is practical because it:
- gives immediate value
- creates the first real learning artifact
- does not require replacing everything else first

---

## Migration rules to keep repeating

### Rule 1
Preserve current ID conventions.

### Rule 2
Do not break working n8n orchestration unless CAF Core already provides a better stable contract.

### Rule 3
Do not start by rebuilding inputs.

### Rule 4
Do not confuse “more code” with “more intelligence.”

### Rule 5
Each migration step should leave the system in a working state.

---

## Anti-patterns to avoid

### Big-bang rewrite
High risk, low realism.

### Infrastructure vanity rebuild
Rebuilding services just because the current shape looks messy.

### Domain drift
Creating new abstractions that no longer map cleanly to Runs, Candidates, Jobs, Assets, Reviews, and Metrics.

### Analytics theater
Producing dashboards and audits that do not actually change future generation.

---

## Final summary

The migration strategy is simple in principle:

- keep the machine running
- build CAF Core next to it
- ingest current state
- implement learning loops
- move logic inward gradually
- reduce fragility without losing working behavior

That is the rebuild path that makes sense.
