# CAF Core — Project overview

This document explains **what CAF Core is**, **what problems it solves**, and **how the pieces fit together** at a level suitable for stakeholders and new engineers.

## What is CAF Core?

**CAF** (Content Automation Framework) is a **content pipeline platform**. **CAF Core** is the backend: a **Fastify API + PostgreSQL** application that owns **operational truth** for content production—research signals, planned work units (**content jobs**), AI-generated drafts, quality checks, rendered media, human review decisions, publication scheduling, and learning artifacts.

Companion apps and services talk to Core over HTTP:

| Piece | Role |
|--------|------|
| **CAF Core** (this repo root) | API, business logic, `caf_core` schema |
| **Review app** (`apps/review`) | Next.js operator UI; **not** the database of record |
| **Carousel renderer** (`services/renderer`) | Puppeteer + Handlebars → slide images |
| **Video assembly** (`services/video-assembly`) | ffmpeg stitch/mux/subtitles → video files |
| **Media gateway** (`services/media-gateway`) | Single port for renderer + assembly |

Core is **self-contained**: planning, jobs, QC, rendering, review, publishing, and learning all live in this repo and Postgres. Companion services only add media rendering and the operator UI.

## What problem does it solve?

Teams that produce **scaled social content** (carousels, reels, scripted video) need:

1. **Structured intake** — research / signals turned into candidates with typed fields and lineage.
2. **Controlled generation** — prompts, schemas, tenant config, caps, suppression.
3. **Quality gates** — automated checks + risk keyword policies before expensive render.
4. **Human review** — approvals, rework, overrides without corrupting lineage.
5. **Media production** — carousel PNGs, HeyGen/Sora/ffmpeg pipelines, assets in storage.
6. **Publishing intent** — placements, schedules, outcomes (Meta or external workers).
7. **Learning** — rules and evidence so future runs can score better and prompts can include guidance.

CAF Core implements that **as data in Postgres** and **HTTP APIs**, not as a single monolithic LLM script.

## Core concepts (plain language)

- **Project** — A tenant (brand). Holds strategy, brand constraints, allowed flow types, learning rules.
- **Signal pack** — A bundle of research (often from an `.xlsx` upload). Feeds **candidates**.
- **Run** — One production cycle for a project, linked to a signal pack. Groups all jobs from that intake.
- **Content job** — The **atomic unit of work**. Keyed by **`task_id`**. Carries **`generation_payload`** (the main JSON contract: prompts, LLM output, QC, render hints, publish URLs).
- **Draft** — One LLM attempt for a job (`job_drafts`).
- **Asset** — Rendered file (image/video) linked to a job (`assets`, often Supabase URLs).
- **Publication placement** — Scheduled or completed publish intent per platform (`publication_placements`).

## Typical workflow

1. Upload or CLI-ingest a **signal pack**; create a **run**.
2. **Start** the run → orchestrator builds **planned jobs** in **`content_jobs`** (`PLANNED`).
3. **Process** the run (or single job) → LLM generation → **QC** → diagnostics → **render** (carousel/video) → **`IN_REVIEW`**.
4. Operators use the **Review app** (or APIs) → **approve**, **reject**, or **needs edit** (rework).
5. **Publications** API records what to post and outcomes; **learning** routes ingest metrics and rules.

For a **technical** walkthrough (files, tables, boundaries), see **[ARCHITECTURE.md](./ARCHITECTURE.md)**.

## Who should read what

| Audience | Doc |
|----------|-----|
| Product / ops / leadership | This file |
| Engineers implementing features | `docs/CAF_CORE_COMPLETE_GUIDE.md` (single file), or `docs/ARCHITECTURE.md`, `docs/layers/README.md`, `README.md`, `docs/API_REFERENCE.md` |
| Lifecycle & states | `docs/LIFECYCLE.md` |
| QC / guidance / risk behavior | `docs/QUALITY_CHECKS.md`, `docs/GENERATION_GUIDANCE.md`, `docs/RISK_RULES.md` |
| AI assistants / tooling | `AGENTS.md` (repo root) |
| Environment & secrets | `docs/USER_INPUT_AND_SECRETS.md`, `ENV_AND_SECRETS_INVENTORY.md` |

## Relationship to “CAF” branding

Marketing may call CAF a “content operating system.” In **this repository**, treat that as a **description of the pipeline**, not a guarantee that every subsystem is equally mature: some **flow types** are fully wired (carousel, several video paths); others are **registered but not yet implemented** (e.g. certain image product flows—see `src/domain/product-flow-types.ts`).

## See also

- [CAF_CORE_COMPLETE_GUIDE.md](./CAF_CORE_COMPLETE_GUIDE.md) — **everything in one document** (merged from split docs)
- [ARCHITECTURE.md](./ARCHITECTURE.md) — layers, modules, lifecycle
- [LIFECYCLE.md](./LIFECYCLE.md) — state machines
- [TECH_STACK.md](./TECH_STACK.md)
- [layers/README.md](./layers/README.md) — one doc per layer
- [QUALITY_CHECKS.md](./QUALITY_CHECKS.md), [GENERATION_GUIDANCE.md](./GENERATION_GUIDANCE.md), [RISK_RULES.md](./RISK_RULES.md)
- [API_REFERENCE.md](./API_REFERENCE.md) — HTTP examples
- [VIDEO_FLOWS.md](./VIDEO_FLOWS.md) — video-specific behavior
