/**
 * Seed Flow Engine tables from the Flow Engine Excel workbook.
 *
 * Usage:
 *   FLOW_ENGINE_XLSX=path/to/Flow_Engine.xlsx npm run seed:flow-engine
 *
 * Reads sheets: Flow Definitions, Prompt Templates, Output Schemas,
 *               Carousel Templates, QC_Checklists, Risk_Policies
 *
 * DATABASE_URL required. Run after migrate.
 */
import pg from "pg";
import * as XLSX from "xlsx";
import { readFileSync } from "node:fs";
import "dotenv/config";
import { resolveCanonicalFlowType } from "../domain/canonical-flow-types.js";

const OUTPUT_SCHEMA_NAME_TO_CANONICAL: Record<string, string> = {
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

function resolveCanonicalOutputSchemaName(name: string | null): string | null {
  const t = (name ?? "").trim();
  if (!t) return null;
  return OUTPUT_SCHEMA_NAME_TO_CANONICAL[t] ?? t;
}

function namespacedPromptName(flowType: string, promptName: string): string {
  const ft = resolveCanonicalFlowType(flowType);
  const pn = (promptName ?? "").trim();
  if (!pn) return pn;
  if (/^[A-Z0-9_]+__/.test(pn)) return pn;
  const flowKey = String(ft).replace(/^FLOW_/, "");
  return `${flowKey}__${pn}`;
}

function parseBool(val: unknown): boolean {
  if (val === true || val === 1) return true;
  if (typeof val === "string") return val.toLowerCase() === "true" || val === "1";
  return false;
}

function parseNum(val: unknown): number | null {
  if (val == null || val === "") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

function str(val: unknown): string | null {
  if (val == null || val === "") return null;
  return String(val);
}

function sheetToRecords(wb: XLSX.WorkBook, sheetName: string): Record<string, unknown>[] {
  const ws = wb.Sheets[sheetName];
  if (!ws) {
    console.warn(`Sheet "${sheetName}" not found, skipping`);
    return [];
  }
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  return rows;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }

  const xlsxPath = process.env.FLOW_ENGINE_XLSX;
  if (!xlsxPath) {
    console.error("FLOW_ENGINE_XLSX environment variable is required (path to Flow Engine .xlsx)");
    process.exit(1);
  }

  const buffer = readFileSync(xlsxPath);
  const wb = XLSX.read(buffer, { type: "buffer" });
  console.log("Sheets found:", wb.SheetNames);

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    // 1. Flow Definitions
    const flows = sheetToRecords(wb, "Flow Definitions");
    let flowCount = 0;
    for (const row of flows) {
      if (!row.flow_type) continue;
      const candidateRowTpl = str(row.candidate_row_template);
      const candidateRowJson = candidateRowTpl ? JSON.stringify(candidateRowTpl) : null;

      await client.query(`
        INSERT INTO caf_core.flow_definitions (
          flow_type, description, category, supported_platforms, output_asset_types,
          requires_signal_pack, requires_learning_context, requires_brand_constraints,
          required_inputs, optional_inputs, default_variation_count,
          output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
          risk_profile_default, candidate_row_template, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,$18)
        ON CONFLICT (flow_type) DO UPDATE SET
          description = EXCLUDED.description, category = EXCLUDED.category,
          supported_platforms = EXCLUDED.supported_platforms, output_asset_types = EXCLUDED.output_asset_types,
          requires_signal_pack = EXCLUDED.requires_signal_pack, requires_learning_context = EXCLUDED.requires_learning_context,
          requires_brand_constraints = EXCLUDED.requires_brand_constraints,
          required_inputs = EXCLUDED.required_inputs, optional_inputs = EXCLUDED.optional_inputs,
          default_variation_count = EXCLUDED.default_variation_count,
          output_schema_name = EXCLUDED.output_schema_name, output_schema_version = EXCLUDED.output_schema_version,
          qc_checklist_name = EXCLUDED.qc_checklist_name, qc_checklist_version = EXCLUDED.qc_checklist_version,
          risk_profile_default = EXCLUDED.risk_profile_default, candidate_row_template = EXCLUDED.candidate_row_template,
          notes = EXCLUDED.notes, updated_at = now()
      `, [
        str(resolveCanonicalFlowType(String(row.flow_type))), str(row.description), str(row.category), str(row.supported_platforms),
        str(row.output_asset_types), parseBool(row.requires_signal_pack),
        parseBool(row.requires_learning_context), parseBool(row.requires_brand_constraints),
        str(row.required_inputs), str(row.optional_inputs), parseNum(row.default_variation_count) ?? 1,
        resolveCanonicalOutputSchemaName(str(row.output_schema_name)), str(row.output_schema_version),
        str(row.qc_checklist_name), str(row.qc_checklist_version),
        str(row.risk_profile_default), candidateRowJson, str(row.notes),
      ]);
      flowCount++;
    }
    console.log(`Flow Definitions: ${flowCount} upserted`);

    // 2. Prompt Templates
    const prompts = sheetToRecords(wb, "Prompt Templates");
    let promptCount = 0;
    for (const row of prompts) {
      if (!row.prompt_name || !row.flow_type) continue;
      const ft = resolveCanonicalFlowType(String(row.flow_type));
      await client.query(`
        INSERT INTO caf_core.prompt_templates (
          prompt_name, flow_type, prompt_role, system_prompt, user_prompt_template,
          output_format_rule, output_schema_name, output_schema_version,
          temperature_default, max_tokens_default, stop_sequences, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (prompt_name, flow_type) DO UPDATE SET
          prompt_role = EXCLUDED.prompt_role, system_prompt = EXCLUDED.system_prompt,
          user_prompt_template = EXCLUDED.user_prompt_template, output_format_rule = EXCLUDED.output_format_rule,
          output_schema_name = EXCLUDED.output_schema_name, output_schema_version = EXCLUDED.output_schema_version,
          temperature_default = EXCLUDED.temperature_default, max_tokens_default = EXCLUDED.max_tokens_default,
          stop_sequences = EXCLUDED.stop_sequences, notes = EXCLUDED.notes, updated_at = now()
      `, [
        str(namespacedPromptName(ft, String(row.prompt_name))), str(ft), str(row.prompt_role) ?? "generator",
        str(row.system_prompt), str(row.user_prompt_template), str(row.output_format_rule),
        resolveCanonicalOutputSchemaName(str(row.output_schema_name)), str(row.output_schema_version),
        parseNum(row.temperature_default), parseNum(row.max_tokens_default),
        str(row.stop_sequences), str(row.notes),
      ]);
      promptCount++;
    }
    console.log(`Prompt Templates: ${promptCount} upserted`);

    // 3. Output Schemas
    const schemas = sheetToRecords(wb, "Output Schemas");
    let schemaCount = 0;
    for (const row of schemas) {
      if (!row.output_schema_name || !row.output_schema_version) continue;
      let schemaJson: Record<string, unknown> = {};
      try {
        if (row.schema_json && typeof row.schema_json === "string") {
          schemaJson = JSON.parse(row.schema_json);
        }
      } catch { /* store as raw string wrapped in object */ 
        schemaJson = { raw: row.schema_json };
      }

      let exampleJson: Record<string, unknown> | null = null;
      try {
        if (row.example_output_json && typeof row.example_output_json === "string") {
          exampleJson = JSON.parse(row.example_output_json);
        }
      } catch {
        exampleJson = { raw: row.example_output_json };
      }

      await client.query(`
        INSERT INTO caf_core.output_schemas (
          output_schema_name, output_schema_version, flow_type, schema_json,
          required_keys, field_types, example_output_json, parsing_notes
        ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8)
        ON CONFLICT (output_schema_name, output_schema_version) DO UPDATE SET
          flow_type = EXCLUDED.flow_type, schema_json = EXCLUDED.schema_json,
          required_keys = EXCLUDED.required_keys, field_types = EXCLUDED.field_types,
          example_output_json = EXCLUDED.example_output_json, parsing_notes = EXCLUDED.parsing_notes,
          updated_at = now()
      `, [
        resolveCanonicalOutputSchemaName(str(row.output_schema_name)), str(row.output_schema_version), str(resolveCanonicalFlowType(String(row.flow_type))),
        JSON.stringify(schemaJson), str(row.required_keys), str(row.field_types),
        exampleJson ? JSON.stringify(exampleJson) : null, str(row.parsing_notes),
      ]);
      schemaCount++;
    }
    console.log(`Output Schemas: ${schemaCount} upserted`);

    // 4. Carousel Templates
    const carousels = sheetToRecords(wb, "Carousel Templates");
    let carouselCount = 0;
    for (const row of carousels) {
      if (!row.template_key) continue;
      let configJson: Record<string, unknown> = {};
      try {
        if (row.config_json && typeof row.config_json === "string") {
          configJson = JSON.parse(row.config_json);
        }
      } catch { configJson = { raw: row.config_json }; }

      const htmlTemplateName = str(row["html_template_name "] ?? row.html_template_name);

      await client.query(`
        INSERT INTO caf_core.carousel_templates (
          template_key, platform, default_slide_count, engine, html_template_name, adapter_key, config_json
        ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
        ON CONFLICT (template_key) DO UPDATE SET
          platform = EXCLUDED.platform, default_slide_count = EXCLUDED.default_slide_count,
          engine = EXCLUDED.engine, html_template_name = EXCLUDED.html_template_name,
          adapter_key = EXCLUDED.adapter_key, config_json = EXCLUDED.config_json, updated_at = now()
      `, [
        str(row.template_key), str(row.platform), parseNum(row.default_slide_count),
        str(row.engine) ?? "handlebars", htmlTemplateName,
        str(row.adapter_key), JSON.stringify(configJson),
      ]);
      carouselCount++;
    }
    console.log(`Carousel Templates: ${carouselCount} upserted`);

    // 5. QC Checklists
    const qcChecks = sheetToRecords(wb, "QC_Checklists");
    let qcCount = 0;
    for (const row of qcChecks) {
      if (!row.check_id) continue;
      await client.query(`
        INSERT INTO caf_core.qc_checklists (
          check_id, check_name, check_type, field_path, operator, threshold_value,
          severity, blocking, failure_message, auto_fix_action, flow_type,
          qc_checklist_name, qc_checklist_version, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
        ON CONFLICT (check_id) DO UPDATE SET
          check_name = EXCLUDED.check_name, check_type = EXCLUDED.check_type,
          field_path = EXCLUDED.field_path, operator = EXCLUDED.operator,
          threshold_value = EXCLUDED.threshold_value, severity = EXCLUDED.severity,
          blocking = EXCLUDED.blocking, failure_message = EXCLUDED.failure_message,
          auto_fix_action = EXCLUDED.auto_fix_action, flow_type = EXCLUDED.flow_type,
          qc_checklist_name = EXCLUDED.qc_checklist_name, qc_checklist_version = EXCLUDED.qc_checklist_version,
          notes = EXCLUDED.notes
      `, [
        str(row.check_id), str(row.check_name), str(row.check_type),
        str(row.field_path), str(row.operator), str(row.threshold_value),
        str(row.severity) ?? "MEDIUM", parseBool(row.blocking),
        str(row.failure_message), str(row.auto_fix_action), str(resolveCanonicalFlowType(String(row.flow_type))),
        str(row.qc_checklist_name), str(row.qc_checklist_version) ?? "1.0", str(row.notes),
      ]);
      qcCount++;
    }
    console.log(`QC Checklists: ${qcCount} upserted`);

    // 6. Risk Policies
    const policies = sheetToRecords(wb, "Risk_Policies");
    let policyCount = 0;
    for (const row of policies) {
      if (!row.risk_policy_name) continue;
      await client.query(`
        INSERT INTO caf_core.risk_policies (
          risk_policy_name, risk_policy_version, risk_category, detection_method, detection_terms,
          severity_level, default_action, requires_manual_review, requires_senior_review,
          block_publish, disclaimer_template_name, notes
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
          risk_category = EXCLUDED.risk_category, detection_method = EXCLUDED.detection_method,
          detection_terms = EXCLUDED.detection_terms, severity_level = EXCLUDED.severity_level,
          default_action = EXCLUDED.default_action, requires_manual_review = EXCLUDED.requires_manual_review,
          requires_senior_review = EXCLUDED.requires_senior_review, block_publish = EXCLUDED.block_publish,
          disclaimer_template_name = EXCLUDED.disclaimer_template_name, notes = EXCLUDED.notes
      `, [
        str(row.risk_policy_name), str(row.risk_policy_version) ?? "1.0",
        str(row.risk_category), str(row.detection_method), str(row.detection_terms),
        str(row.severity_level) ?? "MEDIUM", str(row.default_action) ?? "route_to_manual",
        parseBool(row.requires_manual_review), parseBool(row.requires_senior_review),
        parseBool(row.block_publish), str(row.disclaimer_template_name), str(row.notes),
      ]);
      policyCount++;
    }
    console.log(`Risk Policies: ${policyCount} upserted`);

    await client.query("COMMIT");
    console.log("\nFlow Engine seed complete!");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
