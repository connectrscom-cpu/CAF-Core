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
  countWords,
  fitSpokenScriptToWordBudget,
  heygenSpokenScriptWordBoundsFromConfig,
} from "./spoken-script-word-budget.js";
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

/** Script-led video flows where spoken_script must obey VIDEO_TARGET × WPM (primary LLM + prep step). */
export function shouldEnforceSpokenScriptWordLawOnFlow(flowType: string): boolean {
  const ft = flowType ?? "";
  if (/^FLOW_PRODUCT_/i.test(ft)) return false;
  return /Video_Script|video_script|Script_HeyGen|script_generator/i.test(ft);
}

function applySpokenScriptToParsed(parsed: Record<string, unknown>, script: string): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed, spoken_script: script };
  if ("script" in out) out.script = script;
  if ("video_script" in out) out.video_script = script;
  return out;
}

/**
 * Hard trim to max words; if under min, one LLM retry with rejection footer (same rules as HeyGen preflight).
 * Used by primary `generateForJob` and `ensureVideoScriptInPayload`.
 */
export async function enforceSpokenScriptWordLawOnParsedOutput(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string; flow_type: string },
  parsed: Record<string, unknown>,
  apiKey: string,
  model: string,
  maxTokens: number,
  signalPackId: string | null,
  opts: {
    retrySystemPrompt: string;
    /** Prepended before the hard-rule rejection block on retry */
    retryUserPromptBase: string;
    stepPrefix: string;
  }
): Promise<{ parsed: Record<string, unknown>; extraTokens: number; error?: string }> {
  if (!config.HEYGEN_ENFORCE_SPOKEN_SCRIPT_WORD_BOUNDS) {
    return { parsed, extraTokens: 0 };
  }
  const script0 = extractSpokenScriptText(parsed, 1).trim();
  if (!script0) {
    return { parsed, extraTokens: 0 };
  }

  const { minWords, maxWords } = heygenSpokenScriptWordBoundsFromConfig(config);
  let p: Record<string, unknown> = { ...parsed };
  let script = script0;
  let wc = countWords(script);

  if (wc > maxWords) {
    const fitted = fitSpokenScriptToWordBudget(script, [], maxWords);
    p = applySpokenScriptToParsed(p, fitted.script);
    script = fitted.script;
    wc = countWords(script);
  }

  if (wc >= minWords) {
    return { parsed: p, extraTokens: 0 };
  }

  if (!apiKey.trim()) {
    return {
      parsed: p,
      extraTokens: 0,
      error: `spoken_script too short (${wc} words; minimum ${minWords}). Set OPENAI_API_KEY for expansion retry.`,
    };
  }

  const rejection =
    `\n\n---\n**REJECTED (hard rule):** The previous draft had only ${wc} spoken words; **minimum ${minWords} words** are required (~${config.VIDEO_TARGET_DURATION_MIN_SEC}–${config.VIDEO_TARGET_DURATION_MAX_SEC}s at ${config.SCENE_VO_WORDS_PER_MINUTE} WPM). ` +
    `Rewrite the JSON: keep the same fields, expand **spoken_script** (and **script** / **video_script** if present) with concrete detail, examples, and natural pacing — no filler phrases, no "in this video".`;

  const llm = await openaiChat(
    apiKey,
    {
      model,
      system_prompt: opts.retrySystemPrompt.trim(),
      user_prompt: `${opts.retryUserPromptBase.trim()}${rejection}`,
      max_tokens: openAiMaxTokens(maxTokens),
    },
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      signalPackId,
      step: `${opts.stepPrefix}_retry_word_law`,
    }
  );

  const parsed2 = parseJsonObjectFromLlmText(llm.content);
  if (!parsed2) {
    return {
      parsed: p,
      extraTokens: llm.total_tokens,
      error: "spoken_script enforcement: could not extract JSON object from retry reply",
    };
  }

  let merged: Record<string, unknown> = { ...p, ...parsed2 };
  const st = extractSpokenScriptText(merged, 1);
  if (st.length > 0 && !String(merged.spoken_script ?? "").trim()) {
    merged.spoken_script = st;
  }
  let scriptOut = extractSpokenScriptText(merged, 1).trim();
  let wc2 = countWords(scriptOut);
  if (wc2 > maxWords) {
    const fitted = fitSpokenScriptToWordBudget(scriptOut, [], maxWords);
    merged = applySpokenScriptToParsed(merged, fitted.script);
    scriptOut = fitted.script;
    wc2 = countWords(scriptOut);
  }
  if (wc2 < minWords) {
    return {
      parsed: merged,
      extraTokens: llm.total_tokens,
      error: `spoken_script still ${wc2} words after retry (minimum ${minWords} words). Tighten prompts or raise VIDEO_TARGET_DURATION_MIN_SEC / SCENE_VO_WORDS_PER_MINUTE.`,
    };
  }
  return { parsed: merged, extraTokens: llm.total_tokens };
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
    const tplEarly = await pickVideoScriptTemplate(db, job.flow_type);
    const baseSysEarly =
      tplEarly?.system_prompt ??
      "Provide spoken_script, visual_direction, hook, cta as fields in one JSON object (markdown fence ok).";
    const resolvedFtEarly = resolveFlowEngineTemplateFlowType(job.flow_type);
    const multiSceneEarly =
      /FLOW_SCENE|scene_assembly|Video_Scene_Generator/i.test(job.flow_type) || resolvedFtEarly === "Video_Scene_Generator";
    const packEarly = await buildCreationPack(
      db,
      job.project_id,
      (job.generation_payload.signal_pack_id as string) ?? null,
      (job.generation_payload.candidate_data as Record<string, unknown>) ?? {},
      job.platform,
      job.flow_type
    );
    const enforcedEarly = await enforceSpokenScriptWordLawOnParsedOutput(
      db,
      config,
      job,
      { ...gen },
      apiKey,
      config.OPENAI_MODEL,
      openAiMaxTokens(tplEarly?.max_tokens_default ?? 2500),
      (job.generation_payload.signal_pack_id as string) ?? null,
      {
        retrySystemPrompt: `${withVideoScriptDurationPolicy(baseSysEarly, config, { multiScene: multiSceneEarly }).trim()}\n\n${PUBLICATION_SYSTEM_ADDENDUM}`,
        retryUserPromptBase: `You are revising an existing video script JSON. Meet the word count while preserving structure and other fields.\n\nDraft JSON:\n${JSON.stringify(gen).slice(0, 14000)}`,
        stepPrefix: `llm_video_script_prep_${job.flow_type}`,
      }
    );
    if (enforcedEarly.error) return { ok: false, error: enforcedEarly.error };
    const enrichedEarly = enrichGeneratedOutputForReview(job.flow_type, enforcedEarly.parsed, {
      maxHashtags: maxHashtagsFromPlatformConstraints(packEarly.platform_constraints),
    });
    await db.query(
      `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify({ generated_output: enrichedEarly }), job.id]
    );
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

  const runScriptLlm = async (user: string, stepSuffix: string) =>
    openaiChat(
      apiKey,
      {
        model: config.OPENAI_MODEL,
        system_prompt: `${withVideoScriptDurationPolicy(baseSys, config, { multiScene }).trim()}\n\n${PUBLICATION_SYSTEM_ADDENDUM}`.trim(),
        user_prompt: user,
        max_tokens: openAiMaxTokens(tpl.max_tokens_default ?? 2500),
      },
      {
        db,
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        signalPackId: (job.generation_payload.signal_pack_id as string) ?? null,
        step: `llm_video_script_prep_${job.flow_type}${stepSuffix}`,
      }
    );

  const llm = await runScriptLlm(userPrompt, "");

  const parsed = parseJsonObjectFromLlmText(llm.content);
  if (!parsed) {
    return { ok: false, error: "script generator: could not extract JSON object from reply" };
  }

  let merged = { ...gen, ...parsed };
  const scriptText = extractSpokenScriptText(merged, 1);
  if (scriptText.length > 0 && !String(merged.spoken_script ?? "").trim()) {
    merged.spoken_script = scriptText;
  }
  if (extractSpokenScriptText(merged, 20).length === 0) {
    return { ok: false, error: "video script LLM returned no usable spoken_script/script field" };
  }

  const enforced = await enforceSpokenScriptWordLawOnParsedOutput(
    db,
    config,
    job,
    merged,
    apiKey,
    config.OPENAI_MODEL,
    openAiMaxTokens(tpl.max_tokens_default ?? 2500),
    (job.generation_payload.signal_pack_id as string) ?? null,
    {
      retrySystemPrompt: `${withVideoScriptDurationPolicy(baseSys, config, { multiScene }).trim()}\n\n${PUBLICATION_SYSTEM_ADDENDUM}`,
      retryUserPromptBase: userPrompt,
      stepPrefix: `llm_video_script_prep_${job.flow_type}`,
    }
  );
  if (enforced.error) return { ok: false, error: enforced.error };
  merged = enforced.parsed;

  const enriched = enrichGeneratedOutputForReview(job.flow_type, merged, {
    maxHashtags: maxHashtagsFromPlatformConstraints(pack.platform_constraints),
  });

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ generated_output: enriched }), job.id]
  );
  return { ok: true };
}
