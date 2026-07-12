# ChatGPT Agent Mode — CAF Review Console: Carousel Editing Guide

Copy everything below the line into **ChatGPT agent mode** (with browsing).

**Use this prompt when:** you need to **hands-on edit carousel jobs** in the CAF Review Console — copy, layout, typography, highlights, and reprint — including **Apply to all** deck actions.

**Primary URL:** `https://caf-core.fly.dev/admin/workbench` (add `?project=SNS` or open from **Content** workbench for a brand).

**Companion docs (same folder):**

| File | Use for |
|------|---------|
| `CHATGPT_SNS_LISTICLE_EDIT_PROMPT.md` | Generate/fix **template_bg zodiac listicle copy** as JSON before pasting into Slide copy |
| `CHATGPT_MIMIC_CAROUSEL_EDIT_CONTINUE_PROMPT.md` | Task-specific edit pass with reporting template |
| `CHATGPT_SNS_BVS_ASSET_GENERATION_PROMPT.md` | Brand visual assets (logos, frames, backgrounds) — not slide editing |

**Hard refresh** once before starting (`Ctrl+Shift+R` / `Cmd+Shift+R`) so you get the latest editor UI.

---

# Mission

You are a **senior content editor** operating the CAF Review Console carousel workbench.

Your job on each carousel task:

1. Rewrite on-slide copy and post caption/hashtags until on-brand and publish-ready.
2. Fix text placement, font size, and colour on every slide.
3. Use **Apply to all** deck actions to propagate layout efficiently — do not manually tune 12 identical body slides one by one unless necessary.
4. **Reprint text** when the deck is done so slide **thumbnails** match the editor.
5. Log issues and UX friction for product/engineering.

**You may** save, reprint, and edit copy/layout. **Do not** Approve/Reject unless explicitly asked.

---

# Before you start

### Health check

```
GET https://caf-core.fly.dev/api/agent/health
```

Must return `"ok": true`. If 502/503, wait 30–60s and retry.

### Find carousel jobs

1. Open workbench: `https://caf-core.fly.dev/admin/workbench?project=SNS`
2. Filter by flow type:
   - **Visual mimic** / **Top Performer Mimic carousel** — full-bleed art + text overlay
   - **Visual-first carousel** — same editor, no original-vs-generated compare
   - **template_bg listicles** — shared background plates (cover / middle / CTA slots)
3. Open a job in **IN_REVIEW** (or equivalent reviewable state).
4. Record `task_id` at the top of your notes.

### Maximize editor space

Use workbench header controls when available: **Hide nav**, **Hide filters**, **Focus** — the layer editor needs horizontal room (three-column layout).

---

# Which editor you get

| Flow | Editor | Left column | Compare row |
|------|--------|-------------|-------------|
| `FLOW_TOP_PERFORMER_MIMIC_CAROUSEL` | Full layer editor | Slide copy / text phrases | Original vs Generated (top) |
| `FLOW_VISUAL_FIRST_CAROUSEL` | Same layer editor | Same | **No** compare |
| `FLOW_CAROUSEL` (classic) | Slide fields + brand styling | Headline/body per slide type | N/A |

This guide focuses on **TP-grounded mimic / visual-first / template_bg** jobs — the three-column **layout editor**.

---

# Editor layout (three columns)

| Column | Label in UI | What you do |
|--------|-------------|-------------|
| **Left** | **Slide copy** (template_bg) or **Text phrases** (full-bleed) | Edit headline, body, subtitle, handle, CTA fields per slide |
| **Center** | Canvas preview | Drag text boxes, resize corners, see live typography on the background plate |
| **Right** | Inspector | Font size, weight, colour, family; **Apply to all slides**; overlays; save/reprint footer |

**Slide picker row** (above canvas): numbered buttons `1 … N` with a green dot when layout is saved. **Unsaved** badge warns before you leave a slide.

**Thumbnails** below the editor show the **last reprint** until you click **Reprint text**. The center canvas shows **live** layout + copy.

---

# The golden workflow

```text
Edit copy (left) → tune layout on one reference slide (center + right)
  → Apply to all (right inspector) → spot-check every slide number
  → Reprint text (All slides) → verify thumbnails
```

| Step | Action | Persists? | Updates PNG thumbnails? |
|------|--------|-----------|-------------------------|
| Edit Slide copy + Save slide | Left column → **Save slide** | Yes (copy) | No — canvas preview updates |
| Drag boxes / change font | Canvas + inspector | In memory until save | No — canvas preview only |
| **Apply all layout to all slides** | Right inspector | **Yes — auto-saves all touched slides** | No |
| **Save layout — slide N** | Inspector footer | Yes (layout for one slide) | No |
| **Save all slides** | Inspector footer or Apply section | Yes (layout all edited slides) | No |
| **Reprint text** | Inspector footer, scope **All slides** | Saves first, then reprints | **Yes** |
| **Regenerate** / **All slides (N)** | Toolbar above canvas | New AI background (billed) | Yes — new art, text must be reprinted |

**Rule:** finishing a deck = **Reprint text** with **All slides** selected. Layout survives refresh; images do not update until reprint.

---

# Apply to all slides (inspector — right column)

This section is the main efficiency tool. Read the hints under each button — scopes differ by deck type.

## 1. Apply all layout to all slides (primary button)

**What it does:** Copies the **current slide's** headline and body box settings — position, size, font size, weight, colour, family — to other slides.

**Prerequisite:** On the current slide, position and style **both** headline and body boxes (or at least one role). If neither exists, you get: *"Edit headline and body boxes on this slide first, then apply to all."*

**template_bg listicles (cover / middle / CTA):** Scope is **slot-aware**, not literally every slide:

| You are on… | Apply reaches… |
|-------------|----------------|
| Slide 1 (cover) | Cover slide only |
| Any middle sign slide (2 … N−1) | **All middle slides** (shared body layout) |
| Last slide (CTA) | CTA slide only |

Headline boxes **auto-stretch width** per slide to fit longer sign names. Body placement and typography sync across the slot group.

**After click:** Layout auto-saves. Toast confirms e.g. *"Applied headline + body to 12 middle slides … Reprint when images should match."*

**When to use:** After tuning one **representative middle slide** (e.g. slide 3) — apply to all 12 sign slides. Repeat separately for **cover** (slide 1) and **CTA** (last slide) if their layouts differ.

## 2. Typography → all Headline boxes

**What it does:** Propagates **font only** (size, weight, colour, family, italic) from the **selected box** to every headline box in scope.

**Prerequisite:** Select a headline box on canvas first.

**Scope:** Same slot rules as above for template_bg. On full-bleed mimic decks, all headline-role boxes across the deck.

**When to use:** You like the font size on one headline but boxes are already positioned — typography-only pass without moving boxes.

## 3. Typography → all Body boxes

Same as headline typography, but for body-role boxes.

## 4. Box placement → all Headline boxes

**What it does:** Copies **x, y, width, height** (and locks the box) from the selected headline to all headline boxes in scope.

**When to use:** Rare for listicles (headline lengths vary) — prefer **Apply all layout** which auto-sizes headline width. Useful on full-bleed mimic when every slide shares the same headline zone.

## 5. Box placement → all Body boxes

Copies body box geometry to all body boxes in scope. Common for listicles after tuning one middle slide's body block position.

## 6. Save all slides

Persists layout for every slide you have edited. **Does not reprint.** Use when you want a checkpoint before reprint, or after apply-all if you want explicit confirmation.

---

# Overlay options (deck-wide — apply on reprint)

Below the Apply section, checkboxes affect **every slide** on the next reprint:

| Toggle | Effect |
|--------|--------|
| **Highlight behind text** | Semi-opaque backing behind text blocks |
| **Colour** + brand swatches | Highlight fill colour |
| **Stamp brand logo (lower-right)** | Logo overlay |
| **Brand slide frame** | Frame from Brand Visual System |

**Apply buttons** (when deck has 2+ slides):

| Button | Effect |
|--------|--------|
| **Highlight → all slides** | Ensures highlight setting is deck-consistent |
| **Brand logo → all slides** | Enables logo stamp across deck |
| **Brand frame → all slides** | Enables selected frame across deck |

Hint in UI: *"These toggles apply on the next reprint — save layout first, check every slide, then reprint."*

**Note:** Highlight feels per-box in the inspector but is a **deck-wide render flag** — toggling it changes all slides on reprint.

---

# Canvas toolbar (above preview)

| Control | Use |
|---------|-----|
| **Undo / Redo** | Revert accidental drags (`Ctrl/Cmd+Z`) |
| **Fit boxes to text** | Shrink oversized OCR boxes on current slide |
| **Add text box** | Manual box (avoid unless necessary — duplicates cause clutter) |
| **Delete box** | Remove selected box |
| **Clear added boxes** | Remove all manually added boxes on this slide |
| **Restore hidden** | Surfaces boxes hidden by reset or dedupe |
| Layer tabs | Quick jump between text boxes on this slide |

**Per-box inspector** (when a box is selected):

- Font size slider (typical range ~32–60px; can go higher)
- Font weight, colour, family
- **Fit box to text** — single-box version

**template_bg:** On-canvas text is read-only — edit copy in **Slide copy** (left). Canvas follows those fields.

---

# Inspector footer (save + reprint)

| Button | Action |
|--------|--------|
| **Save layout — slide N** | Persist current slide layout only |
| **Reset slide layout** | Clear saved positions + manual boxes for this slide |
| **Remove duplicates** | Auto-remove redundant custom boxes repeating same copy |
| **Save all slides** | Persist all edited slide layouts |
| **Reprint text** | Save layout, then bake copy + styling into PNGs |

**Reprint scope** (radio buttons):

- **All slides** — default finish step for a completed deck
- **Slide N only** — touch-up one slide after full reprint

---

# Regenerate (toolbar — use sparingly)

| Button | Cost | When |
|--------|------|------|
| **Regenerate** / **This slide** | Billed (Flux/Qwen) | Background image wrong — artifacts, wrong scene |
| **All slides (N)** | Billed × N | Entire deck art is broken |
| **Regen cover / Regen middle (12) / Regen CTA** | Billed per slot | template_bg — refresh shared plate for that slot |

**Regen note** field: optional short instruction appended to the image prompt.

**Do not** use Regenerate to "finish" copy edits. After regen, you still need **Reprint text** to bake copy onto new plates.

---

# template_bg listicle — recommended edit order

For a **14-slide zodiac deck** (1 cover + 12 signs + 1 CTA):

### A. Copy pass

1. Use `CHATGPT_SNS_LISTICLE_EDIT_PROMPT.md` to produce clean JSON if starting from scratch.
2. For each slide, paste into **Slide copy** fields:
   - Cover: Headline + Subtitle
   - Body slides: Headline (`ARIES: Theme`) + Body
   - CTA: Headline + Body + Handle (`@signandsound`)
3. Click **Save slide** per slide (or batch-edit then save each).

### B. Layout pass (three apply cycles)

1. **Cover (slide 1):** Tune headline + subtitle boxes → **Apply all layout to all slides** (hits cover only).
2. **Middle (slide 2 or 3):** Tune headline + body → **Apply all layout** (hits all 12 middle slides).
3. **CTA (slide 14):** Tune headline + body + handle → **Apply all layout** (hits CTA only).
4. Click through slides **2–13** — confirm headline auto-width looks good; nudge individual slides only if one sign name breaks layout.

### C. Overlays (optional)

Enable highlight and/or logo/frame → **Highlight → all slides** etc. if needed.

### D. Finish

1. **Reprint text** → scope **All slides**
2. Wait for completion message (~30–60s)
3. Scroll all thumbnails — baked text must match editor
4. Fix stragglers with **Slide N only** reprint

---

# Full-bleed mimic — recommended edit order

1. Edit **Text phrases** (left) per slide — hook, body lines, etc.
2. Per slide or on a "template" slide: position boxes, set font size.
3. Use **Typography → all Body boxes** or **Box placement → all Body boxes** if multiple slides share structure; otherwise edit slide-by-slide.
4. **Apply all layout** applies across the **entire deck** (no cover/middle/CTA slot split).
5. **Reprint text** → **All slides**.

---

# Post copy (sidebar or below preview)

Separate from on-slide text:

| Field | Purpose |
|-------|---------|
| **Hook** | Instagram hook / cover line (may mirror slide 1) |
| **Caption** | Post caption |
| **Hashtags** | Post hashtags |

Editing these does **not** require reprint — they are publication metadata, not baked into slide PNGs.

---

# Common mistakes (avoid)

| Mistake | Fix |
|---------|-----|
| Expecting thumbnails to update after layout edits | Click **Reprint text** |
| Using **Regenerate** to apply copy changes | Use **Reprint text** only |
| **Apply all layout** on cover slide expecting middle slides to update | Switch to a **middle slide** first — slot scope is different |
| Duplicate text boxes after edits | **Remove duplicates** or **Delete box** |
| Hidden boxes after **Reset slide layout** | **Restore hidden** |
| Editing on-canvas text on template_bg | Use **Slide copy** (left) |
| Skipping slide spot-check after apply-all | Always click through **every slide number** |
| Approving before reprint completes | Wait for thumbnails to match |

---

# Reporting template (when asked to log work)

```markdown
## Carousel — {task_id}

**Flow:** … | **Slides:** N | **Mode:** template_bg | full-bleed

### Workflow used
- Copy: …
- Apply all: cover / middle / CTA (which slides used as source)
- Reprint: All slides | Slide N only

### Changes per slide
- Slide 1: …
- …

### Issues / UX friction
- …

### Verdict
Publish now | Minor polish | Regen needed | Reject
```

---

# Rules

- Report only what you observe on **live production**.
- Prefer **Apply to all** over repetitive per-slide layout when slides share a slot (listicle middle slides).
- **Reprint text** (All slides) is the mandatory finish step.
- **Regenerate** only for broken **background images**.
- If reprint hangs >3 min, log `task_id` + `pipeline_stuck` and retry once.
