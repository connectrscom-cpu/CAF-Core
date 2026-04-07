/**
 * LLM step: HeyGen-oriented video prompt JSON.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { listPromptTemplates } from "../repositories/flow-engine.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { buildCreationPack, interpolateTemplate } from "./llm-generator-helpers.js";
import { resolveFlowEngineTemplateFlowType } from "../domain/canonical-flow-types.js";
import { extractVideoPromptText } from "./video-gen-fields.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";

async function pickVideoPromptTemplate(db: Pool, flowType: string) {
  const resolved = resolveFlowEngineTemplateFlowType(flowType);
  const chain = [...new Set([flowType, resolved, "Video_Prompt_Generator", "Video_Prompt_HeyGen_Avatar", "FLOW_VIDEO"])];
  for (const ft of chain) {
    const templates = await listPromptTemplates(db, ft);
    const tpl =
      templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "video_prompt") ??
      templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "preparation") ??
      templates.find((t) => /prompt|heygen/i.test(t.prompt_name ?? "")) ??
      templates[0];
    if (tpl?.user_prompt_template) return tpl;
  }
  return null;
}

export async function ensureVideoPromptInPayload(
  db: Pool,
  config: AppConfig,
  jobId: string
): Promise<{ ok: boolean; error?: string }> {
  const apiKey = config.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY not set" };

  const job = await qOne<{
    id: string;
    task_id: string;
    project_id: string;
    run_id: string;
    flow_type: string;
    platform: string | null;
    generation_payload: Record<string, unknown>;
  }>(db, `SELECT * FROM caf_core.content_jobs WHERE id = $1`, [jobId]);
  if (!job) return { ok: false, error: "job not found" };

  const gen = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
  const resolved = extractVideoPromptText(gen, 10);
  if (resolved.length > 0) {
    if (!String(gen.video_prompt ?? "").trim()) {
      const canonical = extractVideoPromptText(gen, 1);
      if (canonical.trim()) {
        const merged = { ...gen, video_prompt: canonical.trim() };
        await db.query(
          `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
          [JSON.stringify({ generated_output: merged }), job.id]
        );
      }
    }
    return { ok: true };
  }

  const tpl = await pickVideoPromptTemplate(db, job.flow_type);
  if (!tpl?.user_prompt_template) {
    return {
      ok: false,
      error:
        "no prompt template for video prompt (flow_type=" +
        job.flow_type +
        "; import Flow Engine — flow_type Video_Prompt_Generator (Flow Definitions + Prompt Templates))",
    };
  }

  const pack = await buildCreationPack(
    db,
    job.project_id,
    (job.generation_payload.signal_pack_id as string) ?? null,
    (job.generation_payload.candidate_data as Record<string, unknown>) ?? {},
    job.platform
  );

  const userPrompt = interpolateTemplate(tpl.user_prompt_template, pack);

  const llm = await openaiChat(
    apiKey,
    {
      model: config.OPENAI_MODEL,
      system_prompt:
        tpl.system_prompt ??
        "Include video_prompt (string) suitable for AI video generation; put fields in one JSON object (markdown fence ok).",
      user_prompt: userPrompt,
      max_tokens: openAiMaxTokens(tpl.max_tokens_default ?? 2000),
    },
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      signalPackId: (job.generation_payload.signal_pack_id as string) ?? null,
      step: `llm_video_prompt_prep_${job.flow_type}`,
    }
  );

  const parsed = parseJsonObjectFromLlmText(llm.content);
  if (!parsed) {
    return { ok: false, error: "prompt generator: could not extract JSON object from reply" };
  }

  const merged = { ...gen, ...parsed };
  const promptText = extractVideoPromptText(merged, 1);
  if (promptText.length > 0 && !String(merged.video_prompt ?? "").trim()) {
    merged.video_prompt = promptText;
  }
  if (extractVideoPromptText(merged, 10).length === 0) {
    return { ok: false, error: "video prompt LLM returned no usable video_prompt field" };
  }

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ generated_output: merged }), job.id]
  );
  return { ok: true };
}
