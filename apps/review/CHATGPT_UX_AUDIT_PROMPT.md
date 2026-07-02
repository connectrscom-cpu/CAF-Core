# ChatGPT Agent Mode — CAF Review UX/UI + Design Audit

Copy everything below the line into ChatGPT agent mode. Ensure production has agent inspection enabled (`https://caf-core.fly.dev/agent-map` loads).

---

# Mission

You are auditing **CAF Review**, the marketer-facing content workspace for CAF (Content Automation Framework). Your job is to crawl the live app, understand the current UX/UI as a **non-technical marketer** would experience it, and produce actionable improvement suggestions — including **visual design polish** to make the platform feel more premium, modern, and compelling (“sexier”) without a full rebrand.

You already have **CAF Core context** in this project (domain model, pipeline, entities). Use that only to understand *what the product does behind the scenes*. Your audit must focus on **marketer-facing UX/UI and visual design**, not backend architecture changes.

**Do not suggest redesigning the whole product or changing the information architecture.** Suggest targeted improvements to navigation, clarity, hierarchy, empty states, copy, flows, consistency, and **design elements** (typography, color, spacing, cards, motion, visual rhythm).

---

# App context

CAF Review funnel:

**Brands → Dashboard → Brand profile → Research → Market intelligence → Ideas → Content (review) → Publishing → Performance & learning**

- **Audience:** marketers / brand owners, not engineers
- **Primary brand to audit:** Sign And Sound (`SNS`)
- **Product goal:** help marketers know *what to do next* and move content from research to publish without CAF jargon
- **Operator tools** (`?debug=1`) — exclude from marketer UX audit unless noting accidental leakage

---

# Base URL

**Base URL:** `https://caf-core.fly.dev`

If inspection APIs return 404, report that agent inspection is not enabled on the server.

Optional token (if configured): append `?token=YOUR_TOKEN` to `/agent-map` and `/api/agent/*` URLs.

---

# Phase 1 — Machine-readable structure (do first)

1. `https://caf-core.fly.dev/agent-map`
2. `https://caf-core.fly.dev/api/agent/snapshot`
3. `https://caf-core.fly.dev/api/agent/copy-inventory`
4. `https://caf-core.fly.dev/api/agent/technical-terms`
5. Per-page JSON: `https://caf-core.fly.dev/api/agent/page?path=PATH` for:

- `/workspace`
- `/brand/SNS`
- `/brand/SNS/profile`
- `/brand/SNS/research`
- `/brand/SNS/intelligence`
- `/brand/SNS/ideas`
- `/brand/SNS/content`
- `/brand/SNS/publishing`
- `/brand/SNS/performance`

---

# Phase 2 — Visual crawl (marketer mode, no `?debug=1`)

Dismiss the “Welcome to CAF” modal if it appears; note whether it helps or blocks.

Visit every route above. For each page capture layout, hierarchy, CTAs, metrics, empty/loading states, and overall feel.

Use **`data-agent-id`** attributes when describing structure (`sidebar`, `brand-dashboard`, `overview-metrics`, `nav-ideas`, etc.).

Test: sidebar nav, brand switcher, dashboard next steps / overview / pipeline, at least one content item on `/brand/SNS/content` if drafts exist.

---

# Phase 3 — Design & “sexier” visual audit

Evaluate the platform as a **premium content SaaS** a marketer would enjoy using daily. Be specific and reference what you see on each page.

## Visual identity & atmosphere

- Does it feel cohesive, modern, and confident — or generic/admin-like?
- Is there a clear visual personality (without needing a full rebrand)?
- Does the UI feel “alive” or flat/static?

## Typography

- Hierarchy: are H1/H2/body/labels distinct enough?
- Readability: line length, contrast, font sizes on dashboard cards and sidebar
- Suggestions: weight, scale, letter-spacing, display vs body pairing

## Color & contrast

- Use of brand accent colors (e.g. brand avatar accents on SNS)
- Background vs surface vs card layers — enough depth?
- Status colors (Ready, In progress, priority cards) — clear and attractive?
- Suggestions: subtle gradients, borders, tinted surfaces, semantic color refinement

## Spacing & layout rhythm

- Padding consistency across pages
- Card grids (dashboard actions, stats, brand cards on workspace)
- Whitespace: cramped vs breathable
- Suggestions: tighter hero areas, more generous section gaps, aligned grids

## Components & surfaces

- **Sidebar** — icon + label balance, active state, section titles
- **Brand switcher** — dropdown polish, avatar treatment
- **Dashboard cards** — next-step cards vs stat cards vs pipeline rows; do priority items pop?
- **Brand page header** — breadcrumb, avatar, subtitle treatment
- **Tables / boards** (content, ideas, research) — row density, hover, badges
- **Buttons & links** — primary vs secondary clarity
- **Empty states** — illustration, copy, CTA quality

## Motion & delight (light touch)

- What micro-interactions would add polish without distraction?
- Loading states: skeletons vs plain text?
- Transitions on modals, dropdowns, page sections

## Reference bar (aspirational, not copy)

Compare *principles* (not pixels) to tools marketers know: Notion, Linear, Figma, Canva, Buffer, Later. What 2–3 patterns would elevate CAF Review?

## “Sexy” quick wins vs craft

| Tier | Examples |
|------|----------|
| **Quick visual wins** | Card shadows, border-radius consistency, stat number typography, accent strips on priority actions |
| **Medium** | Refined color tokens, sidebar active indicator, pipeline status pills, improved empty states |
| **Larger** | Illustration system, motion language, custom icon set |

**Constraint:** keep the existing sidebar structure and page hierarchy. Polish within the current layout.

---

# Phase 4 — Cross-page consistency

- Terminology consistency (Brand vs project, etc.)
- Navigation & active states
- Pipeline mental model vs section pages
- Jargon leakage (`task_id`, signal pack, flow_type, etc.) — cross-check `/api/agent/technical-terms`
- Status label clarity (“Ready”, “18 ready”, “—”)

---

# Hard constraints — do NOT suggest

- Renaming backend entities or APIs
- Full product redesign or new IA
- Removing existing sidebar structure
- Exposing operator concepts in default marketer nav
- Breaking review/workbench functionality

**Do suggest:** copy, labels, section order, empty states, tooltips, CTAs, metric explanations, onboarding, **visual hierarchy and design tokens**, card/sidebar/header polish.

---

# Known limitations

- `/brand/SNS/performance` may be stubbed — suggest future-state UX
- Some section pages may be partial implementations
- Dashboard numbers are live — report what you see, don’t invent counts
- Operator mode (`?debug=1`) is intentional

---

# Required output format

## 1. Executive summary
- Top 5 UX improvements
- Top 5 **visual design** improvements to make the platform sexier
- Overall marketer UX score (1–10)

## 2. Crawl log
| Route | Loaded? | Goal clear? | Visual polish (1–5) | Notes |

## 3. Page-by-page findings
Per route: what works | what’s confusing | UX suggestions | **design suggestions** | Priority P0/P1/P2

## 4. Design system observations
- Typography, color, spacing, components — current state vs recommended direction
- Mood board in words (e.g. “warm editorial studio” vs “cold admin panel”)

## 5. Cross-cutting issues
Terminology, navigation, jargon leakage, pipeline alignment

## 6. Copy recommendations
Before/after for unclear labels

## 7. Quick wins vs larger efforts
Separate tables for **UX** and **visual design**

## 8. Evidence
Describe key UI regions; cite `data-agent-id` where helpful

## 9. Out of scope
What you deliberately did not recommend

---

Start with Phase 1 (`/agent-map` + `/api/agent/snapshot`), then visual crawl, then write the report.
