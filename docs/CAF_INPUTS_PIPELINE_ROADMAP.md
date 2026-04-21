# CAF inputs → signal pack → RTP roadmap

This backlog tracks **CAF Core** (APIs + Admin). The **Review** app stays focused on human review, publishing, and learning — not inputs processing operators.

## Product split

| Surface | Role |
|--------|------|
| **CAF Core Admin** (`/admin/inputs-processing`) | Profile, caps, models, import stats, health recompute, build signal pack, audit tail, RTP summary, QC flow profiles, insights packs (full operator tooling). |
| **Review → Pipeline** | Light touch only: upload evidence XLSX into Core, browse imports, **inspect** signal-pack ideas for editorial context next to review work. No processing controls here. |

## Done (Core + Admin)

- **027** — `inputs_evidence_imports` / `inputs_evidence_rows` (XLSX ingest, dedupe keys).
- **028** — Row ratings + `inputs_processing_profiles` (criteria, models, caps, min score).
- **029** — Import/row health fields, selection snapshot on import, `signal_packs.source_inputs_import_id`, `runs.plan_summary_json`, `insights_packs`, `qc_flow_profiles`; health + selection in build path.
- **Evidence upload API** — `POST /v1/inputs-evidence/upload`, list/detail/rows.
- **Processing API** — `GET/PUT …/profile`, import stats (`recompute_health`), `POST …/build-signal-pack`, audit, insights packs list, RTP summary, QC flow profiles CRUD.
- **Rating + synthesis** — OpenAI batch scoring → persisted rating columns → synthesis to `overall_candidates_json` (planner contract aligned with XLSX packs).
- **Admin UI** — **Inputs & processing**: Inputs tab (imports, stats, build pack) and Processing tab (profile, audit).

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
