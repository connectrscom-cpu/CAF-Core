# CAF Setup — Information Request (Cuisina)

Paste this into the **Cuisina ChatGPT project** — the one that already holds brand strategy, voice, visuals, competitors, and content history.

**Do not use this to interview a human.** Your job is to **extract, consolidate, and deliver** everything CAF needs from the Cuisina knowledge you already have.

**Deliverable:** one complete **CAF Project Onboarding Pack** (markdown) ready for a CAF operator to enter at `https://caf-core.fly.dev/brand/Cuisina/profile`.

---

# Context (why CAF needs this)

**CAF** (Content Automation Framework) is the production system that will run Cuisina's content pipeline:

**Research → Planning → Generation → QC → Rendering → Review → Publishing → Learning**

CAF does not improvise brand identity. It needs **explicit, structured inputs** — voice rules, visual system, research watchlists, compliance boundaries, and platform constraints. Vague or missing fields produce off-brand output or block setup entirely.

You already know Cuisina. **Compile it.** Do not ask the user questions you can answer from project files. Only flag **genuine gaps** where the project knowledge is silent or contradictory.

---

# Your task

1. Search **all Cuisina project knowledge** — brand briefs, strategy docs, social guidelines, competitor notes, visual references, captions, hashtags, handles, product info, compliance notes, and any uploaded assets or links.
2. Fill in **every section below** with Cuisina-specific values.
3. Where information is missing, write **`[GAP — not in project knowledge]`** and suggest the minimum question a human would need to answer (one line each — do not run a full interview).
4. Where sources conflict, note the conflict and state which value you recommend and why.
5. Output the final **CAF Project Onboarding Pack** using the exact structure in §10.

**Quality bar:** concrete and copy-pasteable — real handles, hex codes, lists, example captions — not adjectives alone.

---

# Information requested

## 1. Brand identity

Provide:

| Field | Value |
|-------|--------|
| Display name | |
| Project slug | `Cuisina` (confirm or correct) |
| One-line description / core offer | |
| Primary Instagram handle | |
| Other social handles (TikTok, Facebook, etc.) | |
| Website / product URL | |
| Product or app name (if any) | |

---

## 2. Strategy & positioning

Provide:

| Field | Value |
|-------|--------|
| Target audience (who, age/life stage, skill level, geography) | |
| Audience type | B2C / B2B / Prosumer |
| Audience problem | |
| Transformation promise | |
| Positioning statement | |
| Differentiation vs competitors | |
| Strategic content pillars (3–5) | |
| Primary content goal | Awareness / Engagement / Leads / Conversions / Education / Community |
| Primary business goal | |
| Publishing intensity (posts/week per platform) | |
| North-star metric (if defined) | |
| Content approval owner | |

---

## 3. Voice & copy rules

Provide:

| Field | Value |
|-------|--------|
| Tone / voice (with 2–3 example phrases that sound like Cuisina) | |
| Audience reading level | |
| Storytelling style (listicle, tutorial, myth-bust, etc.) | |
| CTA style | |
| Emoji policy (allowed? max per caption?) | |
| Banned words (semicolon-separated list) | |
| Banned claims | |
| Mandatory disclaimers | |
| Humor / emotional intensity | |

**Also include:** 3–5 **real or representative Cuisina captions** from project knowledge (or write faithful examples if none exist — label them as examples).

---

## 4. Visual identity

### Text fields

| Field | Value |
|-------|--------|
| Visual style description | |
| Color palette (hex codes + role per color) | |
| Domain metaphors | |
| Allowed motifs | |
| Forbidden motifs | |
| Platform visual focus | |

### Brand Visual System (BVS) rules

| Field | Value |
|-------|--------|
| Visual mode | Illustrated / Photography / Minimal editorial / Mixed / Custom |
| Application instructions (how CAF should apply the visual system) | |
| Content aims | |
| Mimic policy (when reinterpreting top performers) | |
| Original carousel policy (mandatory brand elements) | |
| Top 7 assets for Flux image prompts (name + role, if known) | |

### Visual assets inventory

List what **already exists** in project knowledge vs what **still needs to be created or uploaded**:

| Asset category | Min qty | Status | Notes / filename if known |
|----------------|---------|--------|---------------------------|
| Style references (1080×1350 carousel mockups) | 2–3 | Have / Need / Partial | |
| Backgrounds (full-bleed plates) | 2–4 | | |
| Design elements (PNG, transparent) | 4–8 | | |
| Logos / marks (PNG/SVG, transparent) | 1–3 | | |
| Mascots / characters (optional) | 0–3 poses | | |
| Slide frames / borders (optional) | 0–2 | | |
| Anti-references ("never look like this") | 0–2 | | |

If assets are missing but palette and motifs are clear enough, add a short **asset generation brief** (filename list + spec per file) so they can be produced separately.

---

## 5. Research & competitive intelligence

Provide **concrete watchlists** (one entry per line in your output):

| Source type | Cuisina values |
|-------------|----------------|
| Instagram accounts to watch (competitors + inspiration) | |
| TikTok accounts | |
| Hashtags | |
| Reddit communities | |
| Facebook pages | |
| Websites & blogs | |

Also provide:

- **Named competitors** (3–5) and why each matters
- **Inspiration accounts** (not competitors)
- **Topics to exclude** from research
- **Cuisina top-performing posts** (URLs or descriptions) — for mimic flows
- **Formats that work for Cuisina** (carousel, reel, talking head, etc.)

---

## 6. Content formats & platform rules

Specify what CAF should produce for Cuisina:

| Format | Enable? | Cuisina-specific rules |
|--------|---------|------------------------|
| Instagram carousels | Yes / No | slide count, hook style, caption length |
| Top-performer mimic | Yes / No | reference posts, fidelity to structure |
| HeyGen video / reels | Yes / No | avatar/voice preference, script tone |
| Scene assembly / multi-clip | Yes / No | pacing, B-roll style |
| Text-only posts | Yes / No | platform + char limits |

**Per-platform constraints** (Instagram first; add others if relevant):

- Caption max chars
- Hook max chars / must fit first lines?
- Carousel slide min–max
- Max hashtags + format rule
- Links allowed in caption?
- Line-break policy

---

## 7. Publishing

| Field | Value |
|-------|--------|
| Platforms to publish on | |
| Primary link-in-bio URL | |
| Default hashtag sets (branded + niche) | |
| Preferred posting times / timezone | |
| Meta / IG business account notes (if in project knowledge) | |

---

## 8. Legal, risk & compliance

| Field | Value |
|-------|--------|
| Regulated category (food, health, etc.) | |
| Claims Cuisina must never make | |
| Sensitive topics to avoid | |
| Sponsor / affiliate disclosure rules | |
| Nutrition or health disclaimer requirements | |

---

## 9. Gaps & recommendations

After compiling, provide:

1. **`[GAP]` list** — fields you could not fill from project knowledge
2. **Conflicts** — any contradictory info across sources
3. **Setup readiness** — MVP / Production-ready / Not ready (one sentence why)
4. **Priority actions** — top 3 things the team must supply before CAF can generate on-brand carousels

---

# Required output format

Respond with **only** this document (no preamble, no CAF tutorial):

```markdown
# CAF Project Onboarding Pack — Cuisina

> Compiled from Cuisina project knowledge on {date}.
> Readiness: {MVP | Production-ready | Not ready}

## 1. Brand snapshot
- Display name:
- Slug:
- Description:
- Instagram:
- Other handles:
- Website:

## 2. Strategy
- Audience:
- Audience type:
- Problem:
- Promise:
- Positioning:
- Differentiation:
- Content pillars:
- Content goal:
- Business goal:
- Publishing intensity:
- Approval owner:

## 3. Voice & compliance
- Tone:
- Reading level:
- Storytelling style:
- CTA style:
- Emoji policy:
- Banned words:
- Banned claims:
- Disclaimers:
- Example captions:
  1.
  2.
  3.

## 4. Visual system
- Style:
- Palette (hex + roles):
- Domain metaphors:
- Allowed motifs:
- Forbidden motifs:
- Visual mode:
- Application instructions:
- Mimic policy:
- Original policy:
- Asset inventory:
  | Category | Status | Notes |
  |----------|--------|-------|
  | ... | ... | ... |
- Asset generation brief (if needed):

## 5. Research watchlist
### Instagram accounts
```
(one per line)
```
### TikTok accounts
```
```
### Hashtags
```
```
### Reddit
```
```
### Facebook
```
```
### Websites & blogs
```
```
- Competitors:
- Inspiration accounts:
- Topics to exclude:
- Top performers:
- Winning formats:

## 6. Formats & platforms
- Enabled formats:
- Instagram rules:
- Other platform rules:

## 7. Publishing
- Channels:
- Link-in-bio:
- Hashtag sets:
- Posting schedule:

## 8. Compliance
- Category:
- Banned claims:
- Sensitive topics:
- Disclosures:

## 9. Gaps & next steps
- Gaps:
- Conflicts:
- Priority actions:
```

---

# Rules

- **Do not** explain what CAF is beyond the short context above.
- **Do not** ask the user a long questionnaire — extract first, gap second.
- **Do not** invent handles, hex codes, or competitors — use project knowledge or mark `[GAP]`.
- **Do** prefer specifics over adjectives ("warm terracotta `#C4714A`" not "warm colors").
- **Do** separate facts from examples (label examples clearly).
- **Do** keep lists copy-pasteable for the CAF Review app and research workbook upload.

---

# For other brands

Copy this file into another brand's ChatGPT project and replace **Cuisina** / **Cuisina** with the target brand name and slug. The information request structure stays the same.
