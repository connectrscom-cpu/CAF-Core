import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import {
  listFlowDefinitions, getFlowDefinition, upsertFlowDefinition, deleteFlowDefinition,
  listPromptTemplates, getPromptTemplate, upsertPromptTemplate,
  listOutputSchemas, getOutputSchema, upsertOutputSchema,
  listCarouselTemplates, upsertCarouselTemplate,
  listQcChecks, upsertQcCheck,
  listRiskPolicies, upsertRiskPolicy,
  getFullFlowEngine,
} from "../repositories/flow-engine.js";

interface Deps { db: Pool }

export function registerFlowEngineRoutes(app: FastifyInstance, { db }: Deps) {

  // ── Full engine snapshot ───────────────────────────────────────────────
  app.get("/v1/flow-engine", async () => {
    return getFullFlowEngine(db);
  });

  // ── Flow Definitions ──────────────────────────────────────────────────
  app.get("/v1/flow-engine/flows", async () => listFlowDefinitions(db));

  app.get<{ Params: { flow_type: string } }>("/v1/flow-engine/flows/:flow_type", async (req, reply) => {
    const row = await getFlowDefinition(db, req.params.flow_type);
    if (!row) return reply.code(404).send({ ok: false, error: "not found" });
    return row;
  });

  app.put<{ Params: { flow_type: string }; Body: Record<string, unknown> }>(
    "/v1/flow-engine/flows/:flow_type", async (req) => {
      const body = req.body as Record<string, unknown>;
      return upsertFlowDefinition(db, {
        flow_type: req.params.flow_type,
        description: (body.description as string) ?? null,
        category: (body.category as string) ?? null,
        supported_platforms: (body.supported_platforms as string) ?? null,
        output_asset_types: (body.output_asset_types as string) ?? null,
        requires_signal_pack: body.requires_signal_pack !== false,
        requires_learning_context: body.requires_learning_context !== false,
        requires_brand_constraints: body.requires_brand_constraints !== false,
        required_inputs: (body.required_inputs as string) ?? null,
        optional_inputs: (body.optional_inputs as string) ?? null,
        default_variation_count: (body.default_variation_count as number) ?? 1,
        output_schema_name: (body.output_schema_name as string) ?? null,
        output_schema_version: (body.output_schema_version as string) ?? null,
        qc_checklist_name: (body.qc_checklist_name as string) ?? null,
        qc_checklist_version: (body.qc_checklist_version as string) ?? null,
        risk_profile_default: (body.risk_profile_default as string) ?? null,
        candidate_row_template: (body.candidate_row_template as string) ?? null,
        notes: (body.notes as string) ?? null,
        active: body.active !== false,
      });
    });

  app.delete<{ Params: { flow_type: string } }>("/v1/flow-engine/flows/:flow_type", async (req, reply) => {
    const ok = await deleteFlowDefinition(db, req.params.flow_type);
    if (!ok) return reply.code(404).send({ ok: false, error: "not found" });
    return { ok: true };
  });

  // ── Prompt Templates ──────────────────────────────────────────────────
  app.get("/v1/flow-engine/prompts", async (req) => {
    const flow = (req.query as Record<string, string>).flow_type;
    return listPromptTemplates(db, flow);
  });

  app.get<{ Params: { prompt_name: string; flow_type: string } }>(
    "/v1/flow-engine/prompts/:flow_type/:prompt_name", async (req, reply) => {
      const row = await getPromptTemplate(db, req.params.prompt_name, req.params.flow_type);
      if (!row) return reply.code(404).send({ ok: false, error: "not found" });
      return row;
    });

  app.put<{ Body: Record<string, unknown> }>("/v1/flow-engine/prompts", async (req) => {
    const b = req.body as Record<string, unknown>;
    return upsertPromptTemplate(db, {
      prompt_name: b.prompt_name as string,
      flow_type: b.flow_type as string,
      prompt_role: (b.prompt_role as string) ?? "generator",
      system_prompt: (b.system_prompt as string) ?? null,
      user_prompt_template: (b.user_prompt_template as string) ?? null,
      output_format_rule: (b.output_format_rule as string) ?? null,
      output_schema_name: (b.output_schema_name as string) ?? (b.schema_name as string) ?? null,
      output_schema_version: (b.output_schema_version as string) ?? (b.schema_version as string) ?? null,
      temperature_default: (b.temperature_default as number) ?? null,
      max_tokens_default: (b.max_tokens_default as number) ?? null,
      stop_sequences: (b.stop_sequences as string) ?? null,
      notes: (b.notes as string) ?? null,
      active: b.active !== false,
    });
  });

  // ── Output Schemas ────────────────────────────────────────────────────
  app.get("/v1/flow-engine/schemas", async (req) => {
    const flow = (req.query as Record<string, string>).flow_type;
    return listOutputSchemas(db, flow);
  });

  app.put<{ Body: Record<string, unknown> }>("/v1/flow-engine/schemas", async (req) => {
    const b = req.body as Record<string, unknown>;
    return upsertOutputSchema(db, {
      output_schema_name: b.output_schema_name as string,
      output_schema_version: b.output_schema_version as string,
      flow_type: b.flow_type as string,
      schema_json: (b.schema_json as Record<string, unknown>) ?? {},
      required_keys: (b.required_keys as string) ?? null,
      field_types: (b.field_types as string) ?? null,
      example_output_json: (b.example_output_json as Record<string, unknown>) ?? null,
      parsing_notes: (b.parsing_notes as string) ?? null,
      active: b.active !== false,
    });
  });

  // ── Carousel Templates ────────────────────────────────────────────────
  app.get("/v1/flow-engine/carousel-templates", async () => listCarouselTemplates(db));

  app.put<{ Body: Record<string, unknown> }>("/v1/flow-engine/carousel-templates", async (req) => {
    const b = req.body as Record<string, unknown>;
    return upsertCarouselTemplate(db, {
      template_key: b.template_key as string,
      platform: (b.platform as string) ?? null,
      default_slide_count: (b.default_slide_count as number) ?? null,
      engine: (b.engine as string) ?? "handlebars",
      html_template_name: (b.html_template_name as string) ?? null,
      adapter_key: (b.adapter_key as string) ?? null,
      config_json: (b.config_json as Record<string, unknown>) ?? {},
      notes: (b.notes as string) ?? null,
      active: b.active !== false,
    });
  });

  // ── QC Checklists ─────────────────────────────────────────────────────
  app.get("/v1/flow-engine/qc-checks", async (req) => {
    const flow = (req.query as Record<string, string>).flow_type;
    return listQcChecks(db, flow);
  });

  app.put<{ Body: Record<string, unknown> }>("/v1/flow-engine/qc-checks", async (req) => {
    const b = req.body as Record<string, unknown>;
    return upsertQcCheck(db, {
      check_id: b.check_id as string,
      check_name: (b.check_name as string) ?? null,
      check_type: (b.check_type as string) ?? null,
      field_path: (b.field_path as string) ?? null,
      operator: (b.operator as string) ?? null,
      threshold_value: (b.threshold_value as string) ?? null,
      severity: (b.severity as string) ?? "MEDIUM",
      blocking: (b.blocking as boolean) ?? false,
      failure_message: (b.failure_message as string) ?? null,
      auto_fix_action: (b.auto_fix_action as string) ?? null,
      flow_type: (b.flow_type as string) ?? null,
      notes: (b.notes as string) ?? null,
      active: b.active !== false,
    });
  });

  // ── Risk Policies ─────────────────────────────────────────────────────
  app.get("/v1/flow-engine/risk-policies", async () => listRiskPolicies(db));

  app.put<{ Body: Record<string, unknown> }>("/v1/flow-engine/risk-policies", async (req) => {
    const b = req.body as Record<string, unknown>;
    return upsertRiskPolicy(db, {
      risk_policy_name: b.risk_policy_name as string,
      risk_policy_version: b.risk_policy_version as string,
      risk_category: (b.risk_category as string) ?? null,
      detection_method: (b.detection_method as string) ?? null,
      detection_terms: (b.detection_terms as string) ?? null,
      severity_level: (b.severity_level as string) ?? "MEDIUM",
      default_action: (b.default_action as string) ?? "route_to_manual",
      requires_manual_review: (b.requires_manual_review as boolean) ?? true,
      block_publish: (b.block_publish as boolean) ?? false,
      disclaimer_template_name: (b.disclaimer_template_name as string) ?? null,
      notes: (b.notes as string) ?? null,
      active: b.active !== false,
    });
  });
}
