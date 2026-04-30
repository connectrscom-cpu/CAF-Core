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
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import {
  appendVideoUserPromptDurationHardFooter,
  withVideoScriptDurationPolicy,
} from "./video-content-policy.js";
import {
  countWords,
  fitSpokenScriptToWordBudget,
  heygenSpokenScriptWordBoundsFromConfig,
} from "./spoken-script-word-budget.js";
import { expandSpokenScriptToMinimum } from "./heygen-spoken-script-enforcement.js";
import {
  PUBLICATION_SYSTEM_ADDENDUM,
  enrichGeneratedOutputForReview,
  maxHashtagsFromPlatformConstraints,
} from "./publish-metadata-enrich.js";
import { VIDEO_CAPTION_SYSTEM_ADDENDUM } from "./video-prompt-generator.js";
import { isProductVideoFlow } from "../domain/product-flow-types.js";

/** Reduces script ↔ scene mismatches (product demos, multi-beat layouts). */
export const VIDEO_SCRIPT_SCENE_ALIGNMENT_ADDENDUM = `Scene–script alignment (critical):
- If you emit **scenes**, **shots**, **visual_direction**, or per-beat visuals, each beat must **show what the VO says at that beat** — no contradictory b-roll or a different story than the spoken line.
- **Through-line:** The hook’s promise must match the middle and close (same product angle, same narrative spine); do not drift to unrelated topics mid-script.
- Map beats in order: scene 1 supports the opening claim; later scenes prove or deepen it with concretes (feature, demo, payoff).`;

/**
 * Tightens the video-script JSON contract so review pipelines do not see empty captions/hashtags when
 * prompts alone drift (see VIDEO_CAPTION_SYSTEM_ADDENDUM in video-prompt-generator.ts).
 */
export const VIDEO_SCRIPT_OUTPUT_CAPTION_ADDENDUM = `Video script JSON (mandatory fields):
- Include a non-empty string field \`caption\`: the on-platform post caption (not the full VO verbatim). Write hook + payoff + CTA for the feed; ground in the signal pack and script beats.
- Include \`hashtags\` as a non-empty array of strings (or a string that lists tags) when the schema allows; follow the hashtag rules in VIDEO_CAPTION_SYSTEM_ADDENDUM.`;

function pickCaptionFromVideoScriptJson(o: Record<string, unknown>): string {
  for (const k of ["caption", "post_caption"] as const) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const pub = o.publication;
  if (pub && typeof pub === "object" && !Array.isArray(pub)) {
    const p = pub as Record<string, unknown>;
    for (const k of ["caption", "post_caption"] as const) {
      const v = p[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  const nested = o.content;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const v = (nested as Record<string, unknown>).caption;
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function hasNonEmptyHashtags(o: Record<string, unknown>): boolean {
  const h = o.hashtags;
  if (Array.isArray(h)) return h.some((t) => String(t ?? "").trim().length > 0);
  if (typeof h === "string") return h.trim().length > 0;
  return false;
}

function deriveFallbackCaption(o: Record<string, unknown>): string {
  const hook = String(o.hook ?? o.hook_line ?? "").trim();
  const script = extractSpokenScriptText(o, 1);
  const firstChunk = script.split(/(?<=[.!?])\s+/).filter(Boolean)[0]?.trim() ?? script.slice(0, 360).trim();
  const parts = [hook, firstChunk && firstChunk !== hook ? firstChunk : ""].filter(Boolean);
  let cap = parts.join("\n\n").trim();
  if (!cap) cap = script.slice(0, 900).trim();
  return cap.slice(0, 2200);
}

function deriveFallbackHashtags(o: Record<string, unknown>): string[] {
  const blob = `${String(o.hook ?? o.hook_line ?? "")} ${extractSpokenScriptText(o, 1)}`.toLowerCase();
  const words = blob
    .replace(/[^a-z0-9\s#]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^#/, ""))
    .filter((w) => w.length >= 5);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of words) {
    const tag = `#${w.slice(0, 48)}`;
    if (seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag);
    if (out.length >= 6) break;
  }
  const pad = ["#recipe", "#cooking", "#food"];
  for (const p of pad) {
    if (out.length >= 3) break;
    if (!seen.has(p)) {
      seen.add(p);
      out.push(p);
    }
  }
  return out;
}

/**
 * Ensures `caption` and `hashtags` are present for downstream review/publish when the LLM omitted them.
 */
export function ensureVideoScriptPublicationMetadata(
  parsed: Record<string, unknown>,
  opts?: { hashtag_seeds?: string[] | null }
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...parsed };
  let cap = pickCaptionFromVideoScriptJson(out);
  if (!cap) cap = deriveFallbackCaption(out);
  const trimmed = cap.trim();
  if (trimmed) out.caption = trimmed;
  if (!hasNonEmptyHashtags(out)) {
    const seeds = Array.isArray(opts?.hashtag_seeds)
      ? opts!.hashtag_seeds!.map((x) => String(x ?? "").trim()).filter(Boolean)
      : [];
    // Prefer signal pack hashtag seeds (evidence-weighted) when present; fall back to local derivation.
    out.hashtags = seeds.length > 0 ? seeds.slice(0, 12) : deriveFallbackHashtags(out);
  }
  return out;
}

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
    /**
     * JSON-envelope retry drifted again — fall back to the same plain-text expander used at HeyGen
     * preflight (`heygen-spoken-script-enforcement.ts`). It rewrites the voiceover continuously without the
     * structural constraints that make models cap word count, so it almost always reaches `minWords`.
     */
    let expanded: string;
    try {
      expanded = await expandSpokenScriptToMinimum(config, apiKey, scriptOut, minWords, {
        db,
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
      });
    } catch (err) {
      return {
        parsed: merged,
        extraTokens: llm.total_tokens,
        error: `spoken_script still ${wc2} words after retry; plain-text expansion failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
    let wc3 = countWords(expanded);
    if (wc3 > maxWords) {
      const fitted = fitSpokenScriptToWordBudget(expanded, [], maxWords);
      expanded = fitted.script;
      wc3 = countWords(expanded);
    }
    if (wc3 < minWords) {
      return {
        parsed: merged,
        extraTokens: llm.total_tokens,
        error: `spoken_script still ${wc3} words after retry + plain-text expansion (minimum ${minWords}). Tighten prompts or raise VIDEO_TARGET_DURATION_MIN_SEC / SCENE_VO_WORDS_PER_MINUTE.`,
      };
    }
    merged = applySpokenScriptToParsed(merged, expanded);
    return { parsed: merged, extraTokens: llm.total_tokens };
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

  const gen = pickGeneratedOutputOrEmpty(job.generation_payload);
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
    const seedsEarly =
      (packEarly.signal_pack_publication_hints &&
        typeof packEarly.signal_pack_publication_hints === "object" &&
        !Array.isArray(packEarly.signal_pack_publication_hints) &&
        Array.isArray((packEarly.signal_pack_publication_hints as Record<string, unknown>).hashtag_seeds))
        ? ((packEarly.signal_pack_publication_hints as Record<string, unknown>).hashtag_seeds as unknown[])
            .map((x) => String(x ?? "").trim())
            .filter(Boolean)
        : [];
    const alignEarly =
      isProductVideoFlow(job.flow_type) || multiSceneEarly ? `\n\n${VIDEO_SCRIPT_SCENE_ALIGNMENT_ADDENDUM}` : "";
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
        retrySystemPrompt: `${withVideoScriptDurationPolicy(baseSysEarly, config, { multiScene: multiSceneEarly }).trim()}\n\n${PUBLICATION_SYSTEM_ADDENDUM}\n\n${VIDEO_CAPTION_SYSTEM_ADDENDUM}\n\n${VIDEO_SCRIPT_OUTPUT_CAPTION_ADDENDUM}${alignEarly}`,
        retryUserPromptBase: `You are revising an existing video script JSON. Meet the word count while preserving structure and other fields.\n\nDraft JSON:\n${JSON.stringify(gen).slice(0, 14000)}`,
        stepPrefix: `llm_video_script_prep_${job.flow_type}`,
      }
    );
    if (enforcedEarly.error) return { ok: false, error: enforcedEarly.error };
    const withMetaEarly = ensureVideoScriptPublicationMetadata(enforcedEarly.parsed, { hashtag_seeds: seedsEarly });
    const enrichedEarly = enrichGeneratedOutputForReview(job.flow_type, withMetaEarly, {
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
  const seeds =
    (pack.signal_pack_publication_hints &&
      typeof pack.signal_pack_publication_hints === "object" &&
      !Array.isArray(pack.signal_pack_publication_hints) &&
      Array.isArray((pack.signal_pack_publication_hints as Record<string, unknown>).hashtag_seeds))
      ? ((pack.signal_pack_publication_hints as Record<string, unknown>).hashtag_seeds as unknown[])
          .map((x) => String(x ?? "").trim())
          .filter(Boolean)
      : [];

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
  const sceneAlign =
    isProductVideoFlow(job.flow_type) || multiScene ? `\n\n${VIDEO_SCRIPT_SCENE_ALIGNMENT_ADDENDUM}` : "";

  const runScriptLlm = async (user: string, stepSuffix: string) =>
    openaiChat(
      apiKey,
      {
        model: config.OPENAI_MODEL,
        system_prompt: `${withVideoScriptDurationPolicy(baseSys, config, { multiScene }).trim()}\n\n${PUBLICATION_SYSTEM_ADDENDUM}\n\n${VIDEO_CAPTION_SYSTEM_ADDENDUM}\n\n${VIDEO_SCRIPT_OUTPUT_CAPTION_ADDENDUM}${sceneAlign}`.trim(),
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
      retrySystemPrompt: `${withVideoScriptDurationPolicy(baseSys, config, { multiScene }).trim()}\n\n${PUBLICATION_SYSTEM_ADDENDUM}\n\n${VIDEO_CAPTION_SYSTEM_ADDENDUM}\n\n${VIDEO_SCRIPT_OUTPUT_CAPTION_ADDENDUM}${sceneAlign}`,
      retryUserPromptBase: userPrompt,
      stepPrefix: `llm_video_script_prep_${job.flow_type}`,
    }
  );
  if (enforced.error) return { ok: false, error: enforced.error };
  merged = ensureVideoScriptPublicationMetadata(enforced.parsed, { hashtag_seeds: seeds });

  const enriched = enrichGeneratedOutputForReview(job.flow_type, merged, {
    maxHashtags: maxHashtagsFromPlatformConstraints(pack.platform_constraints),
  });

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ generated_output: enriched }), job.id]
  );
  return { ok: true };
}
