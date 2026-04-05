# CAF — Rebuild Goals

## Purpose of this document

This document defines what the new CAF Core project is supposed to achieve.

It should stop the rebuild from turning into a vague “make it better” exercise.

---

## 1. Primary objective

Build **CAF Core** as the backend platform that gives CAF:
- explicit domain ownership
- structured state
- learning loops
- migration safety
- long-term maintainability

CAF Core is not supposed to replace every existing system immediately.
It is supposed to become the stable core around which the existing system can be gradually reorganized.

---

## 2. What CAF Core should own

CAF Core should progressively become the owner of:

### Domain model
The entities must become explicit and durable:
- Project
- Run
- SignalPack
- Candidate
- ContentJob
- Asset
- DiagnosticAudit
- EditorialReview
- PerformanceMetric
- LearningRule
- PromptVersion
- Experiment

### Structured persistence
CAF Core should own database-first representations of those entities instead of leaving them trapped in:
- spreadsheet shapes
- n8n code nodes
- implicit JSON payload conventions

### Learning logic
CAF Core should own the mechanisms that turn:
- diagnostics
- review decisions
- market outcomes

into future operating changes.

### Service contracts
CAF Core should define stable APIs / contracts for:
- ingesting jobs
- storing audits
- writing structured review feedback
- exposing assets / state for UI
- supporting downstream automation

---

## 3. The three strategic learning loops

CAF Core must support three learning loops:

### Diagnostic learning
Learn from structured evaluation of content quality.

### Editorial learning
Learn from human review decisions, edits, overrides, and rejection patterns.

### Market learning
Learn from actual publishing performance.

These loops are not optional side features.
They are the reason the rebuild exists.

---

## 4. Migration goal

CAF Core should be introduced **without breaking the currently working system**.

That means:
- keep n8n operating during migration
- preserve current ID conventions
- preserve working integrations
- let old and new state coexist for a period
- progressively move ownership inward

The migration should be staged, not ideological.

---

## 5. Move toward DB-first state ownership

Today, too much operational truth is effectively sheet-first.

The rebuild should move toward:
- database-first durable state
- explicit APIs and services
- thinner spreadsheet usage
- thinner workflow logic

This does **not** mean “delete Sheets tomorrow.”
It means:
- stop adding new core complexity to Sheets
- stop trapping new business logic in n8n if CAF Core can own it instead

---

## 6. Preserve compatibility with the current system

The rebuild must preserve what already works.

That includes:
- current runs/candidates/jobs lineage
- current render services
- current external providers
- current review flow semantics
- current route and status concepts where they are already useful

Do not break continuity just to make the model look cleaner on paper.

---

## 7. Support multi-project usage

CAF Core should not be designed as an SNS-only backend.

It should support:
- multiple projects
- project-specific constraints
- project-specific prompt versions
- project-specific learning memory
- shared CAF-level infrastructure where appropriate

The current system already implies this direction.
The rebuild should make it real.

---

## 8. Reduce flow-based maintenance burden

One major reason for the rebuild is that maintenance is becoming uncomfortable.

CAF Core should reduce reliance on:
- brittle code nodes
- repeated normalization logic
- hidden assumptions between workflows
- spreadsheet-width as architecture

The desired direction is:
- n8n for orchestration
- CAF Core for domain logic

That separation should become sharper over time.

---

## 9. What not to do

### Do not rewrite everything at once
That is the fastest way to lose working behavior and create migration chaos.

### Do not rebuild scrapers first
Input is not the main strategic bottleneck.
The bottleneck is learning and selection.

### Do not replace working integrations just because they are external
If Supabase, Fly, HeyGen, Apify, or existing review paths are working, do not rip them out without a strong reason.

### Do not prematurely optimize infrastructure while leaving taste unsolved
The system’s main weakness is not that it cannot execute.
It is that it does not yet judge and learn strongly enough.

### Do not let CAF Core become another vague abstraction layer
CAF Core must map to the real operating entities and problems, not become a decorative wrapper.

---

## 10. What success looks like

CAF Core is succeeding if, over time, CAF becomes able to:

- ingest and store jobs cleanly
- explain why outputs are failing
- remember human corrections
- compare outcomes across prompt versions and experiments
- improve candidate selection
- improve approval rates
- improve publishing results
- reduce complexity trapped in flows and sheets

---

## 11. First-principles summary

The rebuild is not about replacing automation.

It is about giving automation:
- memory
- judgment
- structure
- durable learning

That is the actual job.
