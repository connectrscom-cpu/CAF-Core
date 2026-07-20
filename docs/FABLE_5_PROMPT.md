# Fable 5 — ready-to-paste prompt

**Updated:** 2026-07-16  
**Model:** Claude Fable 5 (planning only — no implementation this turn)

---

## Before you paste

Attach these files to the chat / project (nothing else unless noted):

1. `docs/FABLE_IMPROVEMENT_BRIEFING.md`
2. `docs/CAF_CURRENT_STATE_CONTEXT_PACK.md`
3. `AGENTS.md`
4. `docs/EXTERNAL_CONTEXT_PACK.md`

Optional (if you have filled dogfood notes or care about setup):

- `docs/CAF_DOGFOOD_NOTES.md`
- `docs/CONTENT_ROUTES.md`
- `docs/PROJECT_SETUP_CHECKLIST.md`

Do **not** attach the whole `src/` tree, `node_modules`, or every PDF.

---

## Prompt (copy everything below this line)

```text
You are advising on CAF (Content Automation Framework) — a Fastify + PostgreSQL content operations platform.

I have attached:
- docs/FABLE_IMPROVEMENT_BRIEFING.md
- docs/CAF_CURRENT_STATE_CONTEXT_PACK.md (authority for current state as of 2026-07-16)
- AGENTS.md
- docs/EXTERNAL_CONTEXT_PACK.md
(and any optional setup/dogfood docs I also attached)

=== CONTEXT ===

Funnel:
Inputs/evidence → signal pack → candidates → decision engine → content jobs
  → LLM drafts → QC/risk → render → human review → publish → learning

Source of truth: Postgres schema caf_core, especially content_jobs.generation_payload.
Review app (apps/review) is a client, not the DB of record.
Primary execution key: (project_id, task_id).

CAF is already a mid-size product (~165k LOC Core + ~59k LOC Review). Do not propose growing code for its own sake. Seriousness = operator trust and time-to-value, not LOC.

Already present (do not rediscover as missing — maturity varies; see current-state pack §17):
- Full pipeline loop (plan → generate → QC → render → review → publish → learn)
- Carousels (standard, mimic, new visual, Why Mimic) + BVS
- HeyGen video lanes + product videos + hook-first
- Content routes (lanes ↔ flows ↔ idea quotas)
- Text flows: LinkedIn text/document, Reddit, Instagram thread
- UGC video (FLOW_VID_UGC)
- Project setup / onboarding packs + marketer funnel in Review
- Inputs/scrapers including LinkedIn discovery; research brief platform packs; subject-relevance guards

Hard rules — never propose without explicit human approval:
- Renaming task_id / run_id patterns or lifecycle status enums
- Writing qc_result except via mergeGenerationPayloadQc
- HeyGen retries that ignore hasActiveProviderSession
- Bypassing learning-rule-selection.ts facade
- Treating project risk_rules as QC-enforced (they are not)
- Conflating carousel_package with mimic_carousel_package
- Treating FLOW_VISUAL_FIRST_CAROUSEL as top-performer frame replication
- Baking mimic carousel copy into Flux at render (overlay-only)
- Rewriting CAF as microservices / greenfield

=== YOUR JOB THIS TURN ===

Produce a RANKED improvement roadmap only.
- Do NOT write code
- Do NOT invent APIs that contradict the attached docs
- Prefer outcomes that increase: (1) operator trust, (2) time-to-first-publish for a new brand, (3) cost control
- Prefer small, reviewable workstreams over “rewrite the platform”
- When unsure whether something exists, say “verify in source” and name likely paths from the current-state pack
- Re-rank themes from FABLE_IMPROVEMENT_BRIEFING.md using evidence in the current-state pack (and dogfood notes if attached)

Optimization priority for this roadmap:
A marketer can take a new brand from onboarding pack → enable content routes → research → ideas → cart → generated jobs → review with minimal admin HTML escape. Prefer reliability and clarity over new formats.

=== REQUIRED OUTPUT FORMAT ===

1. Verdict (2–4 sentences): biggest leverage for CAF right now.

2. Top 7 workstreams as a table:

| Rank | Workstream | Outcome (user-visible) | Likely areas (paths from docs) | Risk to invariants | Size S/M/L | Done when |

3. Explicit non-goals this quarter (3–5 bullets) — what NOT to build.

4. Verification list — files/APIs to confirm in source before implementing.

5. Next single builder prompt — one copy-paste prompt for workstream #1 only (scoped, acceptance criteria, files to touch, what not to touch).

6. Questions for me (max 5) only if ranking depends on brand priority (e.g. Cuisina dogfood vs LinkedIn-first).

Start now from the attached docs only.
```

---

## After Fable answers

1. Pick workstream #1 (or adjust ranking).
2. Open a **new** chat with a cheaper/builder model.
3. Paste Fable’s “Next single builder prompt” + only the 3–15 source files it names.
4. Optionally return to Fable later with a short diff summary for review — not the whole repo.

---

## Topic-specific prompts

| Focus | File |
|-------|------|
| Whole CAF roadmap | `docs/FABLE_5_PROMPT.md` (this file) |
| **Learning layer only** | `docs/FABLE_5_LEARNING_PROMPT.md` |
