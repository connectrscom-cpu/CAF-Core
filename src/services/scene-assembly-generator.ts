/**
 * LLM step: ordered scene_bundle for multi-scene video jobs.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { listPromptTemplates } from "../repositories/flow-engine.js";
import { openaiChat } from "./openai-chat.js";
import { buildCreationPack, interpolateTemplate } from "./llm-generator-helpers.js";
import { resolveFlowEngineTemplateFlowType } from "../domain/canonical-flow-types.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { expandSceneAssemblyToMinScenes } from "./scene-min-count-expand.js";
import { applySceneTargetsToScenes, withSceneAssemblyPolicy } from "./video-content-policy.js";
import {
  creationContextHasUnreplacedPlaceholders,
  sceneBundleFallbackUserPrompt,
  userPromptLooksLikePerSceneVideoTemplate,
} from "./scene-bundle-fallback-prompt.js";
import { ensureVideoScriptInPayload } from "./video-script-generator.js";
import { extractSpokenScriptText } from "./video-gen-fields.js";
import { buildVideoScriptInputJsonString } from "./llm-creation-pack-budget.js";
import { enrichGeneratedOutputForReview, maxHashtagsFromPlatformConstraints } from "./publish-metadata-enrich.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";

/**
 * Editorial pattern: reviewers repeatedly flagged videos where the scene visuals did not depict
 * the thing the spoken_script was actually talking about (e.g. script discusses "sign and sound"
 * but scenes show generic product B-roll). Inject explicit alignment rules at the system level so
 * every scene's `video_prompt` is anchored to the matching narration slice.
 */
export const SCRIPT_SCENE_ALIGNMENT_POLICY = [
  "Script ↔ scene visual alignment (hard):",
  "- Each scene object MUST include `scene_narration_line` — a consecutive slice of spoken_script in reading order (no paraphrase, no reorder, no omissions).",
  "- Each scene's `video_prompt` MUST visually depict the subject, action and nouns of that scene_narration_line. Do not reuse a generic B-roll prompt across scenes or describe content the narration never mentions.",
  "- If spoken_script introduces a new concept in a sentence (e.g. a product feature, a place, an object, a person), the corresponding scene's video_prompt must show that concept explicitly in frame.",
  "- Do not invent visuals unrelated to the script (no unprompted mascots, generic lifestyle shots, or logo montages unless the script names them).",
  "- Preserve continuity: wardrobe, location, framing cues carry across scenes unless the script signals a hard cut.",
  "- Before returning, verify each scene reads as '[narration slice] ↔ [matching visual]' with the same key nouns.",
].join("\n");

export function withScriptSceneAlignmentPolicy(base: string): string {
  return `${base.trim()}\n\n${SCRIPT_SCENE_ALIGNMENT_POLICY}`.trim();
}

const SCENE_CLIP_URL_KEYS = [
  "rendered_scene_url",
  "video_url",
  "scene_video_url",
  "rendered_video_url",
  "clip_url",
  "mp4_url",
] as const;

/**
 * Public HTTP(S) URL for an already-rendered scene clip (upstream, OpenAI Sora upload in Core, HeyGen, n8n, etc.).
 * Stitch/mux expect fetchable URLs.
 */
export function extractSceneClipUrl(scene: Record<string, unknown>): string | undefined {
  for (const k of SCENE_CLIP_URL_KEYS) {
    const v = scene[k];
    if (typeof v === "string") {
      const t = v.trim();
      if (/^https?:\/\//i.test(t)) return t;
    }
  }
  const u = scene.url;
  if (typeof u === "string") {
    const t = u.trim();
    if (/^https?:\/\//i.test(t)) return t;
  }
  return undefined;
}

/**
 * Per-scene entries use video_prompt | prompt | direction | scene_prompt (Video_Scene_Generator often emits scene_prompt only).
 * After external scene render (e.g. n8n OpenAI video), each row should include rendered_scene_url | video_url (see extractSceneClipUrl).
 * If scenes[] is missing or empty but a flat scene_prompt / video_prompt exists on the bundle (or on generated_output), synthesize one scene.
 */
export function normalizeSceneBundleScenes(
  sceneBundleSource: Record<string, unknown>,
  genFallback: Record<string, unknown>
): Array<Record<string, unknown>> {
  const raw = sceneBundleSource.scenes;
  if (Array.isArray(raw) && raw.length > 0) {
    const out: Array<Record<string, unknown>> = [];
    let ord = 1;
    for (const item of raw) {
      if (!item || typeof item !== "object") continue;
      const s = item as Record<string, unknown>;
      const prompt = String(s.video_prompt ?? s.prompt ?? s.direction ?? s.scene_prompt ?? "").trim();
      const clipUrl = extractSceneClipUrl(s);
      if (!prompt && !clipUrl) continue;
      out.push({
        ...s,
        scene_id: String(s.scene_id ?? ord),
        order: Number(s.order ?? ord) > 0 ? Number(s.order ?? ord) : ord,
        ...(prompt ? { video_prompt: prompt } : {}),
      });
      ord++;
    }
    if (out.length > 0) return out;
  }

  const fromBundle = String(
    sceneBundleSource.scene_prompt ??
      sceneBundleSource.video_prompt ??
      sceneBundleSource.direction ??
      ""
  ).trim();
  const fromGen = String(
    genFallback.scene_prompt ?? genFallback.video_prompt ?? genFallback.direction ?? ""
  ).trim();
  const prompt = fromBundle || fromGen;
  if (!prompt) return [];

  const ord = Number(sceneBundleSource.order ?? 1);
  return [
    {
      scene_id: String(sceneBundleSource.scene_id ?? "1"),
      order: Number.isFinite(ord) && ord > 0 ? ord : 1,
      video_prompt: prompt,
      ...(typeof sceneBundleSource.negative_prompt === "string" && sceneBundleSource.negative_prompt.trim()
        ? { negative_prompt: sceneBundleSource.negative_prompt }
        : {}),
      ...(typeof sceneBundleSource.continuity_notes === "string" && sceneBundleSource.continuity_notes.trim()
        ? { continuity_notes: sceneBundleSource.continuity_notes }
        : {}),
    },
  ];
}

/** Exported for tests — maps spoken script to scenes without splitting mid-sentence when possible. */
export function splitScriptIntoSceneNarrationLines(script: string, sceneCount: number): string[] {
  const s = String(script ?? "").trim();
  const n = Math.max(1, Math.floor(Number(sceneCount) || 1));
  if (!s) return Array.from({ length: n }, () => "");

  const sentences = s
    .split(/(?<=[.!?])\s+/g)
    .map((x) => x.trim())
    .filter(Boolean);

  if (sentences.length >= n) {
    const out: string[] = [];
    let idx = 0;
    for (let i = 0; i < n; i++) {
      const remaining = n - i;
      const remainingSentences = sentences.length - idx;
      const take = Math.ceil(remainingSentences / remaining);
      out.push(sentences.slice(idx, idx + take).join(" ").trim());
      idx += take;
    }
    return out;
  }

  const tokens = (sentences.length ? sentences.join(" ") : s)
    .split(/\s+/g)
    .map((x) => x.trim())
    .filter(Boolean);
  if (tokens.length === 0) return Array.from({ length: n }, () => "");

  const targetPerChunk = Math.max(1, Math.ceil(tokens.length / n));
  const out: string[] = [];
  let i = 0;
  while (i < tokens.length && out.length < n) {
    const chunk = tokens.slice(i, i + targetPerChunk).join(" ").trim();
    out.push(chunk);
    i += targetPerChunk;
  }
  while (out.length < n) out.push("");
  return out;
}

export async function ensureSceneBundleInPayload(
  db: Pool,
  config: AppConfig,
  jobId: string
): Promise<{ ok: boolean; error?: string }> {
  const policyMeta = {
    scene_target_min: config.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN,
    scene_target_max: config.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX,
    clip_duration_sec: config.SCENE_ASSEMBLY_CLIP_DURATION_SEC,
  };
  const apiKey = config.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "OPENAI_API_KEY not set" };

  let job = await qOne<{
    id: string;
    task_id: string;
    project_id: string;
    run_id: string;
    flow_type: string;
    platform: string | null;
    generation_payload: Record<string, unknown>;
  }>(db, `SELECT * FROM caf_core.content_jobs WHERE id = $1`, [jobId]);
  if (!job) return { ok: false, error: "job not found" };

  await ensureVideoScriptInPayload(db, config, jobId).catch(() => {});
  const jobReload = await qOne<{
    id: string;
    task_id: string;
    project_id: string;
    run_id: string;
    flow_type: string;
    platform: string | null;
    generation_payload: Record<string, unknown>;
  }>(db, `SELECT * FROM caf_core.content_jobs WHERE id = $1`, [jobId]);
  if (jobReload) job = jobReload;

  const gen = pickGeneratedOutputOrEmpty(job.generation_payload);
  const bundle = gen.scene_bundle as Record<string, unknown> | undefined;
  const scenes = bundle?.scenes;
  if (Array.isArray(scenes) && scenes.length > 0) {
    return { ok: true };
  }

  // Heal payloads where the LLM used Video_Scene_Generator shape (scene_prompt) but never filled scenes[].
  if (bundle && typeof bundle === "object") {
    const healed = applySceneTargetsToScenes(normalizeSceneBundleScenes(bundle, gen), config);
    if (healed.length > 0) {
      const { scenes: _drop, ...rest } = bundle;
      const merged: Record<string, unknown> = {
        ...gen,
        scene_bundle: {
          ...rest,
          scenes: healed,
          parent_id: job.task_id,
          content_policy: policyMeta,
        },
      };
      const packHeal = await buildCreationPack(
        db,
        job.project_id,
        (job.generation_payload.signal_pack_id as string) ?? null,
        (job.generation_payload.candidate_data as Record<string, unknown>) ?? {},
        job.platform,
        job.flow_type
      );
      const mergedEnriched = enrichGeneratedOutputForReview(job.flow_type, merged, {
        maxHashtags: maxHashtagsFromPlatformConstraints(packHeal.platform_constraints),
      });
      await db.query(
        `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify({ generated_output: mergedEnriched }), job.id]
      );
      return { ok: true };
    }
  }

  const templateFt = resolveFlowEngineTemplateFlowType(job.flow_type);
  const templates = await listPromptTemplates(db, templateFt);
  const tpl =
    templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "scene_assembly") ??
    templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "video") ??
    templates.find((t) => /scene/i.test(t.prompt_name)) ??
    templates[0];
  if (!tpl?.user_prompt_template) {
    return { ok: false, error: "no prompt template for scene assembly" };
  }

  const pack = await buildCreationPack(
    db,
    job.project_id,
    (job.generation_payload.signal_pack_id as string) ?? null,
    (job.generation_payload.candidate_data as Record<string, unknown>) ?? {},
    job.platform,
    job.flow_type
  );

  const cand = (job.generation_payload.candidate_data as Record<string, unknown>) ?? {};
  const includeVs = extractSpokenScriptText(gen, 1).length > 0;
  const packCtx: Record<string, unknown> = {
    ...pack,
    script_input: buildVideoScriptInputJsonString(cand, gen, { includeVideoScript: includeVs }),
  };

  let userPrompt = interpolateTemplate(tpl.user_prompt_template, packCtx);
  const roleOk = (tpl.prompt_role ?? "").toLowerCase() === "scene_assembly";
  let usedBundleFallbackUser =
    !roleOk ||
    creationContextHasUnreplacedPlaceholders(userPrompt) ||
    userPromptLooksLikePerSceneVideoTemplate(userPrompt);
  const sceneTargets = {
    min: config.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN,
    max: config.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX,
  };
  if (usedBundleFallbackUser) {
    userPrompt = sceneBundleFallbackUserPrompt(packCtx, sceneTargets);
  }

  const defaultSceneSys =
    "Return scene_bundle with scenes[] (scene_id, order, direction, video_prompt) inside one JSON object (markdown fence ok).";
  const strictBundleSys =
    "You are a video scene planner. Return only one JSON object. No markdown or commentary.";
  const systemPrompt = withScriptSceneAlignmentPolicy(
    usedBundleFallbackUser
      ? withSceneAssemblyPolicy(strictBundleSys, config)
      : withSceneAssemblyPolicy(tpl.system_prompt ?? defaultSceneSys, config)
  );

  const maxTok = Number(tpl.max_tokens_default ?? 4000);
  let llm = await openaiChat(
    apiKey,
    {
      model: config.OPENAI_MODEL,
      system_prompt: systemPrompt,
      user_prompt: userPrompt,
      max_tokens: maxTok,
    },
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      signalPackId: (job.generation_payload.signal_pack_id as string) ?? null,
      step: `llm_scene_assembly_bundle_${templateFt}`,
    }
  );

  let parsed = parseJsonObjectFromLlmText(llm.content);
  if (!parsed) {
    const retryUser = sceneBundleFallbackUserPrompt(packCtx, sceneTargets);
    const retrySys = withScriptSceneAlignmentPolicy(withSceneAssemblyPolicy(strictBundleSys, config));
    llm = await openaiChat(
      apiKey,
      {
        model: config.OPENAI_MODEL,
        system_prompt: retrySys,
        user_prompt: retryUser,
        max_tokens: maxTok,
      },
      {
        db,
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        signalPackId: (job.generation_payload.signal_pack_id as string) ?? null,
        step: `llm_scene_assembly_bundle_${templateFt}_retry`,
      }
    );
    parsed = parseJsonObjectFromLlmText(llm.content);
  }
  if (!parsed) {
    return { ok: false, error: "scene assembly: could not extract JSON object from reply" };
  }

  const sceneBundle = (parsed.scene_bundle as Record<string, unknown>) ?? parsed;
  const { scenes: _dropScenes, ...restBundle } = sceneBundle;
  let normalizedScenes = applySceneTargetsToScenes(normalizeSceneBundleScenes(sceneBundle, gen), config);
  const minScenes = config.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN;
  const maxScenes = config.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX;

  if (normalizedScenes.length > 0 && normalizedScenes.length < minScenes) {
    const fixBlock = `---\nYour previous answer had only ${normalizedScenes.length} scene(s). Regenerate the **complete** JSON object with between ${minScenes} and ${maxScenes} scenes inclusive. Add distinct beats or B-roll moments (each with video_prompt); do not merge into fewer than ${minScenes} scenes.`;
    const fixUser = `${userPrompt}\n\n${fixBlock}`;
    const fixLlm = await openaiChat(
      apiKey,
      {
        model: config.OPENAI_MODEL,
        system_prompt: systemPrompt,
        user_prompt: fixUser,
        max_tokens: maxTok,
      },
      {
        db,
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        signalPackId: (job.generation_payload.signal_pack_id as string) ?? null,
        step: `llm_scene_assembly_bundle_${templateFt}_scene_count_fixup`,
      }
    );
    const parsedFix = parseJsonObjectFromLlmText(fixLlm.content);
    if (parsedFix) {
      const sbFix = (parsedFix.scene_bundle as Record<string, unknown>) ?? parsedFix;
      const nextScenes = applySceneTargetsToScenes(normalizeSceneBundleScenes(sbFix, gen), config);
      if (nextScenes.length >= minScenes || nextScenes.length > normalizedScenes.length) {
        const { scenes: _dFix, ...restFix } = sbFix;
        Object.assign(restBundle, restFix);
        normalizedScenes = nextScenes;
      }
    }
  }

  const expandedMin = expandSceneAssemblyToMinScenes(normalizedScenes, gen, config);
  normalizedScenes = expandedMin.scenes;

  if (normalizedScenes.length === 0) {
    return {
      ok: false,
      error:
        "scene assembly: model returned no usable scenes (need scenes[] with video_prompt, or scene_prompt / video_prompt on the bundle)",
    };
  }

  /**
   * Hard requirement: scene_narration_line must be consecutive slices of spoken_script (same words, same order).
   * If the model drifts (common), rewrite narration lines deterministically so downstream VO/subtitles are coherent.
   */
  const spoken = extractSpokenScriptText(gen, 1);
  if (spoken.trim()) {
    const lines = splitScriptIntoSceneNarrationLines(spoken, normalizedScenes.length);
    for (let i = 0; i < normalizedScenes.length; i++) {
      const sc = normalizedScenes[i]!;
      const cur = String(sc.scene_narration_line ?? "").trim();
      const next = String(lines[i] ?? "").trim();
      if (!cur || cur !== next) {
        sc.scene_narration_line = next;
      }
      if (sc.order == null) sc.order = i + 1;
      if (sc.scene_id == null) sc.scene_id = `${job.task_id}__scene_${String(i + 1).padStart(2, "0")}`;
    }
  }

  const merged: Record<string, unknown> = {
    ...gen,
    scene_bundle: {
      ...restBundle,
      scenes: normalizedScenes,
      parent_id: job.task_id,
      content_policy: policyMeta,
    },
  };

  const mergedEnriched = enrichGeneratedOutputForReview(job.flow_type, merged, {
    maxHashtags: maxHashtagsFromPlatformConstraints(pack.platform_constraints),
  });

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ generated_output: mergedEnriched }), job.id]
  );
  return { ok: true };
}
