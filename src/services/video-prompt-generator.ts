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
import { withVideoPromptDurationPolicy } from "./video-content-policy.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import {
  PUBLICATION_SYSTEM_ADDENDUM,
  enrichGeneratedOutputForReview,
  maxHashtagsFromPlatformConstraints,
} from "./publish-metadata-enrich.js";

/**
 * Editorial pattern: reviewers repeatedly flagged videos where captions were "extremely weak"
 * and shipped with **zero** hashtags — killing discoverability on TikTok/IG Reels. Append a
 * video-specific captioning contract on top of PUBLICATION_SYSTEM_ADDENDUM so the LLM treats
 * captions + hashtags as first-class outputs grounded in the signal pack.
 */
export const VIDEO_CAPTION_SYSTEM_ADDENDUM = `Video caption contract (TikTok / IG Reels / Shorts):
- The on-platform caption is a primary deliverable, not an afterthought. Produce a caption that:
  * opens with a hook line (question, bold claim, or pattern interrupt) tied to the script's first beat,
  * summarises the value or payoff in plain language (1–2 short sentences max),
  * ends with a clear imperative CTA (Follow / Save / Comment / Tag) that pairs with the account **@handle** when it is present in context.
- Hashtags are REQUIRED for video flows. Emit a non-empty \`hashtags\` field (array preferred) sourced from signal_pack_publication_hints (themes, keywords, hashtag_seeds) — never return zero hashtags.
- Aim for **at least 3–5** substantive hashtags when \`max_hashtags\` allows (discovery dies on one or two ultra-generic tags).
- Mix one or two broad-reach tags with several niche / topical tags pulled from the signal pack. Prefer specific, research-backed tags over generic filler (avoid #love, #fyp-only, #viral-only when the pack gives better options).
- Respect platform_constraints.max_hashtags when present; otherwise cap at ~8.
- Do NOT fabricate handles, URLs, or hashtags not implied by the candidate or signal pack context.`;

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

  const gen = pickGeneratedOutputOrEmpty(job.generation_payload);
  const resolved = extractVideoPromptText(gen, 10);
  if (resolved.length > 0) {
    let outGen = gen;
    if (!String(gen.video_prompt ?? "").trim()) {
      const canonical = extractVideoPromptText(gen, 1);
      if (canonical.trim()) {
        outGen = { ...gen, video_prompt: canonical.trim() };
      }
    }
    const packEarly = await buildCreationPack(
      db,
      job.project_id,
      (job.generation_payload.signal_pack_id as string) ?? null,
      (job.generation_payload.candidate_data as Record<string, unknown>) ?? {},
      job.platform,
      job.flow_type
    );
    const enrichedEarly = enrichGeneratedOutputForReview(job.flow_type, outGen, {
      maxHashtags: maxHashtagsFromPlatformConstraints(packEarly.platform_constraints),
    });
    await db.query(
      `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
      [JSON.stringify({ generated_output: enrichedEarly }), job.id]
    );
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
    job.platform,
    job.flow_type
  );

  const userPrompt = interpolateTemplate(tpl.user_prompt_template, pack);

  const baseSys =
    tpl.system_prompt ??
    "Include video_prompt (string) suitable for AI video generation; put fields in one JSON object (markdown fence ok).";
  const llm = await openaiChat(
    apiKey,
    {
      model: config.OPENAI_MODEL,
      system_prompt: `${withVideoPromptDurationPolicy(baseSys, config).trim()}\n\n${PUBLICATION_SYSTEM_ADDENDUM}\n\n${VIDEO_CAPTION_SYSTEM_ADDENDUM}`.trim(),
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

  const enriched = enrichGeneratedOutputForReview(job.flow_type, merged, {
    maxHashtags: maxHashtagsFromPlatformConstraints(pack.platform_constraints),
  });

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ generated_output: enriched }), job.id]
  );
  return { ok: true };
}
