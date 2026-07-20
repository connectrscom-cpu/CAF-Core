# Fable 5 — Learning layer review & improvement prompt

**Updated:** 2026-07-16  
**Model:** Claude Fable 5 (planning / critique only — no implementation this turn)  
**Scope:** CAF **learning loop only** (rules, observations, guidance compilation, performance → rules, attribution, Review learning UX). Not mimic, not content routes, not INPUTS scrapers unless learning depends on them.

---

## Before you paste

### Attach (required)

1. `docs/FABLE_IMPROVEMENT_BRIEFING.md` — general invariants + budget rules  
2. `docs/CAF_CURRENT_STATE_CONTEXT_PACK.md` — especially **§13 Learning loop**, maturity matrix, invariants  
3. `docs/layers/learning.md` — learning layer map  
4. `docs/GENERATION_GUIDANCE.md` — planning vs generation split  
5. `AGENTS.md` — facade / attribution / snapshot invariants  

### Attach (strongly recommended)

6. `docs/RISK_RULES.md` — so you do **not** confuse learning with QC risk  
7. `src/services/learning-rule-selection.ts` — the mandatory facade (short file)  

### Optional (only if you want deeper critique)

- `src/services/learning-context-compiler.ts`
- `src/services/approved-content-llm-review.ts` (or notes in `layers/learning.md` on post-approval review)
- `src/domain/upstream-recommendations.ts`
- `src/services/run-context-snapshot.ts`
- `docs/QUALITY_CHECKS.md` (boundary: QC ≠ learning)

**Do not attach:** whole `src/`, mimic docs, full inputs roadmap, or “improve all of CAF” bundles.

---

## Prompt (copy everything below this line)

```text
You are reviewing and improving the LEARNING LAYER of CAF (Content Automation Framework).

I have attached the learning-focused docs (and AGENTS.md / current-state pack). Use them as authority. Prefer docs/layers/learning.md, docs/GENERATION_GUIDANCE.md, and CAF_CURRENT_STATE_CONTEXT_PACK.md §13 over older merged guides when they conflict.

=== WHAT “LEARNING” MEANS IN CAF ===

Learning is NOT QC and NOT risk keyword enforcement.
Learning is the loop that turns outcomes into structured behavior change:

  editorial / metrics / LLM approval review
    → observations / hypotheses / insights
    → learning_rules (activated, scoped)
    → applied at PLANNING (scoring/suppression) and/or GENERATION (prompt guidance)
    → attribution + run context snapshots so we can audit what was used

Two mental models (must stay distinct):

1) PLANNING — getLearningRulesForPlanning() → ranking/suppression only
   (BOOST_RANK, SCORE_BOOST, SCORE_PENALTY) → decideGenerationPlan
2) GENERATION — getLearningContextForGeneration() → compileLearningContexts
   → prompt text (GUIDANCE / HINT / generation family)

Mandatory facade: src/services/learning-rule-selection.ts
Do not propose new call sites that import listActiveAppliedLearningRules or compileLearningContexts directly.

Also in scope:
- learning_observations, hypotheses, insights
- learning_generation_attribution
- job_outcomes (publish → metrics → analyzed)
- post-approval LLM review + upstream_recommendations (parseUpstreamRecommendations + insertLlmApprovalReview + per-item learning_observation)
- run context snapshots (setRunContextSnapshot; failures must never abort runs)
- Review /learning UI and learning HTTP routes (src/routes/learning.ts)
- editorial-analysis cron / market-learning (optional automation)
- caf-global observatory / digests — observations OK; global RULES currently disabled at HTTP + compiler — treat as intentional unless you argue for a careful re-enable plan

Honest known gaps (from current-state / layer docs — re-validate, don’t invent new “missing” systems):
- Global learning rules disabled (compiler / HTTP)
- Project risk_rules are NOT learning and are NOT QC-enforced (different subsystem)
- Auto-create rules from performance analysis defaults false
- Learning is not automatic quality — rules must be activated and scoped
- Marketer funnel vs operator /learning surfaces may be uneven

=== HARD RULES (do not violate in recommendations) ===

- Never rename task_id / run_id / lifecycle enums without explicit human approval
- Never write qc_result except via mergeGenerationPayloadQc (QC is out of scope except as a boundary)
- Never bypass learning-rule-selection.ts facade
- Upstream recommendations writers must use parseUpstreamRecommendations + insertLlmApprovalReview; each item → learning_observation
- Run context snapshot failures: log only, never abort run
- Do not conflate risk_policies / risk_rules / learning_rules
- Do not propose greenfield “ML platform” rewrites or new microservices
- Prefer closing the loop with existing tables/APIs over new parallel learning stores

=== YOUR JOB THIS TURN ===

Review the learning layer and produce a RANKED improvement roadmap for LEARNING ONLY.

Optimize for:
1) Closed loop that operators can trust (rule created → activated → visibly affects plan or prompt → attributable)
2) Time-to-useful-learning after publish / approval (not more dashboards for their own sake)
3) Honesty (don’t imply global rules or risk_rules do things they don’t)
4) Cost control (LLM review / cron spend vs value)

Do NOT write code.
Do NOT expand scope into mimic, content routes, scrapers, or Review carousel UX except where learning depends on them (name the dependency explicitly).
When unsure, say “verify in source” and give likely paths from the attached docs.

=== REQUIRED OUTPUT FORMAT ===

1. Verdict (3–5 sentences): health of CAF learning today — what works, what’s broken/half-wired, biggest leverage.

2. Architecture critique (bullets): strengths + failure modes of the two-path model (planning vs generation), facade, attribution, job_outcomes, upstream recommendations, global-disabled stance.

3. Top 7 learning workstreams as a table:

| Rank | Workstream | Operator-visible outcome | Likely files/APIs | Risk to invariants | Size S/M/L | Done when |

4. Explicit non-goals this quarter (learning-specific) — 3–5 bullets.

5. Honesty / product-copy risks — places where UI/docs might over-claim learning (e.g. global rules, auto rules, risk_rules).

6. Verification list — exact files/endpoints/tables to inspect in source before implementing #1–#3.

7. Next single builder prompt — copy-paste prompt for workstream #1 ONLY (acceptance criteria, files to touch, files not to touch, tests to add/update).

8. Questions for me (max 5) — only if ranking depends on product priority (e.g. “auto-create rules from performance” vs “better Review transparency” vs “re-enable global rules”).

Start now from the attached materials only.
```

---

## After Fable answers

1. Keep implementation in a **separate** cheaper-model chat using Fable’s builder prompt #1.  
2. Touch learning only through `learning-rule-selection.ts` for lookups.  
3. Update `docs/layers/learning.md` + current-state §13 if behavior changes.  
4. Optional second Fable pass: paste a short summary of the PR diff for review (not the whole repo).

---

## Related

| Doc | Role |
|-----|------|
| `docs/FABLE_5_PROMPT.md` | Whole-product roadmap prompt |
| `docs/FABLE_IMPROVEMENT_BRIEFING.md` | General Bundle A + themes |
| `docs/layers/learning.md` | Learning layer map |
| `docs/GENERATION_GUIDANCE.md` | Prompt guidance path |
