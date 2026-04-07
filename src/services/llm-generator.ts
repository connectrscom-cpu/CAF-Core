/**
 * LLM Generation Service — calls OpenAI to generate content from prompt templates.
 *
 * Given a content_job with a prompt template reference and candidate data,
 * builds the creation_pack context, resolves the prompt template, calls the LLM,
 * optionally validates the output against the output schema (see CAF_SKIP_OUTPUT_SCHEMA_VALIDATION), and stores the result as a job_draft.
 */
import type { Pool } from "pg";
import { qOne } from "../db/queries.js";
import { getPromptTemplate, getOutputSchema, getFlowDefinition } from "../repositories/flow-engine.js";
import { resolveFlowEngineTemplateFlowType } from "../domain/canonical-flow-types.js";
import { validateAgainstOutputSchema } from "./schema-validator.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";
import { randomUUID } from "node:crypto";
import { buildCreationPack, interpolateTemplate } from "./llm-generator-helpers.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { openaiChat } from "./openai-chat.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";

export interface GenerationResult {
  draft_id: string;
  task_id: string;
  raw_output: string;
  parsed_output: Record<string, unknown> | null;
  model_used: string;
  prompt_name: string;
  tokens_used: number;
  success: boolean;
  error?: string;
}

/**
 * Generate content for a single content_job.
 */
export async function generateForJob(
  db: Pool,
  jobId: string,
  apiKey: string,
  model: string = "gpt-4o",
  options?: { skipOutputSchemaValidation?: boolean }
): Promise<GenerationResult> {
  const job = await qOne<{
    id: string; task_id: string; project_id: string; run_id: string;
    candidate_id: string | null; flow_type: string; platform: string | null;
    generation_payload: Record<string, unknown>;
  }>(db, `SELECT * FROM caf_core.content_jobs WHERE id = $1`, [jobId]);

  if (!job) throw new Error(`Job not found: ${jobId}`);

  const payload = job.generation_payload;
  const promptId = String(payload.prompt_id ?? "");
  const promptVersionLabel = String(payload.prompt_version_label ?? "");
  const signalPackId = (payload.signal_pack_id as string) ?? null;
  const candidateData = (payload.candidate_data as Record<string, unknown>) ?? {};

  /** Match Flow Engine workbook `flow_type`; legacy job rows still resolve templates. */
  const templateFlowType = resolveFlowEngineTemplateFlowType(job.flow_type);

  let promptTemplate = promptId
    ? await getPromptTemplate(db, promptId, templateFlowType)
    : null;

  if (!promptTemplate) {
    const fe = await import("../repositories/flow-engine.js");
    const tryTypes = [...new Set([templateFlowType, job.flow_type].filter(Boolean))];
    for (const ft of tryTypes) {
      const templates = await fe.listPromptTemplates(db, ft);
      if (templates.length === 0) continue;
      promptTemplate =
        templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "generator") ??
        templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "preparation") ??
        templates.find((t) => Boolean(t.user_prompt_template?.trim())) ??
        templates[0] ??
        null;
      if (promptTemplate?.user_prompt_template?.trim()) break;
      promptTemplate = null;
    }
  }

  if (!promptTemplate) {
    return {
      draft_id: `d_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      task_id: job.task_id,
      raw_output: "",
      parsed_output: null,
      model_used: model,
      prompt_name: promptId || "unknown",
      tokens_used: 0,
      success: false,
      error: `No prompt template found for flow_type=${job.flow_type} (templates keyed as ${templateFlowType}), prompt_id=${promptId}`,
    };
  }

  const flowDef = await getFlowDefinition(db, templateFlowType);
  let outputSchemaRow = null;
  if (flowDef?.output_schema_name && flowDef?.output_schema_version) {
    outputSchemaRow = await getOutputSchema(db, flowDef.output_schema_name, flowDef.output_schema_version);
  }
  if (!outputSchemaRow && promptTemplate.output_schema_name && promptTemplate.output_schema_version) {
    outputSchemaRow = await getOutputSchema(
      db,
      promptTemplate.output_schema_name,
      promptTemplate.output_schema_version
    );
  }

  const creationPack = await buildCreationPack(db, job.project_id, signalPackId, candidateData, job.platform);

  const systemPrompt =
    promptTemplate.system_prompt ??
    "You are a content generator. When structured output is needed, include one JSON object (bare or markdown ```json fence).";
  const userPrompt = interpolateTemplate(
    promptTemplate.user_prompt_template ?? "Generate content using: {{creation_pack_json}}",
    creationPack
  );

  const maxTokens = openAiMaxTokens(promptTemplate.max_tokens_default, 4000);

  const draftId = `d_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  try {
    const llmResult = await openaiChat(
      apiKey,
      {
        model,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        max_tokens: maxTokens,
      },
      {
        db,
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        signalPackId,
        step: `llm_primary_${templateFlowType}`,
      }
    );

    const parsedRaw = parseJsonObjectFromLlmText(llmResult.content);
    if (!parsedRaw) {
      return {
        draft_id: draftId,
        task_id: job.task_id,
        raw_output: llmResult.content,
        parsed_output: null,
        model_used: llmResult.model,
        prompt_name: promptTemplate.prompt_name,
        tokens_used: llmResult.total_tokens,
        success: false,
        error:
          "Could not extract a JSON object from the model reply (include one {...} or a ```json fenced block).",
      };
    }

    let parsed = normalizeLlmParsedForSchemaValidation(job.flow_type, parsedRaw);
    if (!options?.skipOutputSchemaValidation) {
      const validation = validateAgainstOutputSchema(parsed, outputSchemaRow);
      if (!validation.valid) {
        return {
          draft_id: draftId,
          task_id: job.task_id,
          raw_output: llmResult.content,
          parsed_output: parsed,
          model_used: llmResult.model,
          prompt_name: promptTemplate.prompt_name,
          tokens_used: llmResult.total_tokens,
          success: false,
          error: `Output schema validation failed: ${validation.errors.join("; ")}`,
        };
      }
    }

    await db.query(`
      INSERT INTO caf_core.job_drafts (
        draft_id, task_id, candidate_id, run_id, project_id,
        attempt_no, prompt_name, prompt_version, generated_payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
    `, [
      draftId, job.task_id, job.candidate_id, job.run_id, job.project_id,
      1, promptTemplate.prompt_name, promptVersionLabel || "1.0",
      JSON.stringify({
        raw_output: llmResult.content,
        parsed: parsed,
        model: llmResult.model,
        tokens: llmResult.total_tokens,
      }),
    ]);

    if (parsed) {
      await db.query(`
        UPDATE caf_core.content_jobs
        SET generation_payload = generation_payload || $1::jsonb, updated_at = now()
        WHERE id = $2
      `, [JSON.stringify({ generated_output: parsed, draft_id: draftId }), job.id]);
    }

    return {
      draft_id: draftId,
      task_id: job.task_id,
      raw_output: llmResult.content,
      parsed_output: parsed,
      model_used: llmResult.model,
      prompt_name: promptTemplate.prompt_name,
      tokens_used: llmResult.total_tokens,
      success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      draft_id: draftId,
      task_id: job.task_id,
      raw_output: "",
      parsed_output: null,
      model_used: model,
      prompt_name: promptTemplate.prompt_name,
      tokens_used: 0,
      success: false,
      error: msg,
    };
  }
}
