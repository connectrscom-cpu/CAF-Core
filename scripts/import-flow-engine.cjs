#!/usr/bin/env node
/**
 * Import Flow Engine data from XLSX into CAF Core PostgreSQL.
 * Usage: node scripts/import-flow-engine.cjs [path-to-xlsx]
 */
const XLSX = require("xlsx");
const { Pool } = require("pg");

const XLSX_PATH = process.argv[2] || "C:\\Users\\migue\\Downloads\\Flow Engine (4).xlsx";

const LEGACY_FLOW_TO_CANONICAL = {
  Flow_Carousel_Copy: "FLOW_CAROUSEL",
  Carousel_Angle_Extractor: "FLOW_ANGLE",
  Carousel_Slide_Architecture: "FLOW_STRUCTURE",
  CTA_Generator: "FLOW_CTA",
  Hook_Variations: "FLOW_HOOKS",
  Text_Post_Generator: "FLOW_TEXT",
  Video_Prompt_Generator: "FLOW_VID_PROMPT",
  Video_Script_Generator: "FLOW_VID_SCRIPT",
  Video_Scene_Generator: "FLOW_VID_SCENES",
};

const OUTPUT_SCHEMA_TO_CANONICAL = {
  Carousel_Insight_Output: "OS_CAROUSEL",
  Carousel_Angle_Output: "OS_ANGLE",
  Carousel_Structure_Output: "OS_STRUCTURE",
  CTA_Output: "OS_CTA",
  Hook_Variations_Output: "OS_HOOKS",
  Text_Post_Output: "OS_TEXT",
  Video_Prompt_Output: "OS_VID_PROMPT",
  Video_Script_Output: "OS_VID_SCRIPT",
  Video_Scene_Generator_Output: "OS_VID_SCENES",
  Viral_Format_Output: "OS_VIRAL",
};

const canonFlow = (ft) => {
  const t = (ft ?? "").trim();
  return LEGACY_FLOW_TO_CANONICAL[t] || t;
};
const canonSchema = (n) => {
  const t = (n ?? "").trim();
  return OUTPUT_SCHEMA_TO_CANONICAL[t] || t || null;
};
const namespacedPromptName = (flowType, promptName) => {
  const ft = canonFlow(flowType);
  const pn = (promptName ?? "").trim();
  if (!pn) return pn;
  if (/^[A-Z0-9_]+__/.test(pn)) return pn;
  const key = String(ft).replace(/^FLOW_/, "");
  return `${key}__${pn}`;
};

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  const wb = XLSX.readFile(XLSX_PATH);
  const sheet = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name] || {}, { defval: "" });

  const str = (v) => (v != null && String(v).trim() !== "") ? String(v).trim() : null;
  const num = (v) => (v != null && v !== "") ? Number(v) : null;
  const bool = (v) => v === true || v === "TRUE" || v === "true" || v === 1 || v === "1";

  const toJsonb = (v) => {
    if (v == null || v === "") return "{}";
    const s = String(v).trim();
    if (s.startsWith("{") || s.startsWith("[")) {
      try { JSON.parse(s); return s; } catch { /* fall through */ }
    }
    return JSON.stringify({ template: s });
  };

  // --- Flow Definitions ---
  const flowDefs = sheet("Flow Definitions");
  console.log(`Flow Definitions: ${flowDefs.length} rows`);
  for (const r of flowDefs) {
    if (!r.flow_type) continue;
    await pool.query(`
      INSERT INTO caf_core.flow_definitions (
        flow_type, description, category, supported_platforms, output_asset_types,
        requires_signal_pack, requires_learning_context, requires_brand_constraints,
        required_inputs, optional_inputs, default_variation_count,
        output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
        risk_profile_default, candidate_row_template, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
      ON CONFLICT (flow_type) DO UPDATE SET
        description=EXCLUDED.description, category=EXCLUDED.category,
        supported_platforms=EXCLUDED.supported_platforms, output_asset_types=EXCLUDED.output_asset_types,
        requires_signal_pack=EXCLUDED.requires_signal_pack, requires_learning_context=EXCLUDED.requires_learning_context,
        requires_brand_constraints=EXCLUDED.requires_brand_constraints,
        required_inputs=EXCLUDED.required_inputs, optional_inputs=EXCLUDED.optional_inputs,
        default_variation_count=EXCLUDED.default_variation_count,
        output_schema_name=EXCLUDED.output_schema_name, output_schema_version=EXCLUDED.output_schema_version,
        qc_checklist_name=EXCLUDED.qc_checklist_name, qc_checklist_version=EXCLUDED.qc_checklist_version,
        risk_profile_default=EXCLUDED.risk_profile_default, candidate_row_template=EXCLUDED.candidate_row_template,
        notes=EXCLUDED.notes, updated_at=now()
    `, [
      str(canonFlow(r.flow_type)), str(r.description), str(r.category), str(r.supported_platforms),
      str(r.output_asset_types), bool(r.requires_signal_pack), bool(r.requires_learning_context),
      bool(r.requires_brand_constraints), str(r.required_inputs), str(r.optional_inputs),
      num(r.default_variation_count) || 1,
      str(canonSchema(r.output_schema_name)), str(r.output_schema_version), str(r.qc_checklist_name),
      str(r.qc_checklist_version), str(r.risk_profile_default), toJsonb(r.candidate_row_template),
      str(r.notes),
    ]);
    console.log(`  ✓ ${r.flow_type}`);
  }

  // --- Prompt Templates ---
  const prompts = sheet("Prompt Templates");
  console.log(`\nPrompt Templates: ${prompts.length} rows`);
  for (const r of prompts) {
    if (!r.prompt_name || !r.flow_type) continue;
    const ft = canonFlow(r.flow_type);
    await pool.query(`
      INSERT INTO caf_core.prompt_templates (
        prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template,
        output_format_rule, schema_name, schema_version,
        temperature_default, max_tokens_default, stop_sequences, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (prompt_name, flow_type) DO UPDATE SET
        prompt_role=EXCLUDED.prompt_role, system_prompt=EXCLUDED.system_prompt,
        user_prompt_template=EXCLUDED.user_prompt_template, output_format_rule=EXCLUDED.output_format_rule,
        schema_name=EXCLUDED.schema_name, schema_version=EXCLUDED.schema_version,
        temperature_default=EXCLUDED.temperature_default, max_tokens_default=EXCLUDED.max_tokens_default,
        stop_sequences=EXCLUDED.stop_sequences, notes=EXCLUDED.notes, updated_at=now()
    `, [
      str(namespacedPromptName(ft, r.prompt_name)), str(ft), str(r.prompt_role),
      str(r.system_prompt), str(r.user_prompt_template), str(r.output_format_rule),
      str(canonSchema(r.output_schema_name)), str(r.output_schema_version),
      num(r.temperature_default), num(r.max_tokens_default),
      str(r.stop_sequences), str(r.notes),
    ]);
    console.log(`  ✓ ${r.prompt_name} → ${r.flow_type}`);
  }

  // --- Output Schemas ---
  const schemas = sheet("Output Schemas");
  console.log(`\nOutput Schemas: ${schemas.length} rows`);
  for (const r of schemas) {
    if (!r.output_schema_name) continue;
    let schemaJson = r.schema_json || "{}";
    let exampleJson = r.example_output_json || null;
    try { if (typeof schemaJson === "string") JSON.parse(schemaJson); } catch { schemaJson = "{}"; }
    try { if (typeof exampleJson === "string" && exampleJson) JSON.parse(exampleJson); } catch { exampleJson = null; }

    await pool.query(`
      INSERT INTO caf_core.output_schemas (
        output_schema_name, output_schema_version, flow_type,
        schema_json, required_keys, field_types, example_output_json, parsing_notes
      ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8)
      ON CONFLICT (output_schema_name, output_schema_version) DO UPDATE SET
        flow_type=EXCLUDED.flow_type, schema_json=EXCLUDED.schema_json,
        required_keys=EXCLUDED.required_keys, field_types=EXCLUDED.field_types,
        example_output_json=EXCLUDED.example_output_json, parsing_notes=EXCLUDED.parsing_notes,
        updated_at=now()
    `, [
      str(canonSchema(r.output_schema_name)), String(r.output_schema_version || "1"), str(canonFlow(r.flow_type)),
      typeof schemaJson === "string" ? schemaJson : JSON.stringify(schemaJson),
      str(r.required_keys), str(r.field_types),
      exampleJson ? (typeof exampleJson === "string" ? exampleJson : JSON.stringify(exampleJson)) : "{}",
      str(r.parsing_notes),
    ]);
    console.log(`  ✓ ${r.output_schema_name} v${r.output_schema_version}`);
  }

  // --- Carousel Templates ---
  const carousels = sheet("Carousel Templates");
  console.log(`\nCarousel Templates: ${carousels.length} rows`);
  for (const r of carousels) {
    if (!r.template_key) continue;
    let configJson = r.config_json || "{}";
    try { if (typeof configJson === "string") JSON.parse(configJson); } catch { configJson = "{}"; }
    const htmlName = str(r["html_template_name "] || r.html_template_name);

    await pool.query(`
      INSERT INTO caf_core.carousel_templates (
        template_key, platform, default_slide_count, engine,
        html_template_name, adapter_key, config_json
      ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
      ON CONFLICT (template_key) DO UPDATE SET
        platform=EXCLUDED.platform, default_slide_count=EXCLUDED.default_slide_count,
        engine=EXCLUDED.engine, html_template_name=EXCLUDED.html_template_name,
        adapter_key=EXCLUDED.adapter_key, config_json=EXCLUDED.config_json, updated_at=now()
    `, [
      str(r.template_key), str(r.platform), num(r.default_slide_count), str(r.engine),
      htmlName, str(r.adapter_key),
      typeof configJson === "string" ? configJson : JSON.stringify(configJson),
    ]);
    console.log(`  ✓ ${r.template_key}`);
  }

  // --- QC Checklists ---
  const qcChecks = sheet("QC_Checklists");
  console.log(`\nQC Checklists: ${qcChecks.length} rows`);
  for (const r of qcChecks) {
    if (!r.check_id) continue;
    await pool.query(`
      INSERT INTO caf_core.qc_checklists (
        check_id, check_name, check_type, field_path, operator, threshold_value,
        severity, blocking, failure_message, auto_fix_action, flow_type, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
      ON CONFLICT (check_id) DO UPDATE SET
        check_name=EXCLUDED.check_name, check_type=EXCLUDED.check_type,
        field_path=EXCLUDED.field_path, operator=EXCLUDED.operator,
        threshold_value=EXCLUDED.threshold_value, severity=EXCLUDED.severity,
        blocking=EXCLUDED.blocking, failure_message=EXCLUDED.failure_message,
        auto_fix_action=EXCLUDED.auto_fix_action, flow_type=EXCLUDED.flow_type,
        notes=EXCLUDED.notes
    `, [
      str(r.check_id), str(r.check_name), str(r.check_type),
      str(r.field_path), str(r.operator), str(r.threshold_value),
      str(r.severity), bool(r.blocking), str(r.failure_message),
      str(r.auto_fix_action), str(canonFlow(r.flow_type)), str(r.notes),
    ]);
    console.log(`  ✓ ${r.check_id}`);
  }

  // --- Risk Policies ---
  const policies = sheet("Risk_Policies");
  console.log(`\nRisk Policies: ${policies.length} rows`);
  for (const r of policies) {
    if (!r.risk_policy_name) continue;
    await pool.query(`
      INSERT INTO caf_core.risk_policies (
        risk_policy_name, risk_policy_version, risk_category, detection_method,
        detection_terms, severity_level, default_action, requires_manual_review,
        block_publish, disclaimer_template_name, notes
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
        risk_category=EXCLUDED.risk_category, detection_method=EXCLUDED.detection_method,
        detection_terms=EXCLUDED.detection_terms, severity_level=EXCLUDED.severity_level,
        default_action=EXCLUDED.default_action, requires_manual_review=EXCLUDED.requires_manual_review,
        block_publish=EXCLUDED.block_publish,
        disclaimer_template_name=EXCLUDED.disclaimer_template_name, notes=EXCLUDED.notes
    `, [
      str(r.risk_policy_name), String(r.risk_policy_version || "1"),
      str(r.risk_category), str(r.detection_method), str(r.detection_terms),
      str(r.severity_level), str(r.default_action), bool(r.requires_manual_review),
      bool(r.block_publish), str(r.disclaimer_template_name), str(r.notes),
    ]);
    console.log(`  ✓ ${r.risk_policy_name}`);
  }

  console.log("\n✅ Flow Engine import complete.");
  await pool.end();
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
