# Risk rules and policies

CAF uses **three different concepts** that sound similar. This doc separates them as implemented today.

## 1. `caf_core.risk_policies` (QC runtime — **used**)

**Table:** CAF-wide catalog (**`risk_policy_name`**, **`risk_policy_version`**).  
**Loaded by:** **`listRiskPolicies(db)`** in **`src/repositories/flow-engine.ts`** — currently **`SELECT * FROM caf_core.risk_policies ORDER BY risk_policy_name`** (no filter by flow or project).

**Applied in:** **`src/services/qc-runtime.ts`** → **`runRiskPolicy`**, inside **`runQcForJob`**.

**Mechanism:**

- **`detection_method`** — typically **`keyword`** or **`both`**.
- **`detection_terms`** — semicolon-separated terms; matched against **lower-cased JSON.stringify of `generated_output`** using **`riskDetectionTermMatches`** (word boundaries for single words).
- **Brand overlap:** **`brand_constraints.banned_words`** (per project) are **also** passed as extra terms for the same scan.

**Effects:** Builds **`risk_findings`**; contributes to **`risk_level`** (**CRITICAL** / **HIGH** / **MEDIUM** / **LOW**); can set **`recommended_route`** to **`BLOCKED`**, **`DISCARD`**, **`REWORK_REQUIRED`**, or push **`HUMAN_REVIEW`** based on severity and **`block_publish`**.

**Scope:** As of migration `024_risk_policies_scope.sql`, `risk_policies` has an optional `applies_to_flow_type`. When set, the policy only runs for jobs with that `flow_type`; when `NULL`, the policy is global. `runQcForJob` calls `listRiskPoliciesForJob(db, job.flow_type)` which returns the union (global + flow-scoped). Pre-existing rows default to `NULL` and keep their previous behavior.

---

## 2. `caf_core.risk_rules` (project config — **not used by `qc-runtime`**

**Table:** Per-**`project_id`** and **`flow_type`** rows (migration **`002_project_config_and_runs.sql`**): trigger conditions, risk level, manual review flags, sensitive topics, etc.

**Used for:** Project profile APIs, **CSV import/export** (**`src/routes/project-config.ts`**, **`project-csv-import.ts`**), admin/bootstrap counts.

**Not used for:** Automated keyword QC in **`runQcForJob`**. Grep **`qc-runtime.ts`** — there is **no** query to **`risk_rules`**.

**Implication:** Operators may fill **project risk rules** expecting automated enforcement; **today** enforcement comes from **`risk_policies`** + **brand `banned_words`**, not from this table.

**Surfacing in API responses:** `GET/POST/DELETE /v1/projects/:project_slug/risk-rules` and `POST /v1/admin/config/risk-rule` both attach a stable `risk_qc` notice from `riskRulesNotEnforcedNotice()` (`src/services/risk-qc-status.ts`). The CSV import (`POST /v1/projects/:slug/import`, `importProjectFromCsv`) also appends an entry to `warnings[]` whenever risk_rule rows are applied. UIs should render these prominently.

**Honesty endpoint:** `GET /v1/projects/:project_slug/risk-qc-status` returns the QC sources and a count of the project's `risk_rules`. It is sourced from `src/services/risk-qc-status.ts` → `buildRiskQcStatus`. Shape:

```json
{
  "ok": true,
  "project_slug": "...",
  "qc_uses": ["risk_policies", "brand_banned_words"],
  "project_risk_rules_count": 0,
  "risk_rules_enforced_by_qc": false,
  "has_unenforced_risk_rules": false,
  "message": "...",
  "docs_path": "docs/RISK_RULES.md"
}
```

---

## 3. Brand constraints (`banned_words`)

**Table:** **`caf_core.brand_constraints`** (per project).  
**Field:** **`banned_words`** — typically semicolon-separated.

**QC:** Split and merged into the **same keyword scan** as **`risk_policies`** (**`runRiskPolicy`**).

---

## Summary table

| Source | Scope | Used in automated QC? |
|--------|--------|------------------------|
| **`risk_policies`** | Global CAF catalog | **Yes** — keyword scan on output JSON |
| **`risk_rules`** | Per project + flow | **No** (in current `qc-runtime`) |
| **`brand_constraints.banned_words`** | Per project | **Yes** — merged into policy scan |

## Route changes vs QC

**`recommended_route`** on **`content_jobs`** is updated during QC. **`src/decision_engine/route_selector.ts`** chooses routes at **planning** time from candidate data — a different phase.

## Related docs

- [QUALITY_CHECKS.md](./QUALITY_CHECKS.md) — checklist + risk in one `runQcForJob` pass
- [GENERATION_GUIDANCE.md](./GENERATION_GUIDANCE.md) — not risk enforcement; prompt steering
- [ARCHITECTURE.md](./ARCHITECTURE.md)
