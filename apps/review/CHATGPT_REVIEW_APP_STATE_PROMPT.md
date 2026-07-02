# ChatGPT Agent Mode — CAF Review App Current-State Audit

Copy everything below the line into ChatGPT agent mode. Ensure production has agent inspection enabled (`https://caf-core.fly.dev/agent-map` loads).

For a **deeper visual / “sexier UI” audit only**, use `CHATGPT_UX_AUDIT_PROMPT.md` in this folder instead (or run both — this prompt covers product readiness and funnel quality; that one goes deeper on polish).

---

# Mission

You are reviewing **CAF Review** — the marketer-facing content workspace for CAF (Content Automation Framework) — at its **current shipped state** on production.

Your job is to:

1. **Crawl the live app** as a non-technical marketer would.
2. **Assess what works, what is stubbed, and what is confusing** across the full funnel.
3. **Judge whether each section delivers real marketer value** (not just “a page exists”).
4. **Flag operator/engineering leakage** (jargon, debug UI, broken flows).
5. **Produce a prioritized backlog** of fixes and improvements.

You may have **CAF Core context** in this project (domain model, pipeline, entities). Use that to understand *what should happen behind the scenes* — but your report must be written for **product / UX stakeholders**, not as an architecture review.

**Do not** recommend renaming backend entities, APIs, or database tables. **Do not** propose a full product redesign or new information architecture.

**Do suggest:** copy, empty states, missing CTAs, broken flows, intelligence quality, funnel gaps, jargon cleanup, and targeted UX fixes.

---

# What CAF Review is (June 2026)

CAF Review is embedded in the Core Fly deployment — **not** a separate Vercel app.

**Canonical URL:** `https://caf-core.fly.dev`

**Audience:** marketers / brand owners (default). Operators use `?debug=1` for review console, runs, pipeline, etc.

**Marketer funnel (sidebar order):**

| Step | Route | Marketer label | Intended job-to-be-done |
|------|-------|----------------|-------------------------|
| 0 | `/workspace` | Brands | Pick a brand; see workspace overview |
| 1 | `/brand/[slug]` | Dashboard | Know status + what to do next |
| 2 | `/brand/[slug]/profile` | Brand profile | Voice, audience, visual rules, product context |
| 3 | `/brand/[slug]/research` | Research | Start / manage market research; name briefs |
| 4 | `/brand/[slug]/intelligence` | Market intelligence | **Brief-level** winning patterns, hooks, hashtags, format takeaways |
| 5 | `/brand/[slug]/ideas` | Ideas | Browse concepts; cart ideas; pick formats / mimic |
| 6 | `/brand/[slug]/content` | Content | Review drafts (marketer mode on workbench) |
| 7 | `/brand/[slug]/publishing` | Publishing | Queue / scheduled posts |
| 8 | `/brand/[slug]/performance` | Performance & learning | Outcomes + learning (may be partial) |

**Primary brand to audit:** **Sign And Sound** — slug `SNS` (use another brand if SNS has no data; report which you used).

**Recent shipped capabilities to verify (do not assume — confirm on live UI):**

- **Research briefs** — named `{Brand} · {title} · {date}`; rename via brief editor; metadata (platforms, age window)
- **Market intelligence synthesis** — aggregated patterns across posts (executive summary, winning patterns with **2+ posts**, lane overviews, hashtag share %); not one card per scraped row
- **Ideas cart** — badge in sidebar; compact tiles; format tabs; TP thumbnails; replica / why-mimic pickers
- **Brand profile** — structured fields + “Advanced settings” modal (embedded admin project settings)
- **Marketer content workbench** — title-first review at `/brand/[slug]/content`; operator debug hidden unless `?debug=1`
- **Welcome onboarding modal** — funnel explainer on first visit

**Known partial / out-of-scope (report honestly, suggest future UX):**

- “Create content” production flow from ideas cart → jobs (may still require operator pipeline)
- Global progress bar across funnel steps
- Performance page may be lighter than other sections

---

# Base URL & access

**Base URL:** `https://caf-core.fly.dev`

If `/agent-map` or `/api/agent/*` return 404, report that **agent inspection is disabled** (`AGENT_INSPECTION_ENABLED` on server). Stop Phase 1 API steps; continue with visual crawl only and note reduced evidence.

Optional token (if configured): append `?token=YOUR_TOKEN` to inspection URLs.

**Marketer mode rules for crawl:**

- Do **not** append `?debug=1` unless explicitly testing operator leakage.
- Dismiss “Welcome to CAF” if shown; note whether it helps or blocks.
- Use brand switcher if multiple brands exist.

---

# Phase 1 — Machine-readable structure (do first)

Fetch and summarize before visual crawl:

| URL | Purpose |
|-----|---------|
| `https://caf-core.fly.dev/api/agent/health` | **Start here** — Core + Review sidecar ready; retry on 502/503 |
| `https://caf-core.fly.dev/agent-map` | Route index + brand slugs |
| `https://caf-core.fly.dev/api/agent/snapshot` | Full structure JSON (brands, counts, routes) |
| `https://caf-core.fly.dev/api/agent/queue?project=SNS&tab=in_review&page=1&limit=25` | Slim content queue manifest |
| `https://caf-core.fly.dev/api/agent/copy-inventory` | Visible labels inventory |
| `https://caf-core.fly.dev/api/agent/technical-terms` | Jargon leakage scan |

Per-page JSON (replace `SNS` with audited slug):

```
https://caf-core.fly.dev/api/agent/page?path=/workspace
https://caf-core.fly.dev/api/agent/page?path=/brand/SNS
https://caf-core.fly.dev/api/agent/page?path=/brand/SNS/profile
https://caf-core.fly.dev/api/agent/page?path=/brand/SNS/research
https://caf-core.fly.dev/api/agent/page?path=/brand/SNS/intelligence
https://caf-core.fly.dev/api/agent/page?path=/brand/SNS/ideas
https://caf-core.fly.dev/api/agent/page?path=/brand/SNS/content
https://caf-core.fly.dev/api/agent/page?path=/brand/SNS/publishing
https://caf-core.fly.dev/api/agent/page?path=/brand/SNS/performance
```

From snapshot JSON, note for each brand: queue counts, research/import status, ideas count, onboarding progress, pipeline pills.

---

# Phase 2 — Visual crawl (marketer mode)

Visit every route in Phase 1. For each page record:

- **Load state:** OK / error / empty / partial data
- **Goal clarity:** Can a marketer answer “what do I do here?” in 5 seconds?
- **Primary CTA:** obvious? disabled? missing?
- **Data honesty:** do numbers match snapshot? any “—” or broken thumbnails?
- **`data-agent-id` regions** when describing layout (`sidebar`, `brand-dashboard`, `nav-ideas`, `market-intelligence-page`, etc.)

### Required interactions (if data exists)

| Area | Try this |
|------|----------|
| Workspace | Open a brand card; note stats + warnings |
| Dashboard | Read “Next steps”, pipeline pills, onboarding checklist |
| Profile | Edit a field; open Advanced settings modal |
| Research | Select a brief; note naming, metadata, “start research” copy |
| Intelligence | Switch research brief dropdown; read executive summary + winning patterns — **are patterns aggregated (multi-post) or row dumps?** |
| Intelligence | Check hashtags table (Uses + Share % or Avg score); “Generate ideas” block |
| Ideas | Format sub-tabs; add to cart; open cart drawer |
| Content | Open one item; confirm marketer-friendly chrome (no task_id bar) |
| Publishing | List vs empty state |
| Sidebar | Brand switcher; cart badge; no operator links without debug |

Then visit **`/brand/SNS?debug=1`** once — confirm operator nav appears **only** in debug mode and does not leak into default marketer nav.

---

# Phase 3 — Funnel & flow audit

Trace the marketer journey end-to-end. For each transition, score **Ready / Friction / Broken / Missing**:

```
Profile set → Research started → Brief processed → Intelligence useful → Ideas selectable → Content reviewable → Publishing → Performance
```

Questions to answer:

1. **First-time brand:** Is the path from empty workspace → first research brief clear?
2. **Returning brand:** Does the dashboard surface the right “next step”?
3. **Research → Intelligence:** Does selecting a brief change intelligence content meaningfully?
4. **Intelligence → Ideas:** Does “Generate ideas from research” work or show a blocking message? Is the message actionable?
5. **Ideas → Content:** Is it clear how an idea becomes reviewable content (or that an operator step is still needed)?
6. **Content → Publishing:** Is approved content discoverable for scheduling?
7. **Dead ends:** Any page where the marketer hits jargon, operator instructions, or a wall with no CTA?

---

# Phase 4 — Feature maturity matrix

Rate each section **Mature / Usable / Thin / Stub / Broken** with one sentence of evidence.

| Section | Maturity | Evidence |
|---------|----------|----------|
| Workspace | | |
| Brand dashboard | | |
| Brand profile | | |
| Research | | |
| Market intelligence | | |
| Ideas (+ cart) | | |
| Content (marketer workbench) | | |
| Publishing | | |
| Performance & learning | | |
| Onboarding / empty states | | |
| Operator isolation (`debug=1`) | | |

**Market intelligence quality checklist** (critical — recent rework):

- [ ] Executive summary reads like an overview, not concatenated row labels
- [ ] Winning patterns show **multiple posts** where data allows (not all “1 post”)
- [ ] Hook / pattern titles are distinct (not identical card headers)
- [ ] “What to avoid” contains risks, not praise for top performers
- [ ] By-format lanes have overview **distinct from** bullet list
- [ ] Hashtag table shows useful second metric (share % or avg score)
- [ ] Top performer previews show thumbnails when media exists
- [ ] Deep dive topics are meaningful, not only “General themes”

---

# Phase 5 — Copy, jargon & trust

Cross-check `/api/agent/technical-terms` against what you see on pages.

Flag any marketer-visible:

- `task_id`, `signal pack`, `flow_type`, `run`, `project`, `content job`, `qc_result`, engineering paths
- Operator instructions (“compile signal pack in Processing”, “operator can…”) on default marketer pages
- Misleading status (“Ready” when empty); scary or vague errors
- Scrape/engineering verbs where marketer copy should say “research” / “analyze”

Provide **before → after** copy fixes for the worst 5 instances.

---

# Phase 6 — Visual & UX (abbreviated)

You do not need a full visual audit here — score each page **1–5 polish** and note the worst 3 visual issues globally.

If the stakeholder wants depth, point them to `CHATGPT_UX_AUDIT_PROMPT.md`.

Quick checks:

- Sidebar active states, brand accent usage, card hierarchy
- Empty states: helpful CTA vs blank page
- Loading states: skeleton vs plain text
- Mobile / narrow window (optional): anything unusable?

---

# Hard constraints — do NOT suggest

- Renaming backend entities (`task_id`, `signal_pack_id`, etc.)
- Full IA redesign or removing sidebar structure
- Exposing operator tools in default marketer nav
- Breaking review/workbench functionality for operators (`?debug=1`)
- Re-architecting CAF Core pipeline

**Do suggest:** marketer copy, CTAs, empty states, intelligence presentation, funnel bridges, hiding debug leakage, prioritised P0 fixes.

---

# Required output format

## 1. Executive summary (≤ 15 bullets)

- Overall marketer readiness score **1–10**
- Top 5 **product / flow** issues
- Top 5 **content quality** issues (especially intelligence)
- Top 3 **quick wins** (≤ 1 day each)
- Top 3 **larger bets** (multi-day)

## 2. Environment & crawl log

| Route | Loaded? | Data? | Goal clear? | Polish 1–5 | Notes |
|-------|---------|-------|-------------|------------|-------|

Include: brand audited, inspection APIs OK?, welcome modal seen?

## 3. Feature maturity matrix

(Filled table from Phase 4)

## 4. Funnel flow report

Diagram or numbered path with **Ready / Friction / Broken / Missing** per step.

## 5. Page-by-page findings

For each marketer route:

- **Works well**
- **Issues** (P0 / P1 / P2)
- **Marketer confusion risk**
- **Suggested fix** (specific, actionable)

## 6. Market intelligence deep dive

Dedicated subsection — this area was recently reworked. Pass/fail on checklist above with screenshots described in words.

## 7. Operator leakage report

What appeared without `?debug=1`? What `/api/agent/technical-terms` flagged?

## 8. Copy recommendations

| Location | Current | Recommended | Priority |

## 9. Backlog table

| ID | Title | Area | Priority | Effort S/M/L |

## 10. Evidence appendix

- Key `data-agent-id` anchors
- Snapshot fields cited (counts, brief names)
- What you deliberately did **not** recommend (out of scope)

## 11. Optional follow-up

If visual polish is the next pass, say: “Re-run with `CHATGPT_UX_AUDIT_PROMPT.md` for design-only depth.”

---

# Start here

1. Phase 1 — `/agent-map` + `/api/agent/snapshot` + `technical-terms`
2. Phase 2 — visual crawl (marketer mode, then one `?debug=1` pass)
3. Phases 3–6 — funnel, maturity, intelligence checklist, jargon
4. Write the report in the required output format

Report only what you observe on **live production** — do not invent counts, brief names, or pattern text.
