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

/**
 * Per-scene entries use video_prompt | prompt | direction | scene_prompt (Video_Scene_Generator often emits scene_prompt only).
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
      if (!prompt) continue;
      out.push({
        ...s,
        scene_id: String(s.scene_id ?? ord),
        order: Number(s.order ?? ord) > 0 ? Number(s.order ?? ord) : ord,
        video_prompt: prompt,
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

export async function ensureSceneBundleInPayload(
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
  const bundle = gen.scene_bundle as Record<string, unknown> | undefined;
  const scenes = bundle?.scenes;
  if (Array.isArray(scenes) && scenes.length > 0) {
    return { ok: true };
  }

  // Heal payloads where the LLM used Video_Scene_Generator shape (scene_prompt) but never filled scenes[].
  if (bundle && typeof bundle === "object") {
    const healed = normalizeSceneBundleScenes(bundle, gen);
    if (healed.length > 0) {
      const { scenes: _drop, ...rest } = bundle;
      const merged: Record<string, unknown> = {
        ...gen,
        scene_bundle: {
          ...rest,
          scenes: healed,
          parent_id: job.task_id,
        },
      };
      await db.query(
        `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
        [JSON.stringify({ generated_output: merged }), job.id]
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
    job.platform
  );

  const userPrompt = interpolateTemplate(tpl.user_prompt_template, pack);

  const llm = await openaiChat(
    apiKey,
    {
      model: config.OPENAI_MODEL,
      system_prompt:
        tpl.system_prompt ??
        "Return scene_bundle with scenes[] (scene_id, order, direction, video_prompt) inside one JSON object (markdown fence ok).",
      user_prompt: userPrompt,
      max_tokens: Number(tpl.max_tokens_default ?? 4000),
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

  const parsed = parseJsonObjectFromLlmText(llm.content);
  if (!parsed) {
    return { ok: false, error: "scene assembly: could not extract JSON object from reply" };
  }

  const sceneBundle = (parsed.scene_bundle as Record<string, unknown>) ?? parsed;
  const { scenes: _dropScenes, ...restBundle } = sceneBundle;
  const normalizedScenes = normalizeSceneBundleScenes(sceneBundle, gen);
  if (normalizedScenes.length === 0) {
    return {
      ok: false,
      error:
        "scene assembly: model returned no usable scenes (need scenes[] with video_prompt, or scene_prompt / video_prompt on the bundle)",
    };
  }

  const merged: Record<string, unknown> = {
    ...gen,
    scene_bundle: {
      ...restBundle,
      scenes: normalizedScenes,
      parent_id: job.task_id,
    },
  };

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = generation_payload || $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify({ generated_output: merged }), job.id]
  );
  return { ok: true };
}
