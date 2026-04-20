import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

// ---------------------------------------------------------------------------
// Flow Definitions
// ---------------------------------------------------------------------------
export interface FlowDefinitionRow {
  id: string;
  flow_type: string;
  description: string | null;
  category: string | null;
  supported_platforms: string | null;
  output_asset_types: string | null;
  requires_signal_pack: boolean;
  requires_learning_context: boolean;
  requires_brand_constraints: boolean;
  required_inputs: string | null;
  optional_inputs: string | null;
  default_variation_count: number;
  output_schema_name: string | null;
  output_schema_version: string | null;
  qc_checklist_name: string | null;
  qc_checklist_version: string | null;
  risk_profile_default: string | null;
  candidate_row_template: string | null;
  notes: string | null;
  active: boolean;
}

export async function listFlowDefinitions(db: Pool): Promise<FlowDefinitionRow[]> {
  return q<FlowDefinitionRow>(db,
    `SELECT * FROM caf_core.flow_definitions ORDER BY flow_type`);
}

export async function getFlowDefinition(db: Pool, flowType: string): Promise<FlowDefinitionRow | null> {
  return qOne<FlowDefinitionRow>(db,
    `SELECT * FROM caf_core.flow_definitions WHERE flow_type = $1`, [flowType]);
}

export async function upsertFlowDefinition(db: Pool, data: Omit<FlowDefinitionRow, "id">): Promise<FlowDefinitionRow> {
  const row = await qOne<FlowDefinitionRow>(db, `
    INSERT INTO caf_core.flow_definitions (
      flow_type, description, category, supported_platforms, output_asset_types,
      requires_signal_pack, requires_learning_context, requires_brand_constraints,
      required_inputs, optional_inputs, default_variation_count,
      output_schema_name, output_schema_version, qc_checklist_name, qc_checklist_version,
      risk_profile_default, candidate_row_template, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
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
    RETURNING *`, [
    data.flow_type, data.description, data.category, data.supported_platforms, data.output_asset_types,
    data.requires_signal_pack, data.requires_learning_context, data.requires_brand_constraints,
    data.required_inputs, data.optional_inputs, data.default_variation_count,
    data.output_schema_name, data.output_schema_version, data.qc_checklist_name, data.qc_checklist_version,
    data.risk_profile_default, data.candidate_row_template, data.notes,
  ]);
  return row!;
}

export async function deleteFlowDefinition(db: Pool, flowType: string): Promise<boolean> {
  const res = await db.query(`DELETE FROM caf_core.flow_definitions WHERE flow_type = $1`, [flowType]);
  return (res.rowCount ?? 0) > 0;
}

// ---------------------------------------------------------------------------
// Prompt Templates
// ---------------------------------------------------------------------------
export interface PromptTemplateRow {
  id: string;
  prompt_name: string;
  flow_type: string;
  prompt_role: string | null;
  system_prompt: string | null;
  user_prompt_template: string | null;
  output_format_rule: string | null;
  output_schema_name: string | null;
  output_schema_version: string | null;
  temperature_default: number | null;
  max_tokens_default: number | null;
  stop_sequences: string | null;
  notes: string | null;
  active: boolean;
}

export async function listPromptTemplates(db: Pool, flowType?: string): Promise<PromptTemplateRow[]> {
  if (flowType) {
    return q<PromptTemplateRow>(db,
      `SELECT * FROM caf_core.prompt_templates WHERE flow_type = $1 ORDER BY prompt_name`, [flowType]);
  }
  return q<PromptTemplateRow>(db,
    `SELECT * FROM caf_core.prompt_templates ORDER BY flow_type, prompt_name`);
}

export async function getPromptTemplate(db: Pool, promptName: string, flowType: string): Promise<PromptTemplateRow | null> {
  return qOne<PromptTemplateRow>(db,
    `SELECT * FROM caf_core.prompt_templates WHERE prompt_name = $1 AND flow_type = $2`,
    [promptName, flowType]);
}

export async function upsertPromptTemplate(db: Pool, data: Omit<PromptTemplateRow, "id">): Promise<PromptTemplateRow> {
  const row = await qOne<PromptTemplateRow>(db, `
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
    RETURNING *`, [
    data.prompt_name, data.flow_type, data.prompt_role, data.system_prompt, data.user_prompt_template,
    data.output_format_rule, data.output_schema_name, data.output_schema_version,
    data.temperature_default, data.max_tokens_default, data.stop_sequences, data.notes,
  ]);
  return row!;
}

// ---------------------------------------------------------------------------
// Output Schemas
// ---------------------------------------------------------------------------
export interface OutputSchemaRow {
  id: string;
  output_schema_name: string;
  output_schema_version: string;
  flow_type: string;
  schema_json: Record<string, unknown>;
  required_keys: string | null;
  field_types: string | null;
  example_output_json: Record<string, unknown> | null;
  parsing_notes: string | null;
  active: boolean;
}

export async function listOutputSchemas(db: Pool, flowType?: string): Promise<OutputSchemaRow[]> {
  if (flowType) {
    return q<OutputSchemaRow>(db,
      `SELECT * FROM caf_core.output_schemas WHERE flow_type = $1 ORDER BY output_schema_name`, [flowType]);
  }
  return q<OutputSchemaRow>(db,
    `SELECT * FROM caf_core.output_schemas ORDER BY flow_type, output_schema_name`);
}

export async function getOutputSchema(db: Pool, name: string, version: string): Promise<OutputSchemaRow | null> {
  return qOne<OutputSchemaRow>(db,
    `SELECT * FROM caf_core.output_schemas WHERE output_schema_name = $1 AND output_schema_version = $2`,
    [name, version]);
}

export async function upsertOutputSchema(db: Pool, data: Omit<OutputSchemaRow, "id">): Promise<OutputSchemaRow> {
  const row = await qOne<OutputSchemaRow>(db, `
    INSERT INTO caf_core.output_schemas (
      output_schema_name, output_schema_version, flow_type, schema_json,
      required_keys, field_types, example_output_json, parsing_notes
    ) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7::jsonb,$8)
    ON CONFLICT (output_schema_name, output_schema_version) DO UPDATE SET
      flow_type = EXCLUDED.flow_type, schema_json = EXCLUDED.schema_json,
      required_keys = EXCLUDED.required_keys, field_types = EXCLUDED.field_types,
      example_output_json = EXCLUDED.example_output_json, parsing_notes = EXCLUDED.parsing_notes,
      updated_at = now()
    RETURNING *`, [
    data.output_schema_name, data.output_schema_version, data.flow_type,
    JSON.stringify(data.schema_json), data.required_keys, data.field_types,
    data.example_output_json ? JSON.stringify(data.example_output_json) : null,
    data.parsing_notes,
  ]);
  return row!;
}

export async function deletePromptTemplate(db: Pool, promptName: string, flowType: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.prompt_templates WHERE prompt_name=$1 AND flow_type=$2`, [promptName, flowType]);
}

export async function deleteOutputSchema(db: Pool, name: string, version: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.output_schemas WHERE output_schema_name=$1 AND output_schema_version=$2`, [name, version]);
}

// ---------------------------------------------------------------------------
// Carousel Templates
// ---------------------------------------------------------------------------
export interface CarouselTemplateRow {
  id: string;
  template_key: string;
  platform: string | null;
  default_slide_count: number | null;
  engine: string | null;
  html_template_name: string | null;
  adapter_key: string | null;
  config_json: Record<string, unknown>;
  notes: string | null;
  active: boolean;
}

export async function listCarouselTemplates(db: Pool): Promise<CarouselTemplateRow[]> {
  return q<CarouselTemplateRow>(db,
    `SELECT * FROM caf_core.carousel_templates ORDER BY template_key`);
}

export async function upsertCarouselTemplate(db: Pool, data: Omit<CarouselTemplateRow, "id">): Promise<CarouselTemplateRow> {
  const row = await qOne<CarouselTemplateRow>(db, `
    INSERT INTO caf_core.carousel_templates (
      template_key, platform, default_slide_count, engine, html_template_name, adapter_key, config_json
    ) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb)
    ON CONFLICT (template_key) DO UPDATE SET
      platform = EXCLUDED.platform, default_slide_count = EXCLUDED.default_slide_count,
      engine = EXCLUDED.engine, html_template_name = EXCLUDED.html_template_name,
      adapter_key = EXCLUDED.adapter_key, config_json = EXCLUDED.config_json, updated_at = now()
    RETURNING *`, [
    data.template_key, data.platform, data.default_slide_count,
    data.engine, data.html_template_name, data.adapter_key,
    JSON.stringify(data.config_json),
  ]);
  return row!;
}

export async function deleteCarouselTemplate(db: Pool, templateKey: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.carousel_templates WHERE template_key=$1`, [templateKey]);
}

// ---------------------------------------------------------------------------
// QC Checklists
// ---------------------------------------------------------------------------
export interface QcChecklistRow {
  id: string;
  check_id: string;
  check_name: string | null;
  check_type: string | null;
  field_path: string | null;
  operator: string | null;
  threshold_value: string | null;
  severity: string | null;
  blocking: boolean;
  failure_message: string | null;
  auto_fix_action: string | null;
  flow_type: string | null;
  notes: string | null;
  active: boolean;
}

export async function listQcChecks(db: Pool, flowType?: string): Promise<QcChecklistRow[]> {
  if (flowType) {
    return q<QcChecklistRow>(db,
      `SELECT * FROM caf_core.qc_checklists WHERE flow_type = $1 ORDER BY check_id`, [flowType]);
  }
  return q<QcChecklistRow>(db, `SELECT * FROM caf_core.qc_checklists ORDER BY flow_type, check_id`);
}

export async function upsertQcCheck(db: Pool, data: Omit<QcChecklistRow, "id">): Promise<QcChecklistRow> {
  const row = await qOne<QcChecklistRow>(db, `
    INSERT INTO caf_core.qc_checklists (
      check_id, check_name, check_type, field_path, operator, threshold_value,
      severity, blocking, failure_message, auto_fix_action, flow_type, notes
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (check_id) DO UPDATE SET
      check_name = EXCLUDED.check_name, check_type = EXCLUDED.check_type,
      field_path = EXCLUDED.field_path, operator = EXCLUDED.operator,
      threshold_value = EXCLUDED.threshold_value, severity = EXCLUDED.severity,
      blocking = EXCLUDED.blocking, failure_message = EXCLUDED.failure_message,
      auto_fix_action = EXCLUDED.auto_fix_action, flow_type = EXCLUDED.flow_type,
      notes = EXCLUDED.notes
    RETURNING *`, [
    data.check_id, data.check_name, data.check_type, data.field_path, data.operator,
    data.threshold_value, data.severity, data.blocking, data.failure_message,
    data.auto_fix_action, data.flow_type, data.notes,
  ]);
  return row!;
}

export async function deleteQcChecklist(db: Pool, checkId: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.qc_checklists WHERE check_id=$1`, [checkId]);
}

// ---------------------------------------------------------------------------
// Risk Policies
// ---------------------------------------------------------------------------
export interface RiskPolicyRow {
  id: string;
  risk_policy_name: string;
  risk_policy_version: string;
  risk_category: string | null;
  detection_method: string | null;
  detection_terms: string | null;
  severity_level: string | null;
  default_action: string | null;
  requires_manual_review: boolean;
  block_publish: boolean;
  disclaimer_template_name: string | null;
  notes: string | null;
  active: boolean;
  /**
   * Optional flow scope. `NULL` = global (applies to every job). When set, the
   * policy only runs for jobs whose `flow_type` matches. See migration
   * `024_risk_policies_scope.sql`.
   */
  applies_to_flow_type: string | null;
}

export async function listRiskPolicies(db: Pool): Promise<RiskPolicyRow[]> {
  return q<RiskPolicyRow>(db,
    `SELECT * FROM caf_core.risk_policies ORDER BY risk_policy_name`);
}

/**
 * Return the policies that should run for a given `flow_type`: the global ones
 * (`applies_to_flow_type IS NULL`) plus any explicitly scoped to that flow.
 *
 * NULL scope is treated as "applies to everything" so pre-migration rows keep
 * their current behavior without any data change.
 */
export async function listRiskPoliciesForJob(db: Pool, flowType: string): Promise<RiskPolicyRow[]> {
  return q<RiskPolicyRow>(db,
    `SELECT * FROM caf_core.risk_policies
     WHERE applies_to_flow_type IS NULL OR applies_to_flow_type = $1
     ORDER BY risk_policy_name`,
    [flowType]);
}

export type RiskPolicyUpsert =
  Omit<RiskPolicyRow, "id" | "applies_to_flow_type">
  & { applies_to_flow_type?: string | null };

export async function upsertRiskPolicy(db: Pool, data: RiskPolicyUpsert): Promise<RiskPolicyRow> {
  const row = await qOne<RiskPolicyRow>(db, `
    INSERT INTO caf_core.risk_policies (
      risk_policy_name, risk_policy_version, risk_category, detection_method, detection_terms,
      severity_level, default_action, requires_manual_review,
      block_publish, disclaimer_template_name, notes, applies_to_flow_type
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (risk_policy_name, risk_policy_version) DO UPDATE SET
      risk_category = EXCLUDED.risk_category, detection_method = EXCLUDED.detection_method,
      detection_terms = EXCLUDED.detection_terms, severity_level = EXCLUDED.severity_level,
      default_action = EXCLUDED.default_action, requires_manual_review = EXCLUDED.requires_manual_review,
      block_publish = EXCLUDED.block_publish,
      disclaimer_template_name = EXCLUDED.disclaimer_template_name, notes = EXCLUDED.notes,
      applies_to_flow_type = EXCLUDED.applies_to_flow_type
    RETURNING *`, [
    data.risk_policy_name, data.risk_policy_version, data.risk_category,
    data.detection_method, data.detection_terms, data.severity_level, data.default_action,
    data.requires_manual_review, data.block_publish,
    data.disclaimer_template_name, data.notes, data.applies_to_flow_type ?? null,
  ]);
  return row!;
}

export async function deleteRiskPolicy(db: Pool, name: string, version: string): Promise<void> {
  await db.query(`DELETE FROM caf_core.risk_policies WHERE risk_policy_name=$1 AND risk_policy_version=$2`, [name, version]);
}

// ---------------------------------------------------------------------------
// Composite: full Flow Engine profile
// ---------------------------------------------------------------------------
export async function getFullFlowEngine(db: Pool) {
  const [flows, prompts, schemas, carousels, qcChecks, policies] = await Promise.all([
    listFlowDefinitions(db),
    listPromptTemplates(db),
    listOutputSchemas(db),
    listCarouselTemplates(db),
    listQcChecks(db),
    listRiskPolicies(db),
  ]);
  return { flows, prompts, schemas, carousels, qc_checks: qcChecks, risk_policies: policies };
}
