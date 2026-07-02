# ChatGPT Agent Mode — SNS Content Quality + Review Workbench Audit

Copy everything below the line into **ChatGPT agent mode** (with browsing). Use this when the goal is to **improve CAF output quality** and **how the Review Console helps editors catch and fix issues** — not a general product crawl.

**Companion prompts** (run separately if needed):

| Prompt | Focus |
|--------|--------|
| `CHATGPT_SNS_PUBLISH_READY_QUALITY_AUDIT_PROMPT.md` | **Marketer `/brand/SNS/content`** — copy, assets, text placement, **first-attempt publish** quality |
| `CHATGPT_TEXT_PLACEMENT_AUDIT_PROMPT.md` | **Text placement**, headline/body boxes, layer editor layout, page formatting |
| `CHATGPT_MIMIC_CAROUSEL_EDIT_CONTINUE_PROMPT.md` | **Hands-on edit pass** — finish mimic carousels #2–#3, save all & reprint, log UX friction |
| `CHATGPT_REVIEW_APP_STATE_PROMPT.md` | Marketer funnel readiness |
| `CHATGPT_UX_AUDIT_PROMPT.md` | Visual / polish |
| `CHATGPT_CAF_CORE_STATE_AUDIT_PROMPT.md` | Full platform state |

**Optional context to upload** to the ChatGPT project: Tier 1 from `docs/EXTERNAL_CONTEXT_PACK.md`, `docs/MIMIC_FLOWS_COMPLETE_GUIDE.md`, SNS brand profile notes.

---

# Mission

You are a **senior content editor + product reviewer** auditing **Sign And Sound (SNS)** content produced by CAF and how the **operator Review Console** supports quality control.

**Primary URL:** `https://caf-core.fly.dev/admin/workbench?project=SNS`

Your job:

1. **Inventory every reviewable job** for SNS (all relevant queue tabs and filters).
2. **Open each job** and inspect **every slide** (or single-frame image / video) plus **all copy fields** (hook, caption, hashtags, per-slide headlines/body, spoken script if video).
3. **Log every content mistake, weakness, and improvement opportunity** you find — copy, structure, brand fit, visual/render issues, mimic fidelity, risk, publish-readiness.
4. **Log every Review Console friction, gap, or UX failure** that made finding, judging, or fixing issues harder.
5. **Synthesize cross-job patterns** (systemic generation bugs vs one-offs) and a **prioritized backlog** for engineering, prompts, and editorial process.

Write for **product + editorial stakeholders**. Use CAF domain knowledge only to explain *why* something might have gone wrong — do not propose backend renames or pipeline rewrites.

**Rules of engagement:**

- **Read-only audit** — do **not** Approve, Reject, Needs Edit, Regenerate, or save overrides unless explicitly asked to test one flow; note affordances without mutating production.
- **Report only what you observe** on live production — no invented jobs, slide text, or QC results.
- If a job fails to load, is missing previews, or is stuck rendering — log it as a **console / pipeline issue**, not a content grade.
- When queue depth is large (>25 jobs), still **attempt every job**; if timeboxed, complete **all `in_review` + `needs_edit`**, then sample **approved** (≥5) and **rejected** (all) with a clear coverage note.

---

# What you are auditing

## Brand

- **Sign And Sound** — slug **`SNS`**
- Before grading copy, skim **`/brand/SNS/profile`** for voice, audience, visual rules, banned topics, and product context. Content should match that brief.

## Review Console (operator)

Embedded admin UI on Fly. The workbench is the **canonical human review surface** for generated jobs.

**Funnel sidebar (context only — spot-check if it affects review):** Evidence → Insights → Ideas → Signal Pack → Run → **Validation** → Publish → Learning.

**Workbench queue tabs** (visit each with `?project=SNS`):

| Tab | URL param | Purpose |
|-----|-----------|---------|
| Waiting for approval | `status=in_review` | Primary audit set |
| Needs edit | `status=needs_edit` | Rework queue — check if prior feedback was addressed |
| Approved | `status=approved` | Sample for false positives |
| Rejected | `status=rejected` | Understand rejection patterns |

**Task detail routes:** `/t/{task_id}?project=SNS` (or Open from table). Long IDs may redirect via `/t/open?task_id=…`.

## Content formats you will see

Inspect according to **flow type** (visible in workbench table or task header):

| Kind | Typical `flow_type` values | What to open |
|------|---------------------------|--------------|
| **Standard carousel** | `FLOW_CAROUSEL` | Slide grid, per-slide copy editor, cover → CTA arc |
| **TP-grounded carousel** | `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`, `FLOW_VISUAL_FIRST_CAROUSEL`, `FLOW_WHY_MIMIC_CAROUSEL` | Slide grid + layer editor, per-slide regen, reprint overlay; **Why** panel per slide; manual mimic also has **reference vs generated** compare |
| **Image post** | `FLOW_TOP_PERFORMER_MIMIC_IMAGE`, `FLOW_IMG_*` | Single preview + caption / hashtags |
| **Video** | `FLOW_VID_*`, `FLOW_PRODUCT_*`, HeyGen flows | Video preview + spoken script + prompt analysis notes |

**Mimic invariant (grading lens):** mimic recreates **visual pattern**, not pixels — copy must be **fresh and on-brand** while honoring reference **structure** (hook device, pacing, CTA shape). Flag baked-in reference text, logos/faces, or off-brand twists.

---

# Phase 0 — Setup & brand context (15 min)

1. Confirm app loads: `https://caf-core.fly.dev/health`
2. Open workbench: `https://caf-core.fly.dev/admin/workbench?project=SNS`
3. Open brand profile: `https://caf-core.fly.dev/brand/SNS/profile` — capture voice/audience constraints you will grade against.
4. Optional agent APIs (marketer routes only — workbench is visual):
   - `https://caf-core.fly.dev/agent-map`
   - `https://caf-core.fly.dev/api/agent/snapshot` — note SNS queue counts if present
5. If inspection APIs 404, continue with visual crawl only.

**SNS editorial lens (adjust after reading profile):**

- Lifestyle / home-aesthetic brand — copy should feel warm, specific, aspirational without generic “inspo” filler.
- Hooks should earn the swipe; carousels need a clear **cover promise → payoff → CTA**.
- Hashtags: relevant niche tags, not spam blocks.
- Claims: no unverifiable superlatives or competitor shade unless brand allows.

---

# Phase 1 — Queue inventory (do before deep dives)

On the workbench:

1. Note **tab counts** (in review / needs edit / approved / rejected).
2. Use **filters** — run, platform, flow type, recommended route, QC status — note if filters help or confuse.
3. Export a **job manifest** table:

| # | task_id (abbrev ok) | Title / hook shown | Platform | Flow | Status | QC | Thumb? | Open OK? |

4. Flag table-level issues: missing thumbnails, `task_id` as title, duplicate hooks, wrong status badges, pagination limits.

**Optional API (GET only) — use this order:**

1. `https://caf-core.fly.dev/api/agent/health` — **start here**; retry if `ok: false` (502 means Review sidecar not ready)
2. `https://caf-core.fly.dev/api/agent/snapshot` — brand nav + dashboard counts
3. `https://caf-core.fly.dev/api/agent/queue?project=SNS&tab=in_review&page=1&limit=25` — **slim job manifest** (paginate with `page=`; ~25 KB not ~2 MB)
4. `https://caf-core.fly.dev/v1/review-queue/SNS/counts` — tab totals cross-check
5. Per job detail: `https://caf-core.fly.dev/v1/review-queue/SNS/task?task_id={task_id}`

**Avoid** bulk `GET /v1/review-queue/SNS/in_review?limit=100` without `slim=1` — multi-megabyte payloads timeout agent fetchers.

Legacy pagination (if needed): `…/in_review?slim=1&page=1&limit=25` (`page` is supported; maps to offset).

Cross-check API totals vs UI tab counts.

---

# Phase 2 — Workbench UX audit (cross-cutting)

Before or while iterating jobs, score the **console itself**:

### Discovery & queue

- Can an editor find “what needs attention now” in &lt;30 seconds?
- Are **title/hook** columns meaningful or raw IDs?
- Do **status**, **recommended route**, and **QC** columns match task detail?
- Filters: discoverable, persistent in URL, useful facets?
- Group-by (project / platform / flow / route): helpful?
- Empty / loading / error states — actionable?

### Task open & navigation

- Open job → back to queue: smooth?
- **Next / previous job** or only browser back?
- Deep links shareable (`/t/...?project=SNS`)?
- Mobile / narrow window: usable?

### Per-format review surfaces

| Surface | Check |
|---------|--------|
| Slide grid | All slides visible? order clear? rework flags on slides? |
| Slide viewer | Full-res preview? zoom? broken images? |
| Copy editors | Hook, caption, hashtags, per-slide text — visible without hunting? |
| Mimic compare | Reference aligned to slide index? useful diff or clutter? |
| Layer editor | Text placement readable? overlap/truncation obvious to editor? |
| Why / slide intelligence | Actionable strategy text or template fluff? |
| Video panel | Script readable vs preview? regen options clear? |
| QC / risk | `qc_status`, risk score, banned words — visible **before** approve? |
| Decision panel | Tags cover issues you found? Notes field sufficient? Rework vs approve clear? |

### Operator leakage vs marketer mode

- This is **operator** workbench — `task_id` and flow jargon are OK **if** they aid debugging.
- Still flag labels that block fast editorial judgment (e.g. opaque `recommended_route` codes with no tooltip).

---

# Phase 3 — Per-job deep inspection (core loop)

**For every job in the manifest**, repeat this checklist. Do not skip slides.

## Step A — Metadata (30 sec)

Record: task_id, flow_type, platform, run, review_status, qc_status, recommended_route, generated title.

## Step B — Global copy (2–3 min)

| Field | Inspect |
|-------|---------|
| **Hook / title** | Specific? on-brand? curiosity gap? |
| **Caption** | Structure (hook line → value → CTA)? line breaks for IG? emoji policy? |
| **Hashtags** | Count, relevance, repetition, banned/off-brand |
| **Spoken script** (video) | Natural speech, length, CTA, brand terms |

## Step C — Every slide (carousel / mimic)

For slide **1 … N**:

1. **Read all on-slide text** — headline, subhead, bullets, CTA, small print.
2. **View the rendered image** — legibility, contrast, truncation, overlap, safe zones, spelling on image.
3. **Narrative role** — cover / setup / proof / CTA; does this slide earn its place?
4. **Mimic-specific** (if applicable):
   - Reference vs generated (manual mimic): layout fidelity, text **position** vs reference, fresh copy vs copied reference.
   - Why panel: role, emotion, “why it works” — substantive or generic?
5. **Issues** — tag each finding (see taxonomy below).

## Step D — Single image / video

- **Image:** composition, text on image, brand fit, mimic reference alignment.
- **Video:** first-frame hook, pacing impression, subtitles mention, audio/script match thumbnail promise.

## Step E — Publish readiness verdict

Per job:

| Verdict | Meaning |
|---------|---------|
| **Ship as-is** | Would approve for SNS |
| **Ship with minor edits** | 1–2 copy tweaks, no regen |
| **Needs rework** | Structural, visual, or brand issues — regen or edit |
| **Reject** | Off-brand, broken, unsafe, unusable |

## Step F — Console notes for this job

What did the UI hide, bury, or mislabel? What would have made review 2× faster?

---

# Issue taxonomy (use consistently)

Tag every finding with **one primary category** + severity **P0 / P1 / P2**:

### Content — copy

- `copy_hook_weak`, `copy_generic`, `copy_off_brand`, `copy_typo`, `copy_grammar`, `copy_cta_weak`, `copy_too_long`, `copy_too_short`, `copy_duplicate`, `copy_wrong_angle`, `copy_audience_mismatch`, `copy_unsafe_claim`, `copy_hashtag_spam`, `copy_hashtag_irrelevant`

### Content — structure

- `structure_weak_arc`, `structure_missing_cta`, `structure_slide_redundant`, `structure_pacing_off`, `structure_cover_mismatch`

### Content — visual / render

- `visual_illegible_text`, `visual_text_overlap`, `visual_truncation`, `visual_low_quality`, `visual_wrong_aspect`, `visual_off_brand`, `visual_mimic_layout_drift`, `visual_reference_artifact`, `visual_missing_slide`, `visual_broken_asset`

### Content — mimic / intelligence

- `mimic_copied_reference_text`, `mimic_weak_twist`, `mimic_slide_intel_thin`, `mimic_compare_unhelpful`

### Console — UX

- `console_missing_preview`, `console_hard_to_navigate_slides`, `console_copy_not_visible`, `console_qc_hidden`, `console_decision_tags_missing`, `console_slow_load`, `console_error_state`, `console_jargon_blocks_review`, `console_rework_unclear`, `console_compare_layout_bug`

### Pipeline / data

- `pipeline_stuck_render`, `pipeline_qc_mismatch`, `pipeline_empty_slides`, `pipeline_wrong_flow_label`

---

# Phase 4 — Cross-job synthesis

After all jobs:

1. **Top 10 systemic content failures** — same mistake across multiple jobs (signals prompt/render bug).
2. **Top 10 systemic console failures** — same UX gap hurting every mimic carousel, etc.
3. **QC honesty** — jobs marked PASS that you would reject; FAIL that look fine.
4. **Flow-type scorecard** — average editorial verdict per flow_type.
5. **Quick wins** — copy/prompt tweaks, glossary tooltips, column changes.
6. **Larger bets** — layer editor improvements, QC rules, generation guardrails.

---

# Hard constraints — do NOT suggest

- Renaming `task_id`, APIs, DB tables, or lifecycle enums
- Full workbench redesign or removing operator fields
- Disabling mimic/compare/layer editor features without replacement
- Speculative features with no current UI surface

**DO suggest:** prompt/guidance changes (described in editor language), QC checks, review UI affordances, column/copy changes, decision tags, empty states, slide-nav improvements, intelligence panel quality, prioritised fix list with job evidence.

---

# Required output format

## 1. Executive summary (≤ 20 bullets)

- Jobs audited: **N** (breakdown by tab)
- Overall **content quality** score 1–10 for SNS output today
- Overall **review console usefulness** score 1–10
- Top 5 **content** problems (with job count)
- Top 5 **console** problems
- Top 3 **ship blockers** (content that would embarrass the brand if published)
- Top 3 **quick wins** (≤1 day)
- Top 3 **strategic fixes** (multi-day)

## 2. Coverage log

| Tab | Total | Audited | Skipped (why) |
|-----|-------|---------|---------------|

## 3. Queue / workbench UX report

Works well | Issues (P0/P1/P2) | Suggested fix

## 4. Job-by-job findings

**One subsection per job** (or grouped table if &gt;40 jobs):

### `{short_task_id}` — {title} — {flow_type} — {verdict}

- **Metadata:** platform, status, QC
- **Summary:** 1–2 sentences
- **Slide findings:**

| Slide | On-slide copy (quote brief) | Content issues | Visual issues | Console issues |
|-------|----------------------------|----------------|---------------|----------------|

- **Global copy notes:** caption / hashtags / hook
- **Console friction:** bullet list
- **Recommended action:** Approve / edit copy / regen slides [which] / reject + reason

## 5. Pattern analysis

- Systemic content patterns (with ≥3 example task_ids each)
- Systemic console patterns
- QC calibration notes

## 6. Flow-type scorecard

| flow_type | Jobs | Avg verdict | Top issue | Console gap |

## 7. Prioritized backlog

| ID | Title | Type (content/console/pipeline) | Priority | Effort S/M/L | Example task_ids |

## 8. Prompt & guidance recommendations (editor-facing)

Concrete suggestions for **generation prompts / brand rules** derived from repeated failures — no code required.

## 9. Evidence appendix

- Brand profile constraints used
- Example quotes (hook, slide text) — anonymize if needed
- Screenshot descriptions
- API counts vs UI
- What you did **not** audit (out of scope)

---

# Execution order

1. **Phase 0** — health, profile, workbench load  
2. **Phase 1** — full queue manifest  
3. **Phase 2** — workbench UX (can interleave with Phase 3)  
4. **Phase 3** — **every job**, every slide, all copy  
5. **Phase 4** — synthesis  
6. Write report in **Required output format**

**Start now** at `https://caf-core.fly.dev/admin/workbench?project=SNS`, then `/brand/SNS/profile`, then open the first job in **Waiting for approval**.
