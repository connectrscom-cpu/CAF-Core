# ChatGPT Agent Mode — CAF Core Platform State Audit

Copy everything below the line into **ChatGPT agent mode** (or a Custom GPT with browsing). Use this for a **holistic review of CAF’s current product state** — marketer workspace, operator tools, pipeline completeness, and live data — not just visual polish.

For a **deep marketer UX/visual design audit**, use **`CHATGPT_UX_AUDIT_PROMPT.md`** instead (or run both and merge findings).

**Prerequisite:** Production should have agent inspection enabled (`https://caf-core.fly.dev/agent-map` loads). Optional: upload **Tier 1** files from `docs/EXTERNAL_CONTEXT_PACK.md` to the ChatGPT project so the agent understands CAF’s domain model and invariants.

---

# Mission

You are auditing **CAF Core as deployed today** — the full content automation platform (Fastify API + embedded Review/Admin UI on Fly).

Your job is to:

1. **Establish what exists and works** on production (live crawl + inspection APIs).
2. **Map the product funnel** from research → intelligence → ideas → content → publish → learning for a real brand.
3. **Separate marketer vs operator experiences** — what a brand owner sees vs what an editor/engineer needs.
4. **Identify gaps, stubs, broken flows, jargon leakage, and priority fixes** — product and UX, not a backend rewrite proposal.

**Use CAF domain knowledge** (Signal Pack → Jobs → QC → Render → Review → Publish → Learn; `task_id` as execution key) only to judge **whether the UI reflects the pipeline honestly**. Do not recommend renaming IDs, lifecycle enums, or API contracts unless you flag a **user-visible bug** caused by them.

**Do not invent metrics, job counts, or feature availability.** Report only what you observe on production or in inspection JSON.

---

# What CAF is (audit lens)

| Layer | Where | Who uses it |
|-------|--------|-------------|
| **Marketer workspace** | `/workspace`, `/brand/{slug}/*` | Brand owners / marketers |
| **Operator review** | `/admin/workbench`, `/review`, `/t/{task_id}` | Editors, ops |
| **Inputs & processing** | `/pipeline`, `/admin/processing`, `/admin/inputs-processing` | Ops, engineers |
| **Publishing** | `/publish`, `/brand/{slug}/publishing` | Ops + marketers |
| **Learning** | `/learning`, `/brand/{slug}/performance` | Ops + marketers |
| **Core API** | `/v1/*`, `/health` | Integrations (probe only) |

**Canonical production URL:** `https://caf-core.fly.dev`

**Primary audit brand:** Sign And Sound — slug **`SNS`** (use another active brand if SNS is missing).

Optional inspection token (if configured): append `?token=YOUR_TOKEN` or header `x-agent-inspection-token` on `/agent-map` and `/api/agent/*`.

---

# Phase 0 — Context (if not already in project)

Skim or confirm understanding of:

- Pipeline funnel and entities (`task_id`, run, signal pack, content job)
- Marketer journey: Profile → Research → Intelligence → Ideas → Content → Publishing → Performance
- Operator journey: Inputs → Processing → Run → Review queue → Publish → Learning

If agent APIs return `404`, note that inspection is disabled and rely on visual crawl + public health endpoints only.

---

# Phase 1 — Machine-readable structure (do first)

Fetch and summarize:

0. `https://caf-core.fly.dev/api/agent/health` — **must return `ok: true`** before other steps; retry on 502/503
1. `https://caf-core.fly.dev/agent-map`
2. `https://caf-core.fly.dev/api/agent/snapshot`
3. `https://caf-core.fly.dev/api/agent/queue?project=SNS&tab=in_review&page=1&limit=25` — slim queue (not bulk `/v1/review-queue/...`)
4. `https://caf-core.fly.dev/api/agent/copy-inventory`
5. `https://caf-core.fly.dev/api/agent/technical-terms`
6. Per-page descriptors — `https://caf-core.fly.dev/api/agent/page?path=PATH` for:

| Path | Surface |
|------|---------|
| `/workspace` | All brands |
| `/brand/SNS` | Brand dashboard |
| `/brand/SNS/profile` | Brand profile |
| `/brand/SNS/research` | Research |
| `/brand/SNS/intelligence` | Market intelligence |
| `/brand/SNS/ideas` | Ideas |
| `/brand/SNS/content` | Content / review |
| `/brand/SNS/publishing` | Marketer publishing view |
| `/brand/SNS/performance` | Performance & learning |

From **snapshot**, capture:

- `data_source` (`live_core_api` vs `static_route_map`) — if static, live metrics may be stale
- `brands` list and onboarding-style stats per brand
- `dashboard_example`: overview metrics, recommended next steps, pipeline status rows
- `technical_terms_visible` — jargon that should not appear for marketers
- `route_descriptions` — compare to what you see when crawling

**Optional local export (for humans):** from `apps/review`, `AGENT_BASE_URL=https://caf-core.fly.dev npm run agent:audit-export` writes `agent-artifacts/CAF_REVIEW_AGENT_AUDIT_CONTEXT.md`.

---

# Phase 2 — Platform health probes (read-only)

Visit or fetch (no mutations):

| URL | What to check |
|-----|----------------|
| `https://caf-core.fly.dev/health` | Core API up |
| `https://caf-core.fly.dev/health/rendering` | Renderer reachability (if exposed) |
| `https://caf-core.fly.dev/robots.txt` | Expected disallow |

If you can call APIs safely (GET only, no secrets):

- `GET /v1/projects` — active projects/brands
- `GET /v1/review-queue/SNS/counts` — queue depth (operator signal)
- `GET /v1/market-intelligence/SNS/signal-pack/{packId}` — only if you discover a pack ID from the UI/API; note synthesis quality

Report failures as **P0 infrastructure** issues.

---

# Phase 3 — Marketer workspace crawl (default mode, no `?debug=1`)

Dismiss “Welcome to CAF” onboarding if shown; note whether it helps first-time users.

Crawl every Phase 1 marketer route. For each page record:

- **Goal clarity** — does a non-technical marketer know what to do next?
- **Data freshness** — empty vs populated; do numbers match snapshot?
- **Pipeline alignment** — does dashboard “next steps” match section reality?
- **Copy quality** — operator jargon, scary errors, misleading labels
- **Blocking issues** — dead ends, 404s, infinite loading, broken actions

Use **`data-agent-id`** when describing UI (`sidebar`, `brand-dashboard`, `overview-metrics`, `intel-executive`, etc.).

**Funnel trace (SNS):** try to follow the intended path:

Profile (complete?) → Research (brief exists?) → Intelligence (synthesized overview vs raw rows?) → Ideas → Content (open one item if present) → Publishing → Performance.

Note where the funnel **breaks or requires operator intervention** (e.g. “complete processing first”, missing import link, ideas not in pack).

---

# Phase 4 — Operator & admin crawl (separate pass)

These routes are **not** in `/api/agent/page` — visual crawl only.

| URL | Purpose |
|-----|---------|
| `https://caf-core.fly.dev/admin/workbench` | Canonical review queue / workbench |
| `https://caf-core.fly.dev/review` | Review console entry |
| `https://caf-core.fly.dev/pipeline?project=SNS` | Inputs imports & signal packs |
| `https://caf-core.fly.dev/runs` | Run list |
| `https://caf-core.fly.dev/publish?project=SNS` | Publication placements |
| `https://caf-core.fly.dev/learning?project=SNS` | Project learning |
| `https://caf-core.fly.dev/admin/processing?project=SNS` | Processing controls |
| `https://caf-core.fly.dev/admin/inputs-processing?project=SNS` | Evidence → pack pipeline |

For each, assess:

- Can an operator **complete the loop** without raw SQL/CLI?
- Is navigation discoverable from marketer vs admin silos?
- Accidental **operator UI leakage** into marketer nav (or vice versa)?
- Review workbench: filters, task open, approve/reject path still usable?

Open **one task** from workbench if jobs exist (`/t/{task_id}` or content detail). Note mimic/carousel/video affordances at a high level — do not audit pixel-perfect render QA.

---

# Phase 5 — Product maturity matrix

Score each capability for brand **SNS** (or best available brand):

| Stage | Marketer UI | Operator UI | End-to-end wired? | Quality (1–5) | Notes |
|-------|-------------|-------------|---------------------|---------------|-------|
| Brand profile | | | | | |
| Research / scrape | | | | | |
| Market intelligence | | | | | |
| Ideas | | | | | |
| Content generation | | | | | |
| Human review | | | | | |
| Publishing | | | | | |
| Performance / learning | | | | | |

**Implementation status labels** (use consistently):

- **Production-ready** — usable by target user without engineer
- **Partial** — UI exists but blocked, stubbed, or low-quality output
- **Operator-only** — works but not exposed to marketers
- **Missing / broken** — 404, empty, or error state with no path forward

---

# Phase 6 — Intelligence & upstream quality (if SNS has a research brief)

On `/brand/SNS/intelligence`, specifically evaluate **analysis quality** (not just layout):

- Executive summary: synthesized patterns vs repeated single-post blurbs?
- Winning patterns / hooks: multiple posts per pattern or everything “1 post”?
- “What to avoid”: risks vs positive copy misplaced?
- Hashtags: uses + share/score columns populated?
- Generate ideas: blocked by missing import link?

Cross-check whether **`market_intelligence_v1`** synthesis appears to be active (aggregated titles, “Seen across N posts”, pattern strength).

---

# Phase 7 — Cross-cutting review

## Audience & terminology

- Marketer pages free of `task_id`, `flow_type`, `signal pack`, `QC`, `render_state`?
- Consistent use of **Brand** vs **Project** vs slug in UI
- Status labels meaningful (“Ready”, “In progress”, “—”)

## Navigation & IA

- Sidebar: marketer sections vs hidden operator links
- Brand switcher: works across sections?
- Breadcrumbs / back paths on deep pages (task viewer, pack detail)

## Trust & honesty

- Empty states explain **why** empty and **next action**
- Dashboard metrics match section pages
- No fake/demo data presented as live

## Security & scope (observation only)

- No secrets in page source or agent APIs
- Admin routes reachable without auth? (note if public — do not exploit)

---

# Hard constraints — do NOT suggest

- Renaming `task_id`, run ID patterns, or DB schema
- Full platform rewrite or new information architecture from scratch
- Removing operator/admin surfaces
- Breaking review/workbench or generation pipeline contracts
- Speculative features with no UI surface today

**Do suggest:** clearer copy, empty states, funnel unblocking, marketer/operator separation, prioritised product gaps, intelligence UX, onboarding, metric definitions, and **targeted** UI fixes with page references.

---

# Known limitations (do not penalize as bugs unless regressed)

- `/brand/SNS/performance` may be partially stubbed
- Operator debug tools use `?debug=1` intentionally
- Some idea-generation paths still require operator pack compile
- Agent `/api/agent/page` covers marketer routes only
- Learning global digest may be sparse without historical publish data
- Admin HTML UI is functional, not marketer-polished

---

# Required output format

## 1. Executive summary (≤ 15 bullets)

- Platform health (up/down, critical blockers)
- Top 5 **product** gaps blocking marketers
- Top 5 **operator** gaps blocking ops
- Funnel completeness score (1–10) for SNS
- Overall “shippable as marketer product” score (1–10)

## 2. Inspection API summary

- Snapshot `data_source`, brands found, dashboard_example highlights
- Technical terms flagged — agree/disagree with recommendations

## 3. Crawl log

| Route | Loaded? | Audience | Goal clear? | Data live? | Severity | Notes |

Include both marketer and operator routes.

## 4. Funnel walkthrough (SNS)

Step-by-step narrative: what worked, where it stopped, what user would need to do next.

## 5. Product maturity matrix

(Filled table from Phase 5)

## 6. Page-level findings (grouped)

### Marketer workspace

Per route: works | confusing | blocked | P0/P1/P2 fixes

### Operator / admin

Same structure

## 7. Market intelligence quality (if applicable)

Separate subsection if intelligence page has data — analysis vs presentation issues.

## 8. Cross-cutting issues

Terminology, navigation, leakage, metric honesty, onboarding

## 9. Prioritized roadmap

| Priority | Item | User impact | Effort (S/M/L) | Owner hint (product/eng/design) |

## 10. Quick wins vs strategic bets

Two short tables — **product/UX** only (defer visual polish to UX audit prompt).

## 11. Evidence

Reference `data-agent-id`, screenshot descriptions, snapshot JSON fields, example copy snippets.

## 12. Out of scope

What you deliberately did not recommend and why.

## 13. Suggested follow-up audits

- Run `CHATGPT_UX_AUDIT_PROMPT.md` for visual design depth
- Re-run after specific fixes with `?refresh=1` on intelligence API

---

# Execution order

1. Phase 1 — agent-map + snapshot + copy-inventory + technical-terms + page JSON  
2. Phase 2 — health probes  
3. Phase 3 — marketer crawl + funnel trace  
4. Phase 4 — operator/admin crawl  
5. Phase 5–7 — maturity matrix, intelligence quality, cross-cutting  
6. Write report in **Required output format**

Start now with Phase 1.
