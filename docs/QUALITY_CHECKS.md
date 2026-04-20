# Quality checks (QC)

CAF **QC** is the automated pass over **LLM output** using **checklist rows** stored in Postgres and keyed by **flow type**. It runs in **`src/services/qc-runtime.ts`** after generation (and from pipeline routes).

## What “QC” means here

- **Not** a separate product — it is **`runQcForJob(db, jobId, requireHumanReviewAfterQc)`**.
- **Input:** Parsed **`generation_payload.generated_output`** (JSON object). Carousel flows may be **normalized** before checks (`normalizeLlmParsedForSchemaValidation`).
- **Output:** Updates **`content_jobs`**: **`qc_status`**, **`generation_payload.qc_result`**, **`recommended_route`** (column), **`updated_at`**.

## Data model

| Table | Role |
|-------|------|
| **`caf_core.flow_definitions`** | Per **`flow_type`**: **`qc_checklist_name`**, **`qc_checklist_version`** point to the checklist set. |
| **`caf_core.qc_checklists`** | Rows keyed by **`(qc_checklist_name, qc_checklist_version, check_id)`**: **`check_type`**, **`field_path`**, **`operator`**, **`threshold_value`**, **`blocking`**, **`severity`**, etc. |

Loaded via **`getFlowDefinition`** + **`listQcChecks`** in **`src/repositories/flow-engine.ts`**.

## Check types (implemented)

The runtime **`runCheck`** switch in **`qc-runtime.ts`** supports types such as:

- **`required_keys`** — semicolon-separated **`field_path`** values must resolve.
- **`equals`** — includes **carousel slide-count** logic when the check looks like a slide-count rule (see **`tryCarouselSlideCountEquals`**).
- **`min_length` / `max_length`** — string or array length vs threshold.
- **`regex`** — string field vs pattern in **`threshold_value`**.
- **`not_empty`** — value present and non-trivial.

Unknown **`check_type`** defaults to **pass** (non-blocking).

## Pass / fail semantics

- **`qc_passed`** is false if any **blocking** check fails **or** any risk finding is **CRITICAL** (risk is evaluated in the same function — see **`RISK_RULES.md`** for policies).
- **`qc_score`** = fraction of checklist rows that passed (1 if no checks).

## Recommended route after QC

Derived from checklist failures + risk findings + **`CAF_REQUIRE_HUMAN_REVIEW_AFTER_QC`** (default **true**): even a clean checklist may force **`HUMAN_REVIEW`** instead of **`AUTO_PUBLISH`**.

Special routes: **`BLOCKED`**, **`DISCARD`**, **`REWORK_REQUIRED`**, **`HUMAN_REVIEW`**.

## Payload shape

**`generation_payload.qc_result`** is built by **`buildQcResultPayload`** — includes **`passed`**, **`score`**, **`recommended_route`**, **`reason_short`**, **`reasons`**, optional **`blocking_checks`** / **`blocking_risk_policies`**.

Downstream UIs read this for tooltips and filters.

### Typed subset (Zod) + canonical write path

**`src/domain/generation-payload-qc.ts`** carves out the `qc_result` slice of `generation_payload`:

- **`qcResultSchema`** — Zod schema describing the persisted shape.
- **`mergeGenerationPayloadQc(db, jobId, qc, { qc_status, recommended_route })`** — the single sanctioned writer. Validates with `qcResultSchema.parse`, merges `qc_result` into `generation_payload`, and updates `qc_status` + `recommended_route` in one SQL statement.
- **`pickStoredQcResult`** — tolerant reader that also accepts pre-migration rows.

`runQcForJob` calls `mergeGenerationPayloadQc`; any other path that writes `qc_result` is considered drift.

## Operational notes

- If **`flow_definitions`** has no **`qc_checklist_name`**, **`listQcChecks`** returns **empty** → **qc_score = 1** and only **risk policies + brand bans** apply.
- **Output schema validation** (Flow Engine **`output_schemas`**) is a **separate** step in **`llm-generator.ts`**. Rollout is controlled by **`CAF_OUTPUT_SCHEMA_VALIDATION_MODE`** (**`skip`** / **`warn`** / **`enforce`**); legacy **`CAF_SKIP_OUTPUT_SCHEMA_VALIDATION`** still works as the fallback. Not the same as QC checklist rows.

## Related docs

- [RISK_RULES.md](./RISK_RULES.md) — keyword policies merged into the same `runQcForJob` pass
- [layers/job-pipeline.md](./layers/job-pipeline.md) — when QC runs in the pipeline
- [GENERATION_GUIDANCE.md](./GENERATION_GUIDANCE.md) — separate from QC (prompt injection)
