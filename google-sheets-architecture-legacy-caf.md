# Google Sheets architecture — legacy CAF (rebuild reference)

**Purpose:** Describe how **Google Sheets** were organized in the **previous CAF** setup so a rebuild can reproduce contracts, env wiring, and n8n/CAF Core boundaries. This is **descriptive**, not a mandate to keep Sheets forever.

**Evidence:** Column and tab lists were taken from exports in `Downloads` (xlsx) on **2026-04-05**:  
`Flow Engine (4).xlsx`, `Logging Template.xlsx`, `LEARNING.xlsx`, `CREATION - Runtime (2).xlsx`, `CREATION - Project Config Sheet (3).xlsx`, `VALIDATION (1).xlsx`, `PUBLISHING.xlsx`.  
Folder layout matches **Google Drive** screenshots: shared **`CAFs`** parent, per-project folders (e.g. **SNS**, **Cuisina**).

**Related:** Signal pack **write** logic and **Signal_Packs** column contract → `docs/CAF-REBUILD-PACK-V1.md` §6A and `docs/Write Signal_Pack (2).json`. Review Console **Review Queue** behavior → `AGENTS.md`, `lib/google-sheets.ts`.

---

## 1. Global vs project-specific

| Scope | Location (typical) | Workbooks |
|--------|-------------------|-----------|
| **Global — all projects** | `My Drive / … / CAFs` (root of CAFs, not inside a project folder) | **Flow Engine**, **Logging Template** |
| **Project-specific** | `CAFs / {Project}` (e.g. `CAFs / SNS`) | **CREATION - Runtime**, **CREATION - Project Config Sheet**, **VALIDATION**, **PUBLISHING**, **LEARNING**, **INPUTS**, **PROCESSING**, logs, testing, etc. |

**Flow Engine** is the shared **catalog** of flow definitions, prompts, schemas, carousel templates, QC checklists, and risk policies. Automation (n8n) should resolve prompts and schemas **by id / version** from this workbook for any brand that uses CAF.

**CREATION - Project Config Sheet** and **CREATION - Runtime** are **per project**: they hold strategy defaults, brand/platform/risk rules, allowed flows, prompt version pins, and **runtime** tables (signal packs, candidates, jobs, drafts).

---

## 2. Drive folder picture (legacy)

### 2.1 `CAFs` (parent)

- **Folders:** one per project (e.g. **Cuisina**, **SNS**).
- **Files at this level:** **Flow Engine** (shared), **Logging Template** (master for experiment logging).

### 2.2 `CAFs / SNS` (example project)

Typical files (from your listing):

| Artifact | Role |
|----------|------|
| **INPUTS - Sources for SNS** | Raw or curated **inputs** to processing (not exported here; treat as **INPUT** layer). |
| **PROCESSING - SNS Insights** | Aggregated **insights** (Overall + per-platform summaries). Feeds **Write Signal Pack** (see §6A in rebuild pack). |
| **CREATION - Project Config Sheet** | Strategy, brand, platform, risk, allowed flows, prompt pins, reference posts, HeyGen config. |
| **CREATION - Runtime** | **Signal_Packs**, **Content_Candidates**, **Content_Jobs**, **Job_Drafts**, **Run_Logs** (+ any scratch tabs). |
| **VALIDATION** | **Content_Candidates** (validation copy), **Review Queue**, tags/events/learning memory tabs. |
| **PUBLISHING** | Post-publish **metrics** and outcomes. |
| **LEARNING** | Learning / change proposals (template may be sparse). |
| **SNS Logs**, **Testing**, **Flow Documentation** | Ops, QA, docs — outside the core tab contract below unless you wire them. |

**Note:** **Flow Engine** does **not** live inside the SNS folder; it is **shared** at the **CAFs** level.

---

## 3. Flow Engine (global)

**Single workbook** — used by **every** project.

### Tabs (observed)

| Tab | Purpose (from headers) |
|-----|-------------------------|
| **Flow Definitions** | Registry of `flow_type`: description, category, `supported_platforms`, `output_asset_types`, flags (`requires_signal_pack`, `requires_learning_context`, `requires_brand_constraints`), `required_inputs` / `optional_inputs`, `default_variation_count`, `output_schema_name` / `output_schema_version`, `qc_checklist_*`, `risk_profile_default`, `candidate_row_template`, `notes`. |
| **Prompt Templates** | `prompt_name`, `flow_type`, `prompt_role`, `system_prompt`, `user_prompt_template`, `output_format_rule`, schema linkage, `temperature_default`, `max_tokens_default`, `stop_sequences`, `notes`. |
| **Output Schemas** | `output_schema_name`, `output_schema_version`, `flow_type`, `schema_json`, `required_keys`, `field_types`, `example_output_json`, `parsing_notes`. |
| **Carousel Templates** | `template_key`, `platform`, `default_slide_count`, `engine`, `html_template_name`, `adapter_key`, `config_json`. |
| **QC_Checklists** | Named/versioned checklists per `flow_type`: `check_id`, `check_name`, `check_type`, `field_path`, `operator`, `threshold_value`, `severity`, `blocking`, `failure_message`, `auto_fix_action`, `notes`. |
| **Risk_Policies** | `risk_policy_name` / `risk_policy_version`, `risk_category`, `detection_method`, `detection_terms`, `severity_level`, `default_action`, review flags, `block_publish`, `disclaimer_template_name`, `notes`. |

**Rebuild implication:** Any replacement for “read prompts from Sheet” in **CAF Core** or n8n must preserve **keys** like `flow_type`, `prompt_name`, schema **name/version** pairs, and carousel **`template_key` → `html_template_name` / `adapter_key` / `engine`** so renderer and creation pipelines stay aligned.

---

## 4. CREATION - Project Config Sheet (per project)

### Tabs (observed)

| Tab | Purpose (from headers) |
|-----|-------------------------|
| **Strategy Defaults** | One row per `project`: positioning, goals, pillars, audience, monetization, owner, `notes`. |
| **Brand Constraints** | `tone`, `voice_style`, emoji/banned/mandatory rules, `cta_style_rules`, `risk_level_default`, `manual_review_required`, etc. |
| **Platform Constraints** | Per `project` + `platform`: caption/hook/slide limits, hashtag rules, posting windows, `notes`. |
| **Risk Rules** | Per `project` + `flow_type`: triggers, `risk_level`, `rejection_reason_tag`, escalation, `claim_restrictions`, etc. |
| **Allowed Flow Types** | Which `flow_type` are **enabled**, `default_variation_count`, signal/learning requirements, `allowed_platforms`, schema/QC **versions**, `prompt_template_id`, `priority_weight`. |
| **Prompt versions** | Per `project` + `flow_type`: `prompt_id`, versions (system/user/schema), `temperature`, `max_tokens`, `active`, experiment metadata, dates. |
| **Reference_Posts** | Catalog of external posts used as references. |
| **Viral Format Library** | Rich columns for hooks, patterns, `pattern_structure_json`, `replication_template_json`, metrics, `run_id`, etc. |
| **HEYGEN CONFIG** | `config_key` / `value` / `render_mode` per `project`, `platform`, `flow_type`. |

**Rebuild implication:** Creation-layer n8n (or Core) typically **merges** these rows into job/candidate **context** objects before LLM or render steps.

---

## 5. CREATION - Runtime (per project)

### Tabs (observed)

| Tab | Purpose (from headers) |
|-----|-------------------------|
| **Signal_Packs** | One row per pack: `run_id`, `project`, `created_at`, `source_window`, per-platform `*_summary_json`, `overall_candidates_json`, derived globals (`global_rising_keywords`, …), `total_candidates_count`, `confidence_score_avg`, `notes`, `candidates_created?`. **Spec detail:** `docs/CAF-REBUILD-PACK-V1.md` §6A. |
| **Content_Candidates** | Expanded candidates from signal pack: `candidate_id`, `run_id`, `signal_pack_run_id`, `task_id`, routing (`flow_type`, `carousel_route`, `recommended_route`), `candidate`, `context`, platforms JSON, `format`, `source_sheet`, etc. |
| **Content_Jobs** | Executable jobs: `task_id`, `run_id`, `candidate_id`, `flow_type`, `status`, `recommended_route`, `render_pack_json`, `template_key`, `slides_json`, `skip_write`, `signal_pack_run_id`, etc. |
| **Job_Drafts** | Generation attempts: `draft_id`, `task_id`, `attempt_no`, `revision_round`, `prompt_name` / versions, model, `generated_*` fields, `preview_url`, `created_at`, etc. |
| **Run_Logs** | Aggregate run metadata: `flow_plan_json`, counts, `status`, `error_messages`, `config_version_used`. |
| **Other tabs** | Exports may include scratch tabs (e.g. a single-code cell); safe to ignore for contract definition. |

**Rebuild implication:** **CAF Backend** Review Console does **not** read these tables directly today; it uses **VALIDATION / Review Queue** + **Supabase**. Runtime sheets remain the **n8n orchestration** source of truth until Core migration.

---

## 6. VALIDATION (per project)

### Tabs (observed)

| Tab | Purpose (from headers) |
|-----|-------------------------|
| **Content_Candidates** | Validation-facing snapshot: `candidate_id`, `task_id`, `run_id`, `flow_type`, `slides_json`, `caption`, `hashtags_json`, `qc_status`, `qc_fail_reasons`, `risk_level`, `recommended_route`, `status`, `notes`, schema/QC version columns. |
| **Review Queue** | Human review: `task_id`, `candidate_id`, `run_id`, `project`, `platform`, `flow_type`, `qc_status`, `risk_score`, `recommended_route`, `preview_url`, `generated_*`, `review_status`, `decision`, `rejection_tags`, overrides, `validator`, etc. **This is what CAF Backend gates on** when configured with `GOOGLE_REVIEW_QUEUE_*` (see `AGENTS.md`). |
| **Rejection Tags** | **Observed columns in export:** `proposal_id`, `task_id`, `week_id`, `project`, `target_table`, `target_key`, `current_value`, `proposed_value`, `rationale`, `evidence_reference`, `status`, `approved_by`, `approved_at`. **Note:** The header row reads like a **change-proposal** schema; the tab name is **Rejection Tags**. Treat as **legacy naming drift** — confirm the live sheet’s intent before reusing. |
| **Validation_Events** | Audit trail: `from_status` → `to_status`, `changed_by`, `changed_at`, `rejection_reason_tag`. |
| **Learning Memory** | Weekly rollups: approval/rejection rates, top tags, prompt version stats, `generated_at`. |

---

## 7. PUBLISHING (per project)

| Tab | Purpose (from headers) |
|-----|-------------------------|
| **Publishing_Results** | `candidate_id`, `project`, `platform`, `posted_at`, `metric_date`, engagement fields (`likes`, `comments`, `shares`, `saves`, `watch_time`, `engagement_rate`), `notes`. |

---

## 8. Logging Template (global)

**Single workbook** — master for **experiment / learning logs** (not the same as **Run_Logs** in Runtime).

**Tab Sheet1 (observed):** long-form experiment tracking — `Experiment ID`, `Flow Name`, `Flow Version`, `Experiment Status`, dates, `Hypothesis`, `Intervention Description`, `Change Type`, metrics, `Outcome`, `Decision`, etc.

**Rebuild implication:** Project-specific **{Project} Logs** sheets can mirror this template; automation keys off **Experiment ID** / **Flow Name** as you define.

---

## 9. LEARNING (per project)

**Observed:** tab **Config_Change_Proposals** present in export; **cell grid empty** in the downloaded file. Treat as a **placeholder** for learning-driven config changes until you define rows.

---

## 10. Workbooks not supplied in xlsx (from Drive)

These appear in **SNS** (and likely other projects) but were **not** in the attached exports — document from architecture only:

| Workbook | Role |
|----------|------|
| **INPUTS - Sources for {Project}** | Feeds **PROCESSING** / enrichment. |
| **PROCESSING - {Project} Insights** | **Overall** + platform summary tabs; **Write Signal Pack** reads from here (see §6A). |

---

## 11. Data flow (legacy, sheet-centric)

```
INPUTS (project)
    → PROCESSING / Insights (project)
        → Write Signal Pack → CREATION - Runtime / Signal_Packs
            → Content_Candidates → Content_Jobs → Job_Drafts
                → (render / assets / Supabase — outside this doc)
                    → VALIDATION / Content_Candidates & Review Queue
                        → PUBLISHING / Publishing_Results
```

**Flow Engine (global)** is consulted **throughout** creation (and optionally validation) for prompts, schemas, templates, QC, and risk.

---

## 12. Rebuild checklist (practical)

1. **Create or migrate** **Flow Engine** once; point all projects’ automation at the same file (or API mirror).
2. **Per project:** duplicate **CREATION** (config + runtime), **VALIDATION**, **PUBLISHING**, **LEARNING**, **INPUTS**, **PROCESSING** from templates; rename `{Project}` consistently.
3. **Align spreadsheet IDs** with n8n credentials and env vars (`GOOGLE_*`); ids differ between exports — use **tab + column names** as the stable contract.
4. **Review Queue** tab must match **CAF Backend** expectations (`task_id`, `status` / `review_status`, `submit`, `decision`, overrides) — see `lib/google-sheets.ts` / `AGENTS.md`.
5. **Signal_Packs** row shape must match **Write Signal Pack** (§6A) and the **Create Run** router’s `overall_candidates_json` consumer.

---

*End of legacy Google Sheets architecture reference.*
