# CAF — Product pitch

**Audience:** Leadership, investors, potential partners, and operators evaluating CAF as a platform — not engineers implementing it.

**One-liner:** CAF is a **content operating system** that turns research and signals into reviewed, publishable social content — with quality gates, human oversight, and a learning loop built in.

---

## The problem

Teams scaling social content (carousels, reels, scripted video) hit the same wall:

- **Ad-hoc AI** produces inconsistent output with no lineage, no caps, and no audit trail.
- **Spreadsheets and scripts** don’t scale across brands, platforms, or reviewers.
- **Expensive renders** (video, image generation) run before anyone checks copy or risk.
- **Learning stays tribal** — what worked last month doesn’t systematically improve next month’s prompts or planning.

CAF treats content production as **operational software**: structured intake → planned work → generation → QC → render → human review → publish → learn.

---

## What CAF is

**CAF** (Content Automation Framework) is a **multi-tenant content pipeline platform**.

| Layer | What it is |
|-------|------------|
| **CAF Core** | Backend brain — Postgres holds truth; APIs orchestrate the full funnel |
| **Review app** | Operator workbench — approve, reject, rework, publish |
| **Media services** | Carousel renderer + video assembly — production-grade PNG/video output |
| **Admin** | Project config, inputs processing, flow engine, learning rules |

It is **not** a single ChatGPT prompt or a no-code wrapper. It is **infrastructure for repeatable, governed content operations**.

---

## Who CAF is for

| Persona | How they use CAF |
|---------|------------------|
| **Content ops / social teams** | Run weekly production cycles from signal packs; review queue in one place |
| **Brand / growth leads** | Set strategy, caps, risk policies, and brand constraints per project |
| **Editors & reviewers** | Approve or send back work with structured rework — without losing history |
| **Engineering / platform** | Extend flows, integrate publishers, wire learning from performance data |
| **Agencies managing multiple brands** | One platform, many **projects** (tenants), isolated config and queues |

---

## What makes CAF different

| Typical approach | CAF approach |
|------------------|--------------|
| One-off LLM calls | **Content jobs** with `task_id`, drafts, and full revision history |
| Hope the copy is safe | **QC runtime** — checklists + risk policies **before** expensive render |
| Manual file handoffs | **generation_payload** — one contract from plan → review → publish |
| “We’ll remember what worked” | **Learning rules** — planning boosts and prompt guidance from evidence |
| Copy-paste top performers | **Top-performer mimic** — visual patterns from archived winners, fresh copy |
| Black-box automation | **Human gate** by default after QC; editorial decisions are first-class data |

---

## Core capabilities (product view)

### 1. Structured intake
Upload research (Excel, evidence pipelines, scrapers) → **signal packs** with typed ideas and lineage. No more unstructured “folder of insights.”

### 2. Intelligent planning
**Decision engine** scores candidates, applies caps and suppression, selects prompts and routes — and records **why** (decision traces).

### 3. Controlled generation
Per-brand prompts, output schemas, tenant config, and learning-injected guidance. Generation is **configurable**, not improvised.

### 4. Quality before cost
Automated QC and keyword risk scanning run **before** carousel renders and video jobs — protecting budget and brand safety.

### 5. Media production
Carousels (Handlebars + Puppeteer), HeyGen/Sora video paths, ffmpeg stitch/mux — assets land in storage with stable IDs.

### 6. Human review & rework
Review app for operators: approve, reject, needs edit. Rework orchestration regenerates what changed without corrupting lineage.

### 7. Publishing intent
**Publication placements** record what to post, when, and outcomes — with optional Meta Graph execution or external workers (n8n, manual).

### 8. Learning loop
Performance metrics, editorial analysis, and LLM post-approval reviews feed **learning rules** that improve future planning and prompts.

### 9. Top-performer mimic (optional)
Ingest high-performing creative, analyze visuals, recreate **look-and-feel** with new copy — carousel and single-image flows.

---

## End-to-end story (60 seconds)

```text
Research in  →  Signal pack  →  Plan jobs  →  Generate copy  →  QC
     →  Render media  →  Human review  →  Publish  →  Measure  →  Learn  →  (next run)
```

Every step is **data in Postgres** and **HTTP APIs** — auditable, replayable, and integrable.

---

## Business outcomes

- **Throughput** — Run many jobs per cycle with caps, not chaos.
- **Consistency** — Same brand voice, schemas, and QC every time.
- **Cost control** — Block bad copy before video/image spend.
- **Compliance posture** — Risk policies, banned words, honest QC status reporting.
- **Institutional memory** — Learning rules and run context snapshots document what was used to generate content.
- **Speed to iterate** — Rework paths and prompt labs without rebuilding pipelines from scratch.

---

## Deployment model

- **Self-hosted or cloud** — Core on Fly.io (or similar); Review on Vercel; media workers as separate services.
- **Bring your own keys** — OpenAI, HeyGen, BFL, Supabase, Meta — CAF orchestrates; you own credentials.
- **Multi-brand** — Projects (`SNS`, `Cuisina`, …) share platform code, isolate config and queues.

---

## Honest maturity note

CAF is a **real production platform**, not a demo. Some flow types are fully wired (carousel, several video paths, mimic when enabled). Others are registered for future work (certain image product flows). The pitch is the **architecture and operating model** — individual flow maturity is documented in engineering guides.

---

## Next steps for evaluators

| Goal | Read next |
|------|-----------|
| Full product walkthrough | **[CAF_COMPLETE_PRODUCT_GUIDE.md](./CAF_COMPLETE_PRODUCT_GUIDE.md)** |
| Technical architecture | **[ARCHITECTURE.md](./ARCHITECTURE.md)** or **[CAF_CORE_COMPLETE_GUIDE.md](./CAF_CORE_COMPLETE_GUIDE.md)** |
| Stakeholder summary | **[PROJECT_OVERVIEW.md](./PROJECT_OVERVIEW.md)** |
| Bootstrap a stack | **[REBUILD_FROM_DOCS.md](./REBUILD_FROM_DOCS.md)** |

---

*CAF — Content Automation Framework. Pipeline truth in Postgres; humans stay in the loop; learning compounds over time.*
