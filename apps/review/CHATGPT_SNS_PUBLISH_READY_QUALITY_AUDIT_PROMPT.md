# ChatGPT Agent Mode — SNS Publish-Ready Content Quality Audit

Copy everything below the line into **ChatGPT agent mode** (with browsing).

**Use this prompt when:** you want to **rate whether CAF output is good enough to publish on first attempt** — copy, rendered assets, and on-slide text placement — using the **marketer Content workspace**, not the operator debug console.

**Primary URL:** `https://caf-core.fly.dev/brand/SNS/content`

**Companion prompts** (different scope):

| Prompt | Focus |
|--------|--------|
| `CHATGPT_CONTENT_QUALITY_WORKBENCH_AUDIT_PROMPT.md` | Operator workbench + console UX |
| `CHATGPT_TEXT_PLACEMENT_AUDIT_PROMPT.md` | Deep layer-editor / layout QA only |
| `CHATGPT_REVIEW_APP_STATE_PROMPT.md` | Full marketer funnel readiness |

**Optional context to upload:** `docs/EXTERNAL_CONTEXT_PACK.md` (Tier 1), `docs/MIMIC_FLOWS_COMPLETE_GUIDE.md`, SNS brand profile exports.

---

# North star

You are a **senior social content editor + creative QA lead** for **Sign And Sound (SNS)**.

Your single question for every draft:

> **If we published this tomorrow with zero human edits, would it meet SNS’s bar and perform — or would it embarrass the brand?**

Optimize findings for **first-attempt publish quality**: what CAF must fix in **generation, rendering, and QC** so marketers approve on pass one instead of rework loops.

**Do not** grade the admin console unless a UI gap **prevents you from judging** copy, assets, or placement.

---

# Rules of engagement

- **Read-only** — do not Approve, Reject, Request edits, Regenerate, or save overrides.
- **Observe production only** — no invented jobs, slide text, or QC results.
- **Marketer mode** — stay on `/brand/SNS/*` routes. Do **not** use `?debug=1` unless a task fails to open in marketer view.
- **Every slide matters** — for carousels, inspect slide 1 through N; do not sample only cover + CTA.
- **Coverage:** audit **all** jobs in **Needs review**; if &gt;25, paginate until complete. Spot-check **Needs edits** (did rework help?) and **Approved** (false positives).
- If previews fail to load, log `asset_broken` and continue with copy fields — do not invent visuals.

---

# What you are rating (three pillars)

| Pillar | What “good” means for first-attempt publish |
|--------|---------------------------------------------|
| **Copy** | Hook earns the swipe; caption is structured and on-brand; hashtags are relevant not spammy; per-slide text is fresh, specific, grammatically clean; video scripts sound spoken not robotic; no reference bleed-through on mimic jobs. |
| **Assets** | Images/video sharp, correct aspect, on-brand mood, no broken URLs, no obvious AI artifacts, faces/logos/watermarks handled correctly; thumbnail matches content promise; carousel arc visually coherent slide-to-slide. |
| **Text placement** | On-slide text readable at phone width (~390px); headline/body hierarchy clear; no truncation, overlap with busy areas, or text in unsafe zones; CTA visible; mimic jobs honor reference **layout** without copying reference **words**. |

**Publish-ready verdicts** (use on every job):

| Verdict | Meaning |
|---------|---------|
| **Publish now** | Would ship as-is |
| **Minor polish** | 1–2 copy tweaks only; no regen |
| **Regen needed** | Visual/placement/structure fix required |
| **Reject** | Off-brand, broken, unsafe, or unusable |

---

# Phase 0 — Boot & brand bar (10 min)

### 0A. Confirm service is up

1. `GET https://caf-core.fly.dev/api/agent/health` — **must return `"ok": true`**. If 502/503, wait 30–60s and retry (Fly sidecar boot).
2. `GET https://caf-core.fly.dev/readyz` — optional cross-check (`review.ok` should be true).

### 0B. Load brand constraints (your grading rubric)

Open and summarize constraints you will enforce:

- `https://caf-core.fly.dev/brand/SNS/profile` — voice, audience, visual rules, banned topics, product context.

Record in your notes: **voice adjectives**, **audience**, **platform priorities**, **must-avoid topics/claims**.

### 0C. Open the content queue

- `https://caf-core.fly.dev/brand/SNS/content` — marketer **Content to review** workspace ([live app](https://caf-core.fly.dev/brand/SNS/content)).

Tabs to use:

| Tab | Filter |
|-----|--------|
| Needs review | primary audit set |
| Needs edits | rework quality |
| Approved | false-positive check |
| Rejected | pattern mining |

### 0D. Build job manifest (API — fast)

Use slim APIs (do **not** bulk-fetch full `generation_payload` lists):

```
GET https://caf-core.fly.dev/api/agent/queue?project=SNS&tab=in_review&page=1&limit=25
```

Paginate with `page=2`, `page=3`, … until `next_page` is null.

Cross-check: `GET https://caf-core.fly.dev/v1/review-queue/SNS/counts`

For each job, note: `task_id`, `flow_type`, `platform`, `generated_hook`, `generated_caption`, `slide_count`, `preview_url`, `qc_status`.

**Per-job full detail** (when you need script/slide JSON):

```
GET https://caf-core.fly.dev/v1/review-queue/SNS/task?task_id={task_id}
```

---

# Phase 1 — Queue-level signals (15 min)

On `/brand/SNS/content`, before opening jobs:

1. **Tab counts** — does “Needs review” match API totals?
2. **Table columns** — can you see meaningful title/hook (not raw `task_id`)?
3. **Thumbnails** — present? representative of asset quality?
4. **Duplicate angles** — same hook/caption pattern across multiple rows?
5. **QC vs your judgment** — anything marked PASS that looks unpublishable from the thumb alone?

Export a manifest table:

| # | task_id (abbrev) | Platform | Format | Hook (short) | Slides | QC | Thumb OK? |
|---|------------------|----------|--------|--------------|--------|----|-----------|

Flag queue-level **first-attempt blockers**: missing previews, duplicate batch outputs, wrong format labels.

---

# Phase 2 — Per-job deep review (core loop)

**Open each job** from the table (click row or use):

- Short IDs: `https://caf-core.fly.dev/content/{task_id}?marketer=1`
- Long IDs: `https://caf-core.fly.dev/content/open?task_id={task_id}&marketer=1`

Repeat for **every job** in the manifest.

## A. Metadata (30 sec)

Record: `task_id`, `flow_type`, platform, run, status, QC, recommended route.

Know the format family:

| Family | Typical flows | Asset focus |
|--------|---------------|-------------|
| Carousel | `FLOW_CAROUSEL`, `FLOW_VISUAL_FIRST_CAROUSEL` | Slide grid, per-slide copy |
| Mimic carousel | `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL`, `FLOW_WHY_MIMIC_CAROUSEL` | Pattern fidelity + fresh copy + placement |
| Image | `FLOW_TOP_PERFORMER_MIMIC_IMAGE`, `FLOW_IMG_*` | Single frame + caption |
| Video | `FLOW_VID_*`, HeyGen flows | Motion, first frame, spoken script |

**Mimic rule:** recreate reference **structure** (hook device, pacing, CTA shape) — **never** reference copy, logos, or faces.

## B. Copy score (1–5 each + notes)

Rate and justify:

| Dimension | 1 (fail) | 5 (excellent) |
|-----------|----------|---------------|
| **Hook / cover promise** | Generic, vague, off-brand | Specific curiosity gap; SNS voice |
| **Caption** | Wall of text / filler | Hook → value → CTA; readable breaks |
| **Hashtags** | Spam / irrelevant | Tight niche set; no repetition |
| **Slide copy** (carousels) | Typos, reference bleed, redundancy | Each slide earns its place |
| **Script** (video) | Unspeakable / off-tone | Natural VO; clear CTA |

Checklist:

- [ ] No typos or grammar errors on publish-facing text
- [ ] No banned topics/claims from brand profile
- [ ] No duplicate hook across jobs in same run (unless intentional series)
- [ ] Emoji policy matches brand (not excessive)
- [ ] CTA clear (save, comment, follow, link intent)
- [ ] Mimic: copy is **fresh** — not OCR/reference text

## C. Asset score (1–5 + notes)

For **each slide** (or single image / video):

| Check | Fail signals |
|-------|--------------|
| **Loads** | Broken image, spinner forever, wrong MIME |
| **Resolution** | Soft, pixelated, cropped awkwardly |
| **Aspect** | Wrong ratio for platform (IG 4:5 / carousel) |
| **Brand fit** | Off-palette, wrong mood, stock-generic |
| **Artifacts** | AI mush, extra fingers, garbled text in image |
| **Coherence** | Slide 3 style unrelated to slide 1 |
| **Video** | First frame ≠ hook; audio/script mismatch |

Quote **what you see** in the asset (1 sentence per slide) — do not paraphrase on-slide text you cannot read.

## D. Text placement score (1–5 + notes)

**Phone-width test:** mentally shrink preview to ~390px wide — would text still read?

Per slide with on-image text:

| Check | Fail signals |
|-------|--------------|
| **Legibility** | Too small, low contrast |
| **Truncation** | Words cut mid-line |
| **Overlap** | Headline on body; text on faces/busy texture |
| **Hierarchy** | Body louder than headline; CTA buried |
| **Safe zones** | Text under IG UI zones |
| **Line breaks** | Awkward splits (“your aries buddy”) |
| **Mimic placement** | Layout drift vs reference pattern |

If layer editor / compare is visible in marketer view, note whether **placement issues are fixable in UI** vs require **regen**.

## E. First-attempt publish verdict

One of: **Publish now** | **Minor polish** | **Regen needed** | **Reject**

**Root cause tag** (pick primary): `prompt_gap` | `brand_profile_gap` | `qc_miss` | `render_overlay` | `mimic_ocr_bleed` | `asset_pipeline` | `format_wrong` | `human_needed`

**What would have made this pass on attempt 1?** — one concrete sentence (e.g. “Stronger hook constraint in generation”, “Post-render text bounds check”, “Ban verbatim reference OCR in mimic copy guard”).

---

# Issue taxonomy (tag every finding)

Use **category + severity P0/P1/P2**:

### Copy
`copy_hook_weak`, `copy_generic`, `copy_off_brand`, `copy_typo`, `copy_grammar`, `copy_cta_weak`, `copy_too_long`, `copy_hashtag_spam`, `copy_duplicate`, `copy_reference_bleed`, `copy_unsafe_claim`, `script_unnatural`

### Assets
`asset_broken`, `asset_low_res`, `asset_wrong_aspect`, `asset_off_brand`, `asset_ai_artifact`, `asset_incoherent_series`, `video_hook_mismatch`, `thumb_misleading`

### Text placement
`text_illegible`, `text_truncated`, `text_overlap`, `text_low_contrast`, `text_safe_zone`, `text_linebreak_bug`, `headline_body_swap`, `cta_buried`, `mimic_layout_drift`

### First-attempt system
`qc_false_pass`, `qc_false_fail`, `batch_duplicate_angle`, `format_wrong_for_platform`, `missing_slide`, `empty_slide_copy`

---

# Phase 3 — Cross-job synthesis (first-attempt lens)

After all jobs:

1. **First-pass publish rate** — % that are Publish now or Minor polish vs Regen/Reject.
2. **Top 5 copy failures** — with ≥2 example `task_id`s each → suggest **prompt / brand rule** fix.
3. **Top 5 asset failures** — render provider, template, or asset pipeline hypothesis.
4. **Top 5 placement failures** — overlay bounds, OCR mapping, or mimic mode hypothesis.
5. **QC calibration** — PASS jobs you’d reject; FAIL jobs that look fine.
6. **Flow scorecard** — which `flow_type` is closest to first-attempt ready?
7. **Quick wins** (ship in days): prompt tweaks, QC rules, caption length caps, hashtag limits.
8. **Structural fixes** (weeks): render QA loop, mimic copy guard, placement automation.

---

# Hard constraints — do NOT suggest

- Renaming `task_id`, APIs, DB tables, or lifecycle enums
- Full product redesign or removing mimic flows
- Features with no current UI on `/brand/SNS/content`

**DO suggest:** generation prompt changes (plain language), brand profile field additions, QC checks, render/overlay guardrails, pre-publish checklists — always tied to observed `task_id` evidence.

---

# Required output format

## 1. Executive summary (≤ 15 bullets)

- Jobs audited: **N** (by tab)
- **First-attempt publish rate:** X% (Publish now + Minor polish)
- **Copy / Assets / Placement** pillar scores: 1–10 each for SNS today
- Top 3 **ship blockers** (would embarrass brand if published)
- Top 3 **highest-ROI generation fixes** (biggest lift to first-pass rate)
- Top 3 **QC gaps** (automation should catch but doesn’t)

## 2. Brand bar used

Bullet list of constraints from `/brand/SNS/profile` that drove grading.

## 3. Coverage

| Tab | Total | Reviewed | Skipped (why) |

## 4. Job scorecard (one row per job)

| task_id | Platform | Flow | Copy /5 | Assets /5 | Placement /5 | Verdict | Primary issue | First-attempt fix |
|---------|----------|------|---------|-----------|--------------|---------|---------------|-------------------|

## 5. Deep dives (top 10 worst + top 5 best)

For each: metadata, slide table, quoted copy, asset description, verdict, root cause, recommended generation fix.

**Slide table template:**

| Slide | On-slide text (quote) | Copy | Asset | Placement | Issue tags |
|-------|----------------------|------|-------|-----------|------------|

## 6. Pattern analysis

- Recurring failures by `flow_type`
- Mimic-specific patterns (reference bleed, layout drift, weak twist)
- Duplicate batch angles (same run)

## 7. First-attempt improvement backlog

| Priority | Fix | Type (prompt/QC/render/profile) | Effort S/M/L | Example task_ids | Expected lift |

Sort P0 first. Every row must cite real jobs.

## 8. Prompt & guidance draft (copy-paste ready)

Write **3–5 concrete instruction bullets** editors/engineers could add to SNS generation guidance tomorrow — derived from your top patterns (not generic advice).

## 9. Evidence appendix

- API manifest pages fetched
- Jobs you could not open (errors)
- What you did **not** audit

---

# Execution order

1. `GET /api/agent/health` → must pass  
2. `/brand/SNS/profile` → brand bar  
3. `/api/agent/queue` → full manifest (paginate)  
4. `/brand/SNS/content` → visual queue cross-check  
5. **Every job** → copy + assets + placement → verdict  
6. Synthesis → **Required output format**

**Start now** at `https://caf-core.fly.dev/api/agent/health`, then `https://caf-core.fly.dev/brand/SNS/profile`, then `https://caf-core.fly.dev/brand/SNS/content`.
