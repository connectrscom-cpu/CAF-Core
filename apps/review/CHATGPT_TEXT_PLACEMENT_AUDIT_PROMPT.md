# ChatGPT Agent Mode — Text Placement & Editor Layout Audit

Copy everything below the line into **ChatGPT agent mode** (with browsing). Use after the Review Console is stable enough to open mimic carousel jobs and navigate all slides.

**Companion prompts:**

| Prompt | Focus |
|--------|--------|
| `CHATGPT_SNS_PUBLISH_READY_QUALITY_AUDIT_PROMPT.md` | **Marketer content queue** — copy, assets, placement, first-pass publish quality |
| `CHATGPT_CONTENT_QUALITY_WORKBENCH_AUDIT_PROMPT.md` | Copy quality, brand fit, publish readiness (operator workbench) |
| `CHATGPT_REVIEW_APP_STATE_PROMPT.md` | Marketer funnel |
| `CHATGPT_UX_AUDIT_PROMPT.md` | Visual polish |

**Layout tip:** On production, use **Hide nav** / **Hide filters** / **Focus** in the workbench header and task page to maximize the slide + layer editor area.

---

# Mission

You are a **typography and layout QA specialist** auditing the CAF **operator Review Console** — specifically how **on-slide text** is placed, edited, and presented for **TP-grounded mimic carousels** (Why Mimic, Reference Replica, Visual-first).

Your job:

1. Open jobs on the workbench (`?project={slug}` — any brand with mimic carousels in queue).
2. For **each slide**, evaluate **rendered text placement** on the image AND the **text editor / layer editor UI**.
3. Document **headline vs body box** behavior, overlap, truncation, safe zones, and **page formatting** (grid, sticky bars, panel hierarchy).
4. Produce actionable fixes for **Review UI** and **render/overlay pipeline** — project-agnostic recommendations.

**Read-only:** do not Approve/Reject or save layout overrides unless explicitly asked.

---

# Primary URLs

- Workbench: `https://caf-core.fly.dev/admin/workbench?project={SLUG}`
- Task: `/t/{task_id}?project={SLUG}`
- Use **Focus** mode to hide left navigation and workbench filters for full-width review.

**Flow types to prioritize:** Why Mimic carousel, Reference Replica carousel (full-bleed + listicle), manual Top Performer mimic (compare mode).

---

# Phase 0 — Setup

1. Confirm workbench loads; enable **Focus** or **Hide nav** + **Hide filters**.
2. Open brand profile for voice context only — this audit is about **layout**, not copy semantics.
3. Inventory 3–5 mimic carousel jobs (mixed full-bleed / template_bg / listicle if available).

---

# Phase 1 — Page formatting & chrome

Rate **1–5** and note issues:

| Area | Inspect |
|------|---------|
| **Sticky post copy bar** | Hook, caption, hashtags visible without scrolling past layer editor? |
| **Slide thumbnail strip** | Can you jump to slide 8 in one click? Active slide clear? |
| **Nav chrome** | Hide nav / Focus restores usable width? |
| **Decision panel** | Approve/Reject reachable while editing slide 5? Sticky at bottom? |
| **Preview row** | Generated vs Original compare aligned? Aspect ratio consistent? |
| **Layer editor split** | Text blocks vs layout panel resizable? Default split sensible? |
| **Scroll length** | Does reaching caption require scrolling through entire layer editor? |
| **Crashes** | Aw Snap when changing slides or scrolling? |

---

# Phase 2 — Per-slide text placement (core)

For **every slide** in each job:

## A. Rendered composite (what would publish)

| Check | Question |
|-------|----------|
| **Legibility** | Can you read all on-slide text at phone width (~390px)? |
| **Contrast** | Text vs background — sufficient? Text backing visible? |
| **Truncation** | Words cut off mid-line or clipped by box edge? |
| **Overlap** | Headline overlapping body, or text over faces/busy areas? |
| **Safe zones** | Text in Instagram safe area (not under UI chrome)? |
| **Font scale** | Headline vs body hierarchy clear? CTA readable? |
| **Role correctness** | Headline box holds hook; body holds support copy; handle line correct? |
| **CTA prominence** | Call-to-action in tiny credit line vs primary text block? |
| **Compare (manual mimic)** | Generated placement vs reference — drift acceptable or broken? |

Quote **exact on-slide text** when reporting truncation/overlap.

## B. Layer editor / DocAI boxes

| Check | Question |
|-------|----------|
| **Box count** | Right number of boxes for copy slots (headline, body, CTA)? |
| **Box labels** | Roles labeled clearly (headline vs body vs handle)? |
| **Box vs render** | Do boxes match where text actually appears on preview? |
| **Active block sync** | Clicking a text field highlights the right box? |
| **Drag/resize** | Can editor fix overlap without crash? |
| **Full-bleed vs template_bg** | Listicle fields vs OCR clusters — correct mode? |
| **Reprint** | After text edit, does reprint update placement without regen image? |

## C. Text block editor (left column)

| Check | Question |
|-------|----------|
| **Headline field** | Present, sized for 1–3 lines? |
| **Body field** | Separated from headline? Multi-line? |
| **Field order** | Matches narrative (hook → body → CTA)? |
| **Placeholder** | Empty fields obvious? |
| **Typing UX** | Cursor stable while typing? No flicker? |

---

# Issue taxonomy

Tag each finding:

**Render:** `text_illegible`, `text_low_contrast`, `text_truncated`, `text_overlap_subject`, `text_overlap_boxes`, `text_safe_zone`, `cta_buried`, `headline_body_swap`, `font_scale_wrong`

**Editor UI:** `box_count_wrong`, `box_role_unclear`, `box_render_mismatch`, `field_missing`, `field_order_wrong`, `sync_broken`, `panel_cramped`, `scroll_too_long`

**Page chrome:** `sticky_copy_missing`, `thumb_strip_missing`, `decision_buried`, `nav_wastes_width`, `compare_misaligned`, `crash_on_slide_nav`

**Pipeline:** `reprint_did_not_update`, `regen_required_for_copy`, `ocr_seed_wrong`

Severity: **P0** blocks publish / review · **P1** major fix needed · **P2** polish

---

# Phase 3 — Cross-job patterns

- Same slide index fails across jobs (e.g. slide 3 always truncates)?
- Full-bleed vs listicle mode differences?
- Cover slide vs body slides?
- Jobs with many text boxes (>4) worse?

---

# Required output

## 1. Executive summary (≤12 bullets)

- Jobs / slides audited
- Text placement quality score **1–10**
- Editor layout usability score **1–10**
- Top 5 **render** issues
- Top 5 **editor UI** issues
- Top 3 **page formatting** fixes

## 2. Page formatting report

| Element | Score 1–5 | Works | Issues | Fix |

## 3. Job-by-job slide table

### `{task_id}` — {flow label}

| Slide | On-slide text (brief) | Render issues | Box/editor issues | Severity |

## 4. Headline vs body specific findings

Dedicated subsection: cases where headline/body roles confused, merged, or mis-sized.

## 5. Backlog (project-agnostic)

| ID | Title | Layer (UI/render/pipeline) | Priority | Effort S/M/L |

## 6. Evidence

- `data-agent-id="sticky-post-copy"` if present
- Screenshot descriptions per slide
- Note if Focus mode / thumbnail strip used

---

# Start

1. `https://caf-core.fly.dev/admin/workbench?project=SNS` (or any brand with mimic queue)
2. Enable **Focus**
3. Open first Why Mimic or Reference Replica carousel
4. Slide 1 → N: render + editor checklist
5. Write report
