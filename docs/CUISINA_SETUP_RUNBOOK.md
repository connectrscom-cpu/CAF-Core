# Cuisina setup runbook

Operator checklist to stand up **Cuisina** using the universal setup docs, then start the SMM dry-run.

## Prerequisites

- [ ] Fill [PROJECT_SETUP_CHECKLIST.md](./PROJECT_SETUP_CHECKLIST.md) for Cuisina (paste into Cuisina’s ChatGPT project → upload filled pack)
- [ ] Content routes decided **in that pack** (§6) — recommend start: niche carousels + brand visual carousels
- [ ] After text pack: generate BVS files with [BRAND_BIBLE_ASSET_CHECKLIST.md](./BRAND_BIBLE_ASSET_CHECKLIST.md)
- [ ] Product bible assets only if product routes are Yes — [PRODUCT_BIBLE_ASSET_CHECKLIST.md](./PRODUCT_BIBLE_ASSET_CHECKLIST.md)

Short AI pointer: [CHATGPT_PROJECT_SETUP_GUIDE.md](../apps/review/CHATGPT_PROJECT_SETUP_GUIDE.md)

## Steps

1. **Create brand** — Review `/workspace` → **New brand** → slug `CUISINA` → paste/upload the **filled** onboarding pack (routes apply from §6 when recognized).
2. Or import via Admin / `npm run import:onboarding-pack -- --file <pack.md>`.
3. **Profile** — `/brand/CUISINA/profile` — confirm voice, audience, goals, banned words.
4. **Content routes** — already set from the pack; adjust on Brand profile → Content routes only if needed.
5. **BVS** — Profile → Brand Visual System — paste application guide if needed, upload assets from the Brand Bible asset checklist, pick Flux refs.
6. **Product Bible** — only if product routes are on.
7. **HeyGen** — only if video routes are on (presenters / voices).
8. **Research** — `/brand/CUISINA/research` — paste watchlists → **Start market research**.
9. **Brief** — when scrape completes → **Build research brief**.
10. **Ideas** — Intelligence → **Generate ideas** → Ideas board → cart → generate → review → publish.
11. **Dogfood** — log friction in [CAF_DOGFOOD_NOTES.md](./CAF_DOGFOOD_NOTES.md).

## Success for first dry-run

- At least one research brief with ideas for **enabled routes only**
- At least one content job reviewed in `/brand/CUISINA/content`
- Publish attempt recorded (or blocked only by missing Meta credentials — note that as a gap)

## Status (engineering deliverables)

| Item | Status |
|------|--------|
| Project setup checklist (fillable pack) | [PROJECT_SETUP_CHECKLIST.md](./PROJECT_SETUP_CHECKLIST.md) |
| Brand Bible asset checklist | [BRAND_BIBLE_ASSET_CHECKLIST.md](./BRAND_BIBLE_ASSET_CHECKLIST.md) |
| Product Bible asset checklist | [PRODUCT_BIBLE_ASSET_CHECKLIST.md](./PRODUCT_BIBLE_ASSET_CHECKLIST.md) |
| Content routes catalog | [CONTENT_ROUTES.md](./CONTENT_ROUTES.md) |
| Review downloads | `/setup/*.md` on New brand |
| Dogfood log | [CAF_DOGFOOD_NOTES.md](./CAF_DOGFOOD_NOTES.md) |

**Human next step:** fill the project setup checklist in ChatGPT, create the brand with the filled pack, upload BVS assets, then run the SMM dry-run and note findings in the dogfood log.
