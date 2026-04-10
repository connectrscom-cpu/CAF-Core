/**
 * LLM step: structured video script JSON for HeyGen / scene flows.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { listPromptTemplates } from "../repositories/flow-engine.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { buildCreationPack, interpolateTemplate } from "./llm-generator-helpers.js";
import { resolveFlowEngineTemplateFlowType } from "../domain/canonical-flow-types.js";
import { extractSpokenScriptText } from "./video-gen-fields.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { buildVideoScriptInputJsonString } from "./llm-creation-pack-budget.js";
import {
  appendVideoUserPromptDurationHardFooter,
  withVideoScriptDurationPolicy,
} from "./video-content-policy.js";
import {
  PUBLICATION_SYSTEM_ADDENDUM,
  enrichGeneratedOutputForReview,
  maxHashtagsFromPlatformConstraints,
} from "./publish-metadata-enrich.js";

async function pickVideoScriptTemplate(db: Pool, flowType: string) {
  const resolved = resolveFlowEngineTemplateFlowType(flowType);
  /** Scene-assembly jobs resolve to Video_Scene_Generator; load script rows from that flow first, not scene_bundle rows. */
  const sceneAssemblyJob =
    /FLOW_SCENE|Scene_Assembly|scene_assembly/i.test(flowType) || resolved === "Video_Scene_Generator";
  const scriptSheetFirst = ["Video_Script_Generator", "Video_Script_HeyGen_Avatar"];
  const tail = [flowType, resolved, "FLOW_VIDEO"].filter((x) => !scriptSheetFirst.includes(x));
  const chain = sceneAssemblyJob
    ? [...new Set([...scriptSheetFirst, ...tail])]
    : [...new Set([flowType, resolved, ...scriptSheetFirst, "FLOW_VIDEO"])];
  for (const ft of chain) {
    const templates = await listPromptTemplates(db, ft);
    const tpl =
      templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "video_script") ??
      templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "preparation") ??
      templates.find((t) => /script/i.test(t.prompt_name ?? "")) ??
      templates[0];
    if (tpl?.user_prompt_template) return tpl;
  }
  return null;
}

export async function ensureVideoScriptInPayload(
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
  if (extractSpokenScriptText(gen, 20).length > 0) {
    return { ok: true };
  }

  const tpl = await pickVideoScriptTemplate(db, job.flow_type);
  if (!tpl?.user_prompt_template) {
    return {
      ok: false,
      error:
        "no prompt template for video script (flow_type=" +
        job.flow_type +
        "; import Flow Engine — flow_type Video_Script_Generator)",
    };
  }

  const pack = await buildCreationPack(
    db,
    job.project_id,
    (job.generation_payload.signal_pack_id as string) ?? null,
    (job.generation_payload.candidate_data as Record<string, unknown>) ?? {},
    job.platform,
    job.flow_type
  );

  /**
   * Many Flow Engine templates expect `{{script_input}}` (candidate + optional existing_output).
   * Without it, models drift or ignore candidate context when the template is written around INPUT_JSON.
   */
  const candidateData = (job.generation_payload.candidate_data as Record<string, unknown>) ?? {};
  const templateCtx: Record<string, unknown> = {
    ...pack,
    script_input: buildVideoScriptInputJsonString(candidateData, gen, { includeVideoScript: true }),
  };

  let userPrompt = interpolateTemplate(tpl.user_prompt_template, templateCtx);
  userPrompt = appendVideoUserPromptDurationHardFooter(userPrompt, config, "script_json");

  const baseSys =
    tpl.system_prompt ??
    "Provide spoken_script, visual_direction, hook, cta as fields in one JSON object (markdown fence ok).";
  const resolvedFt = resolveFlowEngineTemplateFlowType(job.flow_type);
  const multiScene =
    /FLOW_SCENE|scene_assembly|Video_Scene_Generator/i.test(job.flow_type) || resolvedFt === "Video_Scene_Generator";

  const llm = await openaiChat(
    apiKey,
    {
      model: config.OPENAI_MODEL,
      system_prompt: `${withVideoScriptDurationPolicy(baseSys, config, { multiScene }).trim()}\n\n${PUBLICATION_SYSTEM_ADDENDUM}`.trim(),
      user_prompt: userPrompt,
      max_tokens: openAiMaxTokens(tpl.max_tokens_default ?? 2500),
    },
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      signalPackId: (job.generation_payload.signal_pack_id as string) ?? null,
      step: `llm_video_script_prep_${job.flow_type}`,
    }
  );

  const parsed = parseJsonObjectFromLlmText(llm.content);
  if (!parsed) {
    return { ok: false, error: "script generator: could not extract JSON object from reply" };
  }

  const merged = { ...gen, ...parsed };
  const scriptText = extractSpokenScriptText(merged, 1);
  if (scriptText.length > 0 && !String(merged.spoken_script ?? "").trim()) {
    merged.spoken_script = scriptText;
  }
  if (extractSpokenScriptText(merged, 20).length === 0) {
    return { ok: false, error: "video script LLM returned no usable spoken_script/script field" };
  }

  const enriched = enrichGeneratedOutputForReview(job.flow_type, merged, {
    maxHashtags: maxHashtagsFromPlatformConstraints(pack.platform_constraints),
  });

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ generated_output: enriched }), job.id]
  );
  return { ok: true };
}
