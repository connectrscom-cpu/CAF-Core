# CAF — Fable / high-end model improvement briefing

**Audience:** Claude Fable 5 (or any expensive planning model)  
**Updated:** 2026-07-16  
**Goal:** Suggest **clear, ranked improvements** for CAF without re-reading the whole monorepo or burning the budget in one turn.

---

## How to use (budget-safe)

1. Attach **only** the files in **Bundle A** below (not the entire `src/` tree).
2. Paste the **system prompt** in this file.
3. Ask for a **roadmap only** (no implementation in the same turn).
4. Later: one builder chat per workstream; optional short Fable review of the diff.

Do **not** ask Fable to “improve all of CAF” while attaching hundreds of source files.

---

## Bundle A — always attach (planning)

| Priority | File | Why |
|----------|------|-----|
| 1 | **`docs/FABLE_IMPROVEMENT_BRIEFING.md`** (this file) | Scope, constraints, output format |
| 2 | **`docs/CAF_CURRENT_STATE_CONTEXT_PACK.md`** | Repo-derived operational truth |
| 3 | **`AGENTS.md`** | Non-negotiable invariants |
| 4 | **`docs/EXTERNAL_CONTEXT_PACK.md`** | Doc index + system rules |

Optional if the question is product/onboarding-shaped:

| File | Why |
|------|-----|
| `docs/CONTENT_ROUTES.md` | Marketer lanes ↔ flows ↔ idea buckets |
| `docs/PROJECT_SETUP_CHECKLIST.md` | Brand onboarding pack contract |
| `docs/CAF_DOGFOOD_NOTES.md` | Real operator friction (fill while dogfooding) |
| `docs/CAF_PRODUCT_PITCH.md` | Positioning / buyer narrative |

Optional if the question is mimic/BVS-shaped: `docs/MIMIC_FLOWS_COMPLETE_GUIDE.md` (prefer current-state pack on conflicts).

**Do not attach by default:** full `src/`, `node_modules/`, PDF dumps of everything, lockfiles, raw migration history beyond “migrations through 082”.

---

## System prompt (copy into the Fable chat)

```text
You are advising on CAF (Content Automation Framework) — a Fastify + PostgreSQL content operations platform.

Funnel:
Inputs/evidence → signal pack → candidates → decision engine → content jobs
  → LLM drafts → QC/risk → render → human review → publish → learning

Source of truth: Postgres schema caf_core, especially content_jobs.generation_payload.
Review app (apps/review) is a client, not the DB of record.
Primary execution key: (project_id, task_id).

Hard rules — never propose without explicit human approval:
- Renaming task_id / run_id patterns or lifecycle status enums
- Writing qc_result except via mergeGenerationPayloadQc
- HeyGen retries that ignore hasActiveProviderSession
- Bypassing learning-rule-selection.ts facade
- Treating project risk_rules as QC-enforced (they are not)
- Conflating carousel_package with mimic_carousel_package
- Treating FLOW_VISUAL_FIRST_CAROUSEL as top-performer frame replication
- Baking mimic carousel copy into Flux at render (overlay-only)

Your job this turn: produce a RANKED improvement roadmap only.
Do not write code. Do not invent APIs that contradict the attached docs.
Prefer outcomes that increase operator trust, time-to-first-publish, or cost control.
Prefer small, reviewable workstreams over “rewrite the platform.”
When unsure whether something exists, say “verify in source” and name likely paths from the current-state pack.
```

---

## What CAF already has (do not “discover” as missing)

Treat these as **present** (maturity varies — see current-state pack §17):

- Full run → job → draft → QC → render → review → publish → learning loop
- Standard carousel, HeyGen video lanes, product video flows
- Mimic / new visual / Why Mimic carousels + Brand Visual System (BVS)
- Inputs → insights → signal pack (Apify scrapers, LinkedIn discovery/transforms)
- **Content routes** (marketer lanes ↔ `allowed_flow_types` ↔ idea quotas) — `src/domain/content-routes.ts`
- **Text content flows:** `FLOW_LINKEDIN_TEXT_POST`, `FLOW_LINKEDIN_DOCUMENT_POST`, `FLOW_REDDIT_POST`, `FLOW_INSTAGRAM_THREAD` (migration 081)
- **UGC video:** `FLOW_VID_UGC` (migration 082)
- **Project setup / onboarding packs** + Review public `/setup/*` checklists
- Marketer funnel in Review: workspace, brand profile, research, ideas, content cart, publishing, performance
- Research brief platform packs / pipeline UI (newer)
- Pre-LLM subject relevance guards (newer)

Scale (tracked code, ~2026-07-16): Core `src`+migrations+services+scripts ≈ **165k** LOC; Review `apps/review` ≈ **59k** LOC; migrations through **082**.

---

## Honest improvement surfaces (start here)

Use these as candidate themes — re-rank with evidence from the attached pack and any dogfood notes.

### A. Operator trust & reliability
- Failed / stuck renders (HeyGen, mimic image gate, video assembly)
- Clearer job failure reasons in Review vs admin-only logs
- Recovery paths for interrupted workers (`hasActiveProviderSession`, scraper recover)

### B. Time-to-value (new brand → first publish)
- Onboarding pack gaps → fewer `[GAP]` fields and clearer import errors
- Content routes defaults vs empty idea quotas
- Marketer funnel completeness vs escaping to admin HTML

### C. Research → ideas quality
- LinkedIn targeting profile + discovery cost/relevance
- Subject-relevance / content-subject guards vs over-filtering
- Research brief platform packs consistency across Instagram / LinkedIn / Reddit
- Stage-3 structured idea picker (still partial)

### D. Format completeness vs polish
- Text lanes (LinkedIn / Reddit / IG thread): generation quality, Review UX, publish path
- UGC video: host pool from brand/product bible, HeyGen script-led path
- Product image flows (`FLOW_IMG_*`) still blocked at LLM — ship or hide

### E. Learning & QC honesty
- Project `risk_rules` not QC-enforced — either wire or stop implying they are
- Global learning rules disabled in compiler
- Close the loop: performance → rules that change planning/generation

### F. Cost & complexity control
- Apify / LLM spend visibility and caps
- Disable unused routes so ideas/cart don’t offer dead lanes
- Avoid new microservices; prefer tightening the existing funnel

### G. Docs / agent UX (meta)
- Keep `CAF_CURRENT_STATE_CONTEXT_PACK.md` dated and authoritative
- Prefer outcomes in dogfood notes over speculative features

---

## Required output format

Return markdown with:

1. **Verdict** (2–4 sentences): biggest leverage for CAF *right now*.
2. **Top 7 workstreams** as a table:

| Rank | Workstream | Outcome (user-visible) | Likely areas | Risk to invariants | Size S/M/L | Done when |
|------|------------|------------------------|--------------|--------------------|------------|-----------|

3. **Explicit non-goals** this quarter (3–5 bullets) — what *not* to build.
4. **Verification list** — files/APIs to confirm in source before implementing (paths from current-state pack).
5. **Next single prompt** — one copy-paste builder prompt for workstream #1 only (scoped, acceptance criteria, files to touch).

Optional: **questions for the human** (max 5) if a ranking depends on brand priority (e.g. Cuisina dogfood vs LinkedIn-first).

---

## Example user ask (paste after attaching Bundle A)

Prefer the full ready-to-paste prompt in **`docs/FABLE_5_PROMPT.md`**.

Short variant:

```text
Using only the attached CAF docs, produce the ranked improvement roadmap
in the required format. Optimize for: a marketer can take a new brand from
onboarding pack → research → ideas → cart → generated jobs → review
with minimal admin escape. Prefer reliability and clarity over new formats.
```

---

## Related

| Doc | Role |
|-----|------|
| `docs/FABLE_5_PROMPT.md` | Whole-product Fable roadmap prompt |
| `docs/FABLE_5_LEARNING_PROMPT.md` | **Learning-layer** Fable review + improvement prompt |
| `docs/CAF_CURRENT_STATE_CONTEXT_PACK.md` | Full operational map |
| `docs/EXTERNAL_CONTEXT_PACK.md` | Tiered upload guide |
| `docs/CURSOR_DOC_RECONCILIATION_PROMPT.md` | Keep docs aligned with repo |
| `docs/CAF_DOGFOOD_NOTES.md` | Operator friction log |
| `AGENTS.md` | Coding invariants |

When prose conflicts with `migrations/` or `src/`, **source wins**.
