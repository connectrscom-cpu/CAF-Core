# CAF inputs → signal pack → RTP roadmap

This backlog tracks **CAF Core** (APIs + Admin). The **Review** app stays focused on human review, publishing, and learning — not inputs processing operators.

## Product split

| Surface | Role |
|--------|------|
| **CAF Core Admin** (`/admin/inputs`, `/admin/processing`; legacy `/admin/inputs-processing` → redirect) | Upload/history; pre-LLM + broad + top-performer (image, carousel, video) insights; profile, build signal pack, audit, RTP, QC flow profiles, insights packs. |
| **Review → Pipeline** | Light touch only: upload evidence XLSX into Core, browse imports, **inspect** signal-pack ideas for editorial context next to review work. No processing controls here. |

## Done (Core + Admin)

- **027** — `inputs_evidence_imports` / `inputs_evidence_rows` (XLSX ingest, dedupe keys).
- **028** — Row ratings + `inputs_processing_profiles` (criteria, models, caps, min score).
- **029** — Import/row health fields, selection snapshot on import, `signal_packs.source_inputs_import_id`, `runs.plan_summary_json`, `insights_packs`, `qc_flow_profiles`; health + selection in build path.
- **Evidence upload API** — `POST /v1/inputs-evidence/upload`, list/detail/rows.
- **Processing API** — `GET/PUT …/profile`, import stats (`recompute_health`), `POST …/build-signal-pack`, audit, insights packs list, RTP summary, QC flow profiles CRUD.
- **Rating + synthesis** — OpenAI batch scoring → persisted rating columns → synthesis to `overall_candidates_json` (planner contract aligned with XLSX packs).
- **Admin UI** — **Inputs** vs **Processing** (sidebar); Processing segments: Evidence, broad insights per platform, top performers (image / carousel / video), profile & audit.
- **030–032** — `inputs_evidence_row_insights`: tiers `broad_llm`, `top_performer_deep`, `top_performer_video`, `top_performer_carousel` (migrations **030**, **031**, **032**).

### Stage 2 (evidence insights) — complete

Row-level LLM passes are in place: text broad, single-image vision, multi-slide carousel vision, sampled-frame + transcript video. Admin can run each tier and list results by platform (`evidence_kind` on insights API).

### Stage 3 (before signal pack) — ideas

**Ideas** are a structured list (many items) stored on or beside the signal pack. When a run creates **candidates**, the system mixes **project configuration constraints** with **selected ideas**: either an LLM chooses which ideas fit the run context, or a **human** picks them in admin/review. Implementation TBD (schema + UI + prompt contract).

## Done (Review, minimal)

- Pipeline: **upload + list imports + inspect evidence rows**; **list + inspect signal-pack ideas** — proxies only for evidence/signal-pack reads (and upload). Processing endpoints are **not** mirrored in Review.

## Next — richer scoring & planner audit (Core)

- **Overall idea scoring in Core** — Explainable breakdown beyond LLM pre-score; eligibility gates (brand, risk).
- **Persist planner selection** — Snapshot of `decideGenerationPlan` input/output per run (unify with existing decision traces).
- **Candidate row linkage** — Optional `caf_core.candidates` or exports from `generation_payload` for audit.

## Next — summaries & RTP depth (Core)

- **HTML / platform summaries** — Optional pass: fold `HTML_Findings_Summary` + registry rows into `html_summary_json` / `reddit_summary_json` for richer planner context (non-breaking if null).
- **RTP by edit category** — Structured edit tracking (script / timing / template / assets) + dashboards vs carousel/video targets (beyond current strict RTP buckets).

## Ops

- Run migrations: `npm run migrate` (or rely on `CAF_RUN_MIGRATIONS_ON_START`).
