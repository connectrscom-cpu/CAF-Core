# Product Bible Asset Checklist

**Purpose:** create and upload **product evidence images** CAF uses for product carousels and product marketing videos. Separate from the [project setup checklist](./PROJECT_SETUP_CHECKLIST.md) §7–§8 (product *text*: profile + Product Bible modules).

Complete this **only if** product content routes are enabled (product carousels and/or product marketing videos).

**Where to upload in CAF:** Review → Brand profile → **Product Bible** (and link assets from Brand assets / product modules as the UI allows).

**Accepted formats:** PNG, JPG, WebP. Prefer **PNG** for UI screens with sharp text; JPG OK for lifestyle/hero photos.

---

## How to use

1. Fill [project setup](./PROJECT_SETUP_CHECKLIST.md) §7–§8 (products, keys, one-liners, features).
2. Paste **this checklist** into ChatGPT / design tools with those product names and any real product URLs or existing screenshots.
3. Produce the asset set below; name files clearly; upload and attach to the right product / feature in Product Bible.
4. Prefer **real product UI** over invented mockups. If you must mock, label as `mock` in the filename and notes.

---

# Paste from here

---

# Product Bible — asset generation / capture brief

You help assemble a **product evidence pack** for CAF content generation (carousels + product videos).

Goal: every major claim in product content can point at a **real screenshot, UI flow, or proof visual** — so models do not invent fake app screens.

## Output rules

1. Prefer **captures from the live product** (or staging). Invented UI only when no capture exists — mark clearly.
2. Filename convention: `{brand-slug}-{product-key}-{role}-{nn}.png`  
   Example: `vaultlm-vault-screenshot-home-01.png`
3. Keep UI text **legible** at phone width; crop chrome that is not the product.
4. No competitor logos, no stock “laptop with blurry dashboard” unless it is the actual product.
5. After files, output a **manifest**: filename → product key → feature key (if any) → role → one-line what it proves.

---

## Roles CAF understands

Use these roles in filenames/notes:

| Role | When to use |
|------|-------------|
| `screenshot` | Primary product screen |
| `ui_screen` | Specific UI state (settings, empty state, success) |
| `feature_demo` | Feature highlighted in isolation |
| `workflow` | Multi-step flow (or numbered sequence of stills) |
| `hero` | Marketing hero / product-in-context |
| `comparison` | Before/after or vs-alternative (brand-owned visuals only) |

---

## Minimum inventory (per product)

| Asset | Min | Spec | Purpose |
|-------|-----|------|---------|
| Home / primary screen | 1 | Clear UI, readable type | Default product proof |
| Key feature screens | 2–4 | One screen per highlight feature | Feature carousels & videos |
| Workflow sequence | 0–1 set | 3–5 ordered stills **or** one annotated strip | “How it works” |
| Empty / onboarding state | 0–1 | If onboarding is a selling point | Relatable entry moment |
| Success / outcome state | 0–1 | Result the user gets | Proof / offer slides |
| Hero / lifestyle (optional) | 0–2 | Real product context | Soft awareness |
| Comparison (optional) | 0–1 | Brand-owned only | Differentiation |

**Totals:** aim for **4–8** strong stills per core product before enabling product routes in production.

---

## Capture / generation guidance

### Screenshots & UI

- Desktop or mobile — match where the audience actually uses the product.
- Prefer **light, high-contrast** captures unless the product UI is dark-first.
- Hide personal data; use demo accounts.
- Avoid browser clutter; crop to the product chrome that matters.
- Export at least **1080px** on the short side when possible.

### Workflows

- Either one image per step (`…-workflow-01` … `…-workflow-03`) **or** a single vertical strip labeled 1–2–3.
- Same window size and theme across steps.

### What not to upload

- Blurry phone photos of a monitor
- Marketing slides with walls of body copy (use Product Bible **text** fields for copy)
- Competitor UI
- Fake dashboards that over-claim metrics

---

## Tie to Product Bible text

Before upload, ensure the [project setup pack](./PROJECT_SETUP_CHECKLIST.md) §7–§8 / Product Bible has:

| Text field | Why |
|------------|-----|
| Product key + label | Stable id for linking assets |
| One-liner | Caption / script grounding |
| Features to highlight | Maps to `feature_demo` assets |
| HeyGen / Flux product notes (optional) | Which screens prefer video vs still |

Assets without a product key are hard to reuse in generation.

---

## Quality checklist

- [ ] Every product with an enabled product route has ≥1 primary screenshot
- [ ] Each highlighted feature has ≥1 matching UI asset
- [ ] Filenames include product key + role
- [ ] Manifest lists product → feature → role
- [ ] No invented metrics or fake competitor UIs
- [ ] Personal / customer PII removed
- [ ] Product Bible saved in Review after linking assets

---

## Optional prompt for missing screens

> For product `{product-key}` on brand `{brand}`, I need a clean `{role}` still of `{feature or screen}`. Prefer a real capture. If generating a mock, match the real product chrome and mark the filename with `mock`. No competitor brands. No unreadably small type.

---

## After upload

1. Attach assets to the correct product / feature in Product Bible.
2. Confirm product carousels / product marketing videos remain enabled in content routes.
3. Generate a test idea → job and verify the draft references real UI, not invented screens.
