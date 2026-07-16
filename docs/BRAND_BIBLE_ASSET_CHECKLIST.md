# Brand Bible Asset Checklist

**Purpose:** create and upload the **visual files** CAF needs for Brand Visual System (BVS). This is separate from the [project setup checklist](./PROJECT_SETUP_CHECKLIST.md), which captures strategy, voice, content routes, and visual *text* rules.

Use this when:

- Brand visual carousels, recreate-top-performers, or Why Mimic are enabled
- You want on-brand plates, logos, and motifs for rendering

**Where to upload in CAF:** Review → Brand profile → **Brand Visual System** (`/brand/{slug}/profile?tab=bible`).

**Accepted formats:** PNG, JPG, WebP, SVG. Prefer **PNG** for logos, overlays, mascots, and frames (transparency). Prefer **1080×1350** (4:5 Instagram portrait) for style references and backgrounds.

---

## How to use

1. Finish the **Visual system** text fields in the project setup pack (palette, motifs, mode, application rules).
2. Paste **this checklist** (from “Paste from here”) into ChatGPT / an image tool **with** that palette and motif brief.
3. Generate the required files; name them clearly; upload into the matching CAF categories below.
4. In BVS, pick up to **7** assets as Flux prompt references.

Do **not** bake carousel captions into logos, motifs, frames, or backgrounds. Style references may show sample layout/type as finished mockups.

---

# Paste from here

---

# Brand Visual System — asset generation brief

You are a **senior brand designer + Instagram carousel art director**.

Deliver a **cohesive, production-ready asset library** for this brand — not moodboard fluff, not competitor copies, not generic stock clipart.

Use the brand’s palette, motifs, and forbidden motifs from the project’s CAF onboarding pack / Brand Visual System text. If those are missing, stop and ask for hex palette + allowed/forbidden motifs only.

## Output rules

1. Generate **each asset as a separate image** unless noted as one sheet.
2. Use a clear filename prefix: `{brand-slug}-{category}-{descriptor}.png` (e.g. `cuisina-style-reference-01.png`).
3. **Transparency:** mascots, frames, design elements, and logos → **PNG with alpha**. Backgrounds and style references → opaque OK.
4. Design for **1080×1350** Instagram carousel slides; leave safe margins for text overlays.
5. **No embedded marketing copy** on mascots, elements, frames, or logos (tiny handle on style-reference mockups only is OK).
6. Keep one illustration/photo style across the set.
7. After images, output a **manifest table**: filename → CAF category → one-line usage note.

---

## Asset catalog (generate what the brand needs)

Minimums are for a **usable** BVS. Skip optional rows only if the visual mode truly does not need them (e.g. photography brands may skip mascots).

### 1. Style references — CAF **Style** — min **2–3**

| Spec | Detail |
|------|--------|
| Size | **1080×1350** preferred |
| Transparency | Opaque OK |
| What | Finished carousel **mockups** that look on-brand (cover + body slide) |
| Purpose | Teach CAF overall look: type hierarchy, spacing, color, mood — not competitor pixels |
| Avoid | Low-res screenshots, heavy JPEG compression, poster/YouTube-thumbnail crops |

**Generate:** at least one cover/hook layout and one body/listicle layout in the brand visual mode.

### 2. Backgrounds / plates — CAF **Backgrounds** — min **2–4**

| Spec | Detail |
|------|--------|
| Size | 1080×1350 or larger full-bleed |
| Transparency | Opaque |
| What | Flat or lightly textured plates; room for text overlay |
| Purpose | Slide backdrops for generation / overlay |
| Avoid | Busy photos with no safe text area; baked-in headlines |

### 3. Design elements / motifs — CAF **Elements** — min **4–8**

| Spec | Detail |
|------|--------|
| Size | Often ~512–1024px; square or portrait |
| Transparency | **Transparent PNG** preferred |
| What | Stickers, icons, glyphs, flourishes, corner ornaments |
| Purpose | Decorative overlays on slides |
| Avoid | Captions, logos of other brands, unreadable micro-detail |

### 4. Logos / marks — CAF **Logos** — min **1–3**

| Spec | Detail |
|------|--------|
| Size | Crisp at ~80px height on mobile |
| Transparency | **Transparent PNG/SVG** |
| What | Light, dark, and mono variants if possible; plus one on solid brand-color plate |
| Purpose | Wordmark / icon placement on carousels |
| Avoid | Low-res screenshots; logos with baked captions |

### 5. Mascots / characters — CAF **Mascots** — **0–3** poses (optional)

| Spec | Detail |
|------|--------|
| Size | Consistent canvas across poses |
| Transparency | Transparent PNG |
| What | Same character: e.g. neutral, waving, pointing |
| Purpose | Recurring brand character on slides |
| Avoid | Different characters per pose; photoreal humans unless brand is photo-led |

### 6. Slide frames / borders — CAF **Frames** — **0–2** (optional)

| Spec | Detail |
|------|--------|
| Size | Match 1080×1350 safe area |
| Transparency | Transparent PNG |
| What | Border / corner overlays; **center empty** for copy |
| Purpose | Optional decorative frame toggle in layout tools |

### 7. Anti-references — **0–2** (optional)

| Spec | Detail |
|------|--------|
| Size | Any |
| Transparency | Opaque OK |
| What | “Never look like this” examples |
| Purpose | Negative guidance for style |

---

## Quality checklist (before upload)

- [ ] Style refs are true **1080×1350** carousel mockups
- [ ] Palette matches brand hex values
- [ ] Transparent PNGs have clean alpha (no gray matte boxes)
- [ ] No forbidden motifs from the brand bible text
- [ ] Mascots (if any) are clearly the **same** character across poses
- [ ] Logos readable small; light + dark variants if backgrounds vary
- [ ] Manifest maps each file → CAF category
- [ ] Flux prompt picks chosen (max **7** asset IDs) after upload

---

## CAF upload map

| CAF category | Typical files |
|--------------|---------------|
| Style | `{slug}-style-reference-01.png` … |
| Backgrounds | `{slug}-background-….png` |
| Elements | `{slug}-element-….png` |
| Logos | `{slug}-logo-….png` |
| Mascots | `{slug}-mascot-….png` |
| Frames | `{slug}-frame-….png` |

Upload → **Save brand bible** → select Flux references.

---

## Optional follow-up prompt

> Regenerate only `[filename]` for {brand}. Keep palette {hex list}. Fix: [issue]. Match the other assets in this session.

Brand-specific example (SNS): `apps/review/CHATGPT_SNS_BVS_ASSET_GENERATION_PROMPT.md`.
