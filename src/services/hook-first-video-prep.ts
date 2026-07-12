/**
 * Render-time LLM prep for FLOW_VID_HOOK_FIRST — hook_scene_prompt + body spoken_script.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { getBrandConstraints } from "../repositories/project-config.js";
import { listPromptTemplates } from "../repositories/flow-engine.js";
import { resolveFlowEngineTemplateFlowType } from "../domain/canonical-flow-types.js";
import {
  HOOK_FIRST_VIDEO_OUTPUT_ADDENDUM,
  extractHookScenePrompt,
  hookFirstPayloadReady,
  isHookFirstVideoFlow,
  normalizeHookFirstGeneratedOutput,
} from "../domain/hook-first-video.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { buildCreationPack, interpolateTemplate } from "./llm-generator-helpers.js";
import { buildVideoScriptInputJsonString } from "./llm-creation-pack-budget.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import {
  appendVideoUserPromptDurationHardFooter,
  withVideoScriptDurationPolicy,
} from "./video-content-policy.js";
import {
  ensureVideoScriptPublicationMetadata,
  pickVideoScriptTemplate,
  sanitizeVideoDisclaimerForBrand,
  VIDEO_SCRIPT_OUTPUT_CAPTION_ADDENDUM,
  VIDEO_SCRIPT_SCENE_ALIGNMENT_ADDENDUM,
} from "./video-script-generator.js";
import { extractSpokenScriptText } from "./video-gen-fields.js";
import { PUBLICATION_SYSTEM_ADDENDUM } from "./publish-metadata-enrich.js";
import { VIDEO_CAPTION_SYSTEM_ADDENDUM } from "./video-prompt-generator.js";

function mergeBridgeIntoSpokenScript(parsed: Record<string, unknown>): Record<string, unknown> {
  const bridge = String(parsed.bridge_line ?? parsed.hook_bridge ?? "").trim();
  let script = extractSpokenScriptText(parsed, 1).trim();
  if (bridge && script && !script.toLowerCase().startsWith(bridge.toLowerCase().slice(0, 12))) {
    script = `${bridge} ${script}`.replace(/\s+/g, " ").trim();
    return { ...parsed, spoken_script: script, script };
  }
  return parsed;
}

export async function ensureHookFirstVideoInPayload(
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
  if (!isHookFirstVideoFlow(job.flow_type)) {
    return { ok: false, error: `not a hook-first flow: ${job.flow_type}` };
  }

  const gen = normalizeHookFirstGeneratedOutput(pickGeneratedOutputOrEmpty(job.generation_payload));
  const candidate = (job.generation_payload.candidate_data as Record<string, unknown>) ?? {};
  const hookSeed = String(
    gen.hook_scene_prompt ?? gen.hook_opener_concept ?? candidate.hook_opener_concept ?? ""
  ).trim();
  if (hookSeed && !extractHookScenePrompt(gen, 20)) {
    gen.hook_scene_prompt = hookSeed;
  }
  if (hookFirstPayloadReady(gen)) {
    const brand = await getBrandConstraints(db, job.project_id);
    const ready = normalizeHookFirstGeneratedOutput(sanitizeVideoDisclaimerForBrand(gen, brand));
    await db.query(
      `UPDATE caf_core.content_jobs SET generation_payload = $1::jsonb, updated_at = now() WHERE id = $2`,
      [
        JSON.stringify({
          ...job.generation_payload,
          generated_output: ready,
        }),
        job.id,
      ]
    );
    return { ok: true };
  }

  const tpl =
    (await pickVideoScriptTemplate(db, job.flow_type)) ??
    (await pickVideoScriptTemplate(db, resolveFlowEngineTemplateFlowType(job.flow_type)));

  const resolvedFt = resolveFlowEngineTemplateFlowType(job.flow_type);
  const pack = await buildCreationPack(
    db,
    job.project_id,
    (job.generation_payload.signal_pack_id as string) ?? null,
    (job.generation_payload.candidate_data as Record<string, unknown>) ?? {},
    job.platform,
    job.flow_type
  );

  const genOut = pickGeneratedOutputOrEmpty(job.generation_payload);
  const scriptInput = buildVideoScriptInputJsonString(
    (job.generation_payload.candidate_data as Record<string, unknown>) ?? {},
    genOut,
    { includeVideoScript: true }
  );

  let systemPrompt =
    tpl?.system_prompt ??
    "You are a short-form video creative director. Return one JSON object (markdown fence ok).";
  systemPrompt = withVideoScriptDurationPolicy(systemPrompt, config, { multiScene: false });
  systemPrompt = [
    systemPrompt.trim(),
    PUBLICATION_SYSTEM_ADDENDUM,
    VIDEO_CAPTION_SYSTEM_ADDENDUM,
    VIDEO_SCRIPT_OUTPUT_CAPTION_ADDENDUM,
    VIDEO_SCRIPT_SCENE_ALIGNMENT_ADDENDUM,
    HOOK_FIRST_VIDEO_OUTPUT_ADDENDUM,
  ]
    .filter(Boolean)
    .join("\n\n");

  const userBase =
    tpl?.user_prompt_template != null
      ? interpolateTemplate(tpl.user_prompt_template, {
          creation_pack_json: JSON.stringify(pack),
          script_input: scriptInput,
          flow_type: job.flow_type,
          platform: job.platform ?? "",
        })
      : `Generate hook-first hybrid video JSON for:\n${JSON.stringify(pack, null, 2)}\n\nPrior script slice:\n${scriptInput}`;

  let userPrompt = appendVideoUserPromptDurationHardFooter(userBase, config, "script_json");

  const llm = await openaiChat(
    apiKey,
    {
      model: config.OPENAI_MODEL,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      max_tokens: openAiMaxTokens(tpl?.max_tokens_default ?? 2500),
    },
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      signalPackId: (job.generation_payload.signal_pack_id as string) ?? null,
      step: "hook_first_video_prep",
    }
  );

  const parsed = parseJsonObjectFromLlmText(llm.content);
  if (!parsed) {
    return { ok: false, error: "hook-first prep: could not parse JSON from LLM reply" };
  }

  let merged: Record<string, unknown> = normalizeHookFirstGeneratedOutput({ ...gen, ...parsed });
  merged = mergeBridgeIntoSpokenScript(merged);
  const brand = await getBrandConstraints(db, job.project_id);
  merged = sanitizeVideoDisclaimerForBrand(merged, brand);
  merged = ensureVideoScriptPublicationMetadata(merged, {
    hashtag_seeds: Array.isArray(pack.hashtag_seeds) ? (pack.hashtag_seeds as string[]) : null,
    rising_keywords: Array.isArray(pack.rising_keywords) ? (pack.rising_keywords as string[]) : null,
  });

  if (!hookFirstPayloadReady(merged)) {
    return {
      ok: false,
      error: "hook-first prep: missing hook_scene_prompt or spoken_script after LLM",
    };
  }

  merged = normalizeHookFirstGeneratedOutput(merged);

  const newPayload = {
    ...job.generation_payload,
    generated_output: merged,
  };

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(newPayload), job.id]
  );

  return { ok: true };
}

/** Pick Flow Engine templates for hook-first (falls back to script templates). */
export async function listHookFirstPromptTemplates(db: Pool, flowType: string) {
  const resolved = resolveFlowEngineTemplateFlowType(flowType);
  const templates = await listPromptTemplates(db, resolved);
  return templates;
}
