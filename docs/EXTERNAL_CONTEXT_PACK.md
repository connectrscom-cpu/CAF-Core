# CAF Core — External context pack

**Purpose:** Tell another team, another repository, or an external LLM (ChatGPT, Claude, etc.) **everything it needs to understand, comment on, or re-implement CAF Core** — without pasting the full source tree.

**How to use this file**

1. Read this page first — it is the **table of contents and rules of engagement**.
2. Attach the **Tier 1 bundle** (below) to your LLM project or onboarding packet.
3. Add **Tier 2** docs when the topic is mimic, inputs, video, or publishing.
4. Attach **specific source files** only when asking for implementation-level changes.

**Convention:** Paths are from the **repository root**. Database schema is **`caf_core`**. The primary execution key is **`task_id`** scoped by **`project_id`**.

---

## What CAF Core is (30-second version)

CAF (Content Automation Framework) is a **content automation pipeline**:

**Signal Pack → Candidates → Decision Engine → Content Jobs → LLM Drafts → QC → Rendering → Review → Publishing → Learning**

- **Source of truth:** PostgreSQL schema `caf_core`, especially `content_jobs` and `generation_payload`.
- **Core API:** Fastify + TypeScript at repo root (`src/server.ts`).
- **Review app:** Next.js client in `apps/review` — not the database of record.
- **Media workers:** `services/renderer` (carousel PNGs), `services/video-assembly` (ffmpeg), `services/media-gateway` (combined port).

---

## Tier 1 — Always include (general understanding)

Upload or paste these files together for **architecture, lifecycle, contracts, and invariants**:

| # | File | What it gives the reader |
|---|------|--------------------------|
| 0 | **`docs/CAF_CURRENT_STATE_CONTEXT_PACK.md`** | **Repo-derived current state (2026-07)** — start here if context is stale |
| 1 | **`AGENTS.md`** | Invariants, “do not break,” where to change behavior |
| 2 | **`docs/CAF_CORE_COMPLETE_GUIDE.md`** | Single-file merged reference (~500 lines) — may lag BVS / new visual |
| 3 | **`docs/DOMAIN_MODEL.md`** | Entities, ID patterns, lifecycles (external copy of domain rules) |
| 4 | **`docs/ARCHITECTURE.md`** | Layer map, critical files, integration contracts |
| 5 | **`docs/LIFECYCLE.md`** | Run & job state machines |
| 6 | **`docs/TECH_STACK.md`** | Languages, services, third parties |
| 7 | **`docs/layers/README.md`** | Index to per-layer deep dives |

**ChatGPT PDF upload (4 volumes, everything operational):** `docs/export/pdf/11-caf-current-state-vol1-platform.pdf` through `14-caf-current-state-vol4-ops.pdf` — regenerate with `npm run export:doc-pdfs`. Source: `docs/volumes/CAF_CONTEXT_VOL*.md`.

**Optional but recommended for rebuilds:**

| # | File | What it gives the reader |
|---|------|--------------------------|
| 8 | **`docs/REBUILD_FROM_DOCS.md`** | Step-by-step local/prod bootstrap |
| 9 | **`docs/DATABASE_SCHEMA.md`** | Table catalog grouped by domain |
| 10 | **`README.md`** | Quick start, CLI, deploy map |
| 11 | **`.env.example`** | Configuration surface (no secrets) |
| 12 | **`ENV_AND_SECRETS_INVENTORY.md`** | Full env var checklist |

---

## Tier 2 — Topic add-ons (attach when relevant)

| Topic | Files |
|-------|--------|
| **HTTP API examples** | `docs/API_REFERENCE.md`, `requests/caf-core.http` |
| **QC runtime** | `docs/QUALITY_CHECKS.md` |
| **Risk policies** | `docs/RISK_RULES.md` |
| **LLM prompt guidance** | `docs/GENERATION_GUIDANCE.md` |
| **Per-layer detail** | `docs/layers/*.md` (10 files) |
| **Video / HeyGen** | `docs/VIDEO_FLOWS.md`, `docs/HEYGEN_API_V3.md` |
| **Top-performer mimic** | `docs/MIMIC_FLOWS_COMPLETE_GUIDE.md`, `docs/MIMIC_IMAGE_FLOWS.md` |
| **Mimic text placement (future)** | `docs/MIMIC_TEXT_PLACEMENT_AUTOMATION.md` |
| **Creative Intelligence ingest** | `docs/CREATIVE_INTELLIGENCE.md` |
| **Inputs → signal pack** | `docs/CAF_INPUTS_PIPELINE_ROADMAP.md` |
| **Content job lifecycle** | `docs/JOB_LIFECYCLE.md` |
| **Production deploy** | `docs/FLY_PRODUCTION_CHECKLIST.md` |
| **Secrets safety** | `docs/USER_INPUT_AND_SECRETS.md` |
| **Product pitch** | `docs/CAF_PRODUCT_PITCH.md` |
| **Complete product guide** | `docs/CAF_COMPLETE_PRODUCT_GUIDE.md` |
| **Shareable PDFs by topic** | `docs/export/pdf/*.pdf` — see `docs/export/README.md` |
| **Doc reconciliation task** | `docs/CURSOR_DOC_RECONCILIATION_PROMPT.md` — paste into Cursor to align stale docs with current-state pack |
| **Stakeholder overview** | `docs/PROJECT_OVERVIEW.md` |

---

## Tier 3 — Source code (implementation questions only)

Do **not** upload the entire `src/` tree. Attach **3–15 files** for the specific task.

| Goal | Start here |
|------|------------|
| Run planning | `src/decision_engine/`, `src/services/run-orchestrator.ts` |
| Job execution | `src/services/job-pipeline.ts` |
| LLM generation | `src/services/llm-generator.ts`, `src/repositories/flow-engine.ts` |
| QC | `src/services/qc-runtime.ts` |
| Mimic | `src/services/mimic-draft-prep.ts`, `mimic-carousel-render.ts`, `src/domain/mimic-payload.ts` |
| Review contract | `src/routes/v1.ts`, `src/routes/review-contract.test.ts` |
| Publications | `src/routes/publications.ts` |
| Learning | `src/services/learning-rule-selection.ts`, `src/routes/learning.ts` |
| Config / flags | `src/config.ts` |
| Schema truth | `migrations/*.sql` (relevant migrations only) |

**Scale reference (~2026):** ~113k lines TypeScript in `src/`, ~23k in `apps/review`, ~70 SQL migrations, ~140 test files.

---

## System prompt template (copy into ChatGPT / Custom GPT)

```text
You are helping with CAF Core — a Fastify + PostgreSQL content automation platform.

Pipeline funnel:
Signal Pack → Candidates → Decision Engine → Content Jobs → Drafts → QC → Render → Review → Publish → Learn

Rules:
- task_id + project_id are the primary keys for jobs, drafts, assets, reviews.
- content_jobs.generation_payload is the main JSON contract — treat changes as API design.
- The Review app (apps/review) is a client; Postgres caf_core is source of truth.
- Do not propose renaming task_id, run_id patterns, or lifecycle enums without explicit approval.
- QC writes qc_result only via mergeGenerationPayloadQc (generation-payload-qc.ts).
- HeyGen retries must use hasActiveProviderSession (content-job-render-state.ts).
- Learning lookups go through learning-rule-selection.ts facade.
- risk_policies + brand banned_words are enforced by QC; project risk_rules are NOT (see risk-qc-status).

When suggesting code: name exact file paths. When unsure which layer is affected, ask.
Prefer small, reviewable changes over repo-wide refactors.
```

Then attach **Tier 1** files from the table above.

---

## What external readers can and cannot do from docs alone

| Feasible from Tier 1 + 2 | Requires source + tests |
|---------------------------|-------------------------|
| Explain architecture and workflow | Line-accurate refactors |
| Design a feature in the right layer | Prove dead-code removal is safe |
| Review API / contract changes | Re-implement every edge case |
| Bootstrap a new environment | Match 100% of admin UI behavior |
| Compare to another system | Replace LLM prompts verbatim |

**Honesty:** `docs/CAF_CORE_COMPLETE_GUIDE.md` is a merged summary. **`migrations/`** and **`src/`** win on conflicts.

---

## Repository map (one screen)

```
CAF-Core/
├── src/                    # Core API (Fastify)
│   ├── server.ts           # Entry
│   ├── config.ts           # Env (Zod)
│   ├── routes/             # HTTP (v1, runs, pipeline, admin, …)
│   ├── services/           # Business logic (job-pipeline, llm-generator, …)
│   ├── decision_engine/    # Planning / scoring
│   ├── domain/             # Typed payload readers, mimic contracts
│   └── repositories/       # Postgres accessors
├── apps/review/            # Next.js operator UI
├── services/
│   ├── renderer/           # Carousel PNG worker
│   ├── video-assembly/     # ffmpeg worker
│   └── media-gateway/      # Combined gateway
├── migrations/             # caf_core schema (versioned SQL)
├── docs/                   # All documentation
├── AGENTS.md               # AI assistant invariants
├── .env.example            # Config template
└── ENV_AND_SECRETS_INVENTORY.md
```

---

## Related docs

| Doc | Audience |
|-----|----------|
| [REBUILD_FROM_DOCS.md](./REBUILD_FROM_DOCS.md) | Engineers bootstrapping from scratch |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | DB tables and relationships |
| [DOMAIN_MODEL.md](./DOMAIN_MODEL.md) | IDs and lifecycles |
| [CAF_CORE_COMPLETE_GUIDE.md](./CAF_CORE_COMPLETE_GUIDE.md) | Single-file full reference |

---

*Maintained as the canonical index for external context. Update this file when adding major docs or changing deploy topology.*
