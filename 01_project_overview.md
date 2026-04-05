# CAF — Project Overview

## What CAF is

CAF stands for **Content Automation Framework**.

It is a multi-phase content operating system built to collect signals from the market, turn those signals into structured ideas, generate assets, route them through validation, and eventually learn from outcomes. In the current implementation, CAF is not one app. It is a distributed system split across **n8n**, **Google Sheets**, **Supabase**, **Fly-hosted services**, and a **review app**.

The practical goal is simple: produce content continuously without needing a human to manually assemble every post from scratch.

The harder truth is also simple: CAF currently automates output better than it automates judgment.

---

## Current CAF phases

CAF is structured around six phases:

### 1. INPUT / RESEARCH
CAF gathers raw material from external sources such as:
- Reddit
- Instagram
- TikTok
- Facebook
- HTML websites / blogs

The current system already scrapes, normalizes, and stores source data in project workbooks. This is the acquisition layer.

### 2. PROCESSING
CAF turns raw source material into:
- summaries
- archetypes
- top examples
- pattern learnings
- cross-platform candidate pools

This is where “what happened in the market” becomes “what CAF thinks is worth creating.”

### 3. CREATION
CAF transforms processed insights into:
- Signal Packs
- Content Candidates
- Content Jobs

This is the bridge from insight to execution. The most important object here is the **ContentJob**, because that is the executable unit the rest of the system acts on.

### 4. VALIDATION
CAF applies:
- QC checks
- risk routing
- human review
- overrides and rejections

This happens partly in runtime logic and partly in the Review Queue / review app.

### 5. PUBLISHING
CAF is intended to publish approved assets to channels after validation. The current publishing layer exists more as a results ledger than as a fully mature operational subsystem.

### 6. LEARNING
CAF is intended to learn from:
- diagnostic audits
- editorial corrections
- post-publication performance

This is the weakest part of the current architecture. The concept exists. The implementation is thin.

---

## Current stack

CAF currently runs across the following stack:

- **n8n** — orchestration engine and workflow executor
- **Google Sheets** — current control plane, runtime queue, review state, and operating memory
- **Supabase** — durable storage for tasks, assets, and hosted media
- **Fly.io** — rendering and media-processing services exposed over stable HTTP endpoints
- **CAF Review App** — human approval/edit interface

This split matters. CAF today is not DB-first. It is **workflow-first**, with Sheets acting as the visible state machine and Supabase acting as the durable software-native storage layer.

---

## Current status

### What already works
CAF already works far enough to prove the concept:
- it can ingest research inputs
- it can synthesize findings
- it can create candidate content
- it can generate jobs
- it can render carousel and video outputs
- it can push content into a human review queue
- it can carry asset state across multiple services

In blunt terms: the machine runs.

### What is weak
The quality problem is real:
- content can be generic
- selection is not strong enough
- bad ideas are not filtered aggressively enough
- editorial feedback is captured but not deeply reused
- market feedback is not properly closing the loop
- too much logic lives in n8n and Sheets instead of explicit software modules

In even blunter terms: CAF automates content production faster than it automates taste.

---

## Rebuild goal

The rebuild target is **CAF Core**.

CAF Core is meant to become the backend platform that owns:
- the true domain model
- structured state
- learning loops
- feedback memory
- migration away from fragile logic trapped in flows

The rebuild should not treat the old system as trash. The old system already contains the operating knowledge. The problem is that too much of that knowledge is trapped in:
- code nodes
- spreadsheet columns
- implicit conventions
- one-off flow branches

CAF Core should extract that knowledge, formalize it, and make the system more testable, more durable, and more capable of improving over time.

---

## What must be preserved

The rebuild must preserve what is already structurally good:
- the phased model
- the ID hierarchy (`run_id`, `candidate_id`, `task_id`, `asset_id`)
- compatibility with current n8n orchestration during migration
- the separation between human review and machine generation
- the ability to support multiple projects, not just SNS

---

## What is actually being rebuilt

CAF is **not** being rebuilt because it cannot generate content.

CAF is being rebuilt because the current system:
- does not evaluate strongly enough
- does not learn strongly enough
- does not centralize logic cleanly enough
- is becoming too complex to comfortably maintain as flow-heavy infrastructure

The next version must turn CAF from:
> a system that produces content

into:
> a system that produces better content over time.
