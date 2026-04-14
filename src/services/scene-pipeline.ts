/**
 * Multi-scene video (script-first): final **spoken_script** comes from the script flow; scene_bundle adds
 * **~4s segments** with `scene_narration_line` (splits of that script) and `video_prompt` (visuals + global context).
 * Clips (Sora/HeyGen) → concat → TTS on full script → SRT → mux. Optional word-trim is off by default.
 * Missing per-scene URLs + `video_prompt`: render in Core via **OpenAI Videos API (Sora)** (`sora-scene-clips.ts`:
 * `POST /videos` → poll → `GET /videos/{id}/content` → Supabase) when `SCENE_ASSEMBLY_CLIP_PROVIDER=sora`,
 * `OPENAI_API_KEY`, `SUPABASE_*`. **HeyGen** per-scene clips are opt-in: `SCENE_ASSEMBLY_CLIP_PROVIDER=heygen` and
 * `SCENE_ASSEMBLY_HEYGEN_CLIP_FALLBACK=1` plus `HEYGEN_API_KEY`. Otherwise set clip URLs on `scene_bundle.scenes[]`.
 *
 * Legacy n8n reference (user workflows): Scene_Assembly_Generator → per-scene Sora → stitch/mux. This repo’s
 * video-assembly `/stitch` is image-only (`image_urls`); **we use `/concat-videos` + `video_urls` for MP4 scenes**
 * — see `.cursor/rules/scene-assembly-n8n-legacy.mdc`.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { insertAsset } from "../repositories/assets.js";
import { listHeygenConfig } from "../repositories/project-config.js";
import { createSignedUrlForObjectKey, uploadBuffer, downloadBufferFromUrl } from "./supabase-storage.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import { ensureSceneBundleInPayload, extractSceneClipUrl } from "./scene-assembly-generator.js";
import {
  applyHeygenEnvAvatarDefaults,
  buildHeyGenVideoAgentRequestBody,
  mergeHeygenConfigForJob,
  resolveHeygenGeneratePath,
  runHeygenVideoWithBody,
} from "./heygen-renderer.js";
import { applySceneTargetsToScenes } from "./video-content-policy.js";
import {
  buildSrtFromScenesWithSentenceCues,
  splitScriptIntoSceneChunksByWeights,
} from "./caption-generator.js";
import { probeMediaDurationSec } from "./media-duration.js";
import { mergeProbedClipDurations } from "./scene-clip-durations.js";
import { buildSceneAssemblyGlobalVisualContext } from "./scene-assembly-visual-context.js";
import { expandSceneAssemblyToMinScenes } from "./scene-min-count-expand.js";
import {
  narrationLinesAlignedWithScript,
  narrationLinesLooseConcatMatchesScript,
  sceneNarrationLinesStrict,
} from "./scene-narration-alignment.js";
import { fitSpokenScriptToWordBudget } from "./spoken-script-word-budget.js";
import { synthesizeSpeechToStorage } from "./tts-service.js";
import { createUploadSoraSceneClip } from "./sora-scene-clips.js";

function parseVideoAssemblyJson(
  text: string,
  status: number,
  label: string,
  url: string
): Record<string, unknown> {
  const t = text.trim();
  if (t.startsWith("<!") || t.startsWith("<html") || t.startsWith("<HTML")) {
    const gatewayHint =
      url.includes("/status/")
        ? " If POST /concat-videos worked but polling failed, redeploy the Fly **media-gateway** image (services/media-gateway) — it must proxy GET /status to video-assembly. "
        : " ";
    throw new Error(
      `${label}: expected JSON but got HTML (${status}) from ${url}. ` +
        "Point VIDEO_ASSEMBLY_BASE_URL at the Node video-assembly service or media-gateway (not CAF Core / standalone renderer-only app)." +
        gatewayHint +
        `Preview: ${t.slice(0, 200)}`
    );
  }
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${label}: invalid JSON (${status}): ${msg}. Preview: ${t.slice(0, 240)}`);
  }
}

function scenePrimaryPrompt(sc: Record<string, unknown>): string {
  return String(sc.video_prompt ?? sc.scene_prompt ?? sc.prompt ?? sc.direction ?? "").trim();
}

type SceneClipRenderPhase = "heygen_scene_clips" | "sora_scene_clips";

async function persistSceneAssemblyClipProgress(
  db: Pool,
  jobId: string,
  gen: Record<string, unknown>,
  bundle: Record<string, unknown>,
  scenes: Record<string, unknown>[],
  phase: SceneClipRenderPhase,
  done: number,
  total: number,
  lastSceneIndex: number
): Promise<void> {
  const newGen: Record<string, unknown> = {
    ...gen,
    scene_bundle: {
      ...bundle,
      scenes,
    },
  };
  await db.query(
    `UPDATE caf_core.content_jobs SET
       generation_payload = jsonb_set(COALESCE(generation_payload,'{}'::jsonb), '{generated_output}', $1::jsonb, true),
       render_state = $2::jsonb,
       updated_at = now()
     WHERE id = $3`,
    [
      JSON.stringify(newGen),
      JSON.stringify({
        provider: "video",
        status: "in_progress",
        phase,
        scene_clip_done: done,
        scene_clip_total: total,
        last_scene_index: lastSceneIndex,
      }),
      jobId,
    ]
  );
}

/**
 * When only prompts exist: render each missing clip via OpenAI Sora (`POST /v1/videos`), upload MP4 to Supabase,
 * set `rendered_scene_url` on each scene (concat needs fetchable URLs).
 */
async function maybeRenderMissingSceneClipsWithSora(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string; flow_type: string; platform: string | null },
  scenes: Record<string, unknown>[],
  bundle: Record<string, unknown>,
  gen: Record<string, unknown>
): Promise<void> {
  const anyMissing = scenes.some((sc) => !extractSceneClipUrl(sc) && scenePrimaryPrompt(sc));
  if (!anyMissing) return;

  if (!config.OPENAI_API_KEY?.trim()) {
    throw new Error(
      "SCENE_ASSEMBLY_CLIP_PROVIDER=sora requires OPENAI_API_KEY (OpenAI Videos API / Sora 2)."
    );
  }

  if (!config.SUPABASE_URL?.trim() || !config.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    throw new Error(
      "SCENE_ASSEMBLY_CLIP_PROVIDER=sora requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY so each Sora MP4 can be uploaded to a public object URL (OpenAI video content endpoints require auth)."
    );
  }

  const clipTotal = scenes.filter((sc) => !extractSceneClipUrl(sc) && scenePrimaryPrompt(sc)).length;
  let clipDone = 0;
  if (clipTotal > 0) {
    await db.query(
      `UPDATE caf_core.content_jobs SET render_state = $1::jsonb, updated_at = now() WHERE id = $2`,
      [
        JSON.stringify({
          provider: "video",
          status: "in_progress",
          phase: "sora_scene_clips",
          scene_clip_done: 0,
          scene_clip_total: clipTotal,
        }),
        job.id,
      ]
    );
  }

  const globalVisualContext =
    config.SCENE_PREPEND_GLOBAL_CONTEXT_TO_CLIP_PROMPTS
      ? buildSceneAssemblyGlobalVisualContext({ gen, bundle })
      : "";

  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i]!;
    if (extractSceneClipUrl(sc)) continue;
    const prompt = scenePrimaryPrompt(sc);
    if (!prompt) continue;

    const { publicUrl } = await createUploadSoraSceneClip(config, {
      prompt,
      global_visual_context: globalVisualContext || null,
      taskId: job.task_id,
      runId: job.run_id,
      sceneIndex: i,
      audit: {
        db,
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        scene_index: i,
      },
    });
    sc.rendered_scene_url = publicUrl;
    clipDone += 1;
    await persistSceneAssemblyClipProgress(db, job.id, gen, bundle, scenes, "sora_scene_clips", clipDone, clipTotal, i);
  }
}

/**
 * When only prompts exist and HeyGen fallback is enabled: render each missing clip via HeyGen Video Agent (no avatar).
 */
async function maybeRenderMissingSceneClipsWithHeyGen(
  db: Pool,
  config: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string; flow_type: string; platform: string | null },
  scenes: Record<string, unknown>[],
  bundle: Record<string, unknown>,
  gen: Record<string, unknown>
): Promise<void> {
  if (!config.SCENE_ASSEMBLY_HEYGEN_CLIP_FALLBACK) return;
  if (!config.HEYGEN_API_KEY?.trim()) return;

  const anyMissing = scenes.some((sc) => !extractSceneClipUrl(sc) && scenePrimaryPrompt(sc));
  if (!anyMissing) return;

  const rows = await listHeygenConfig(db, job.project_id);
  const flowType = "Video_Prompt_HeyGen_NoAvatar";
  const renderMode = "HEYGEN_NO_AVATAR";
  const merged = mergeHeygenConfigForJob(rows, job.platform, flowType, renderMode);
  applyHeygenEnvAvatarDefaults(merged, config);
  const postPath = resolveHeygenGeneratePath(flowType, renderMode);

  const clipHintSec = Math.min(100, Math.max(1, Math.round(Number(config.SCENE_ASSEMBLY_CLIP_DURATION_SEC) || 4)));
  const sceneAgentMin = config.HEYGEN_SCENE_AGENT_CLIP_MIN_SEC;
  const sceneDurationSec = Math.max(sceneAgentMin, clipHintSec);

  const globalVisualContext =
    config.SCENE_PREPEND_GLOBAL_CONTEXT_TO_CLIP_PROMPTS
      ? buildSceneAssemblyGlobalVisualContext({ gen, bundle })
      : "";

  const heygenClipTotal = scenes.filter((sc) => !extractSceneClipUrl(sc) && scenePrimaryPrompt(sc)).length;
  let heygenClipDone = 0;
  if (heygenClipTotal > 0) {
    await db.query(
      `UPDATE caf_core.content_jobs SET render_state = $1::jsonb, updated_at = now() WHERE id = $2`,
      [
        JSON.stringify({
          provider: "video",
          status: "in_progress",
          phase: "heygen_scene_clips",
          scene_clip_done: 0,
          scene_clip_total: heygenClipTotal,
        }),
        job.id,
      ]
    );
  }

  for (let i = 0; i < scenes.length; i++) {
    const sc = scenes[i]!;
    if (extractSceneClipUrl(sc)) continue;
    const prompt = scenePrimaryPrompt(sc);
    if (!prompt) continue;

    const video_prompt = globalVisualContext.trim()
      ? `${globalVisualContext.slice(0, 3500)}\n\n---\n\nSegment visual (this shot only):\n${prompt}`
      : prompt;

    const body = buildHeyGenVideoAgentRequestBody(
      merged,
      { video_prompt, estimated_runtime_seconds: clipHintSec },
      undefined,
      {
        flowType,
        taskId: job.task_id,
        avatarPickSeed: `${job.task_id}__scene_${i}`,
        agentMode: "no_avatar",
        durationBounds: {
          minSec: sceneAgentMin,
          maxSec: 120,
          missingFallbackSec: sceneDurationSec,
        },
      }
    );

    const { videoUrl } = await runHeygenVideoWithBody(
      config,
      body,
      {
        db,
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        step: "heygen_scene_assembly_clip",
        scene_index: i,
      },
      { postPath }
    );
    sc.rendered_scene_url = videoUrl;
    heygenClipDone += 1;
    await persistSceneAssemblyClipProgress(
      db,
      job.id,
      gen,
      bundle,
      scenes,
      "heygen_scene_clips",
      heygenClipDone,
      heygenClipTotal,
      i
    );
  }
}

export async function pollVideoAssemblyJob(
  baseUrl: string,
  requestId: string,
  maxMs = 600_000
): Promise<{ public_url?: string; local_path?: string }> {
  const start = Date.now();
  let delay = 2000;
  const statusUrl = `${baseUrl.replace(/\/$/, "")}/status/${requestId}`;
  while (Date.now() - start < maxMs) {
    const pollTimeoutMs = Math.min(30_000, Math.max(5000, Math.floor(delay * 1.2)));
    const r = await fetch(statusUrl, { signal: AbortSignal.timeout(pollTimeoutMs) });
    const raw = await r.text();
    const j = parseVideoAssemblyJson(raw, r.status, "video-assembly status", statusUrl) as {
      status?: string;
      error?: string;
      public_url?: string;
      local_path?: string;
    };
    if (j.status === "done") return { public_url: j.public_url, local_path: j.local_path };
    if (j.status === "error") throw new Error(j.error ?? "video-assembly error");
    await new Promise((x) => setTimeout(x, delay));
    delay = Math.min(delay * 2, 30_000);
  }
  throw new Error("video-assembly async timeout");
}

/** Summary for admin UI / merge-from-storage (concat + optional TTS/mux). */
export type ScenePipelineReport = {
  scene_count: number;
  concat_ok: boolean;
  merged_object_path: string | null;
  voiceover_uploaded: boolean;
  subtitles_uploaded: boolean;
  /** True when SRT was sent to video-assembly and mux finished (burned into final MP4). */
  subtitles_burned_into_video: boolean;
  mux_completed: boolean;
  mux_error: string | null;
  final_video_object_path: string | null;
  warnings: string[];
  /** Probed from merged MP4 buffer (seconds); null if unknown. */
  probed_merged_video_duration_sec: number | null;
  /** Probed from TTS MP3 (seconds); null if unknown. */
  probed_voiceover_duration_sec: number | null;
  /** When set, video-assembly applied ffmpeg atempo so voiceover length matches video (T_audio/T_video). */
  mux_audio_atempo_product: number | null;
  /** Max words allowed before TTS from timeline × wpm × SCENE_VO_WORD_BUDGET_SAFETY. */
  spoken_script_max_words_budget: number | null;
  /** True when spoken_script was shortened to fit probed clip timeline. */
  spoken_script_trimmed_for_timeline: boolean;
};

export async function runScenePipeline(
  db: Pool,
  config: AppConfig,
  videoAssemblyBaseUrl: string,
  job: {
    id: string;
    task_id: string;
    project_id: string;
    run_id: string;
    flow_type: string;
    platform: string | null;
    generation_payload: Record<string, unknown>;
  },
  opts?: { skipEnsureSceneBundle?: boolean }
): Promise<ScenePipelineReport> {
  if (!opts?.skipEnsureSceneBundle) {
    const bundlePrep = await ensureSceneBundleInPayload(db, config, job.id);
    if (!bundlePrep.ok) {
      throw new Error(bundlePrep.error ?? "scene bundle preparation failed");
    }
  }
  const fresh = await qOne<{
    id: string;
    task_id: string;
    project_id: string;
    run_id: string;
    flow_type: string;
    platform: string | null;
    generation_payload: Record<string, unknown>;
  }>(db, `SELECT * FROM caf_core.content_jobs WHERE id = $1`, [job.id]);
  if (!fresh) throw new Error("job missing after scene bundle");
  job = fresh;

  const gen = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
  const bundle = (gen.scene_bundle as Record<string, unknown>) ?? {};
  const rawScenes = (bundle.scenes as unknown[]) ?? [];
  const coerced: Record<string, unknown>[] = [];
  for (const x of rawScenes) {
    if (x && typeof x === "object" && !Array.isArray(x)) coerced.push(x as Record<string, unknown>);
  }
  let scenes = applySceneTargetsToScenes(coerced, config);
  const minExpand = expandSceneAssemblyToMinScenes(scenes, gen, config);
  scenes = minExpand.scenes;
  if (minExpand.didPad) {
    bundle.scenes = scenes;
    gen.scene_bundle = bundle;
    await db.query(
      `UPDATE caf_core.content_jobs SET generation_payload = jsonb_set(
        COALESCE(generation_payload,'{}'::jsonb),
        '{generated_output}',
        (COALESCE(generation_payload->'generated_output','{}'::jsonb) || $1::jsonb),
        true
      ), updated_at = now() WHERE id = $2`,
      [JSON.stringify({ scene_bundle: bundle }), job.id]
    );
  }
  if (scenes.length === 0) {
    throw new Error("scene_bundle.scenes is empty — configure scene assembly prompts or payload");
  }

  const report: ScenePipelineReport = {
    scene_count: scenes.length,
    concat_ok: false,
    merged_object_path: null,
    voiceover_uploaded: false,
    subtitles_uploaded: false,
    subtitles_burned_into_video: false,
    mux_completed: false,
    mux_error: null,
    final_video_object_path: null,
    warnings: [],
    probed_merged_video_duration_sec: null,
    probed_voiceover_duration_sec: null,
    mux_audio_atempo_product: null,
    spoken_script_max_words_budget: null,
    spoken_script_trimmed_for_timeline: false,
  };

  if (minExpand.didPad) {
    report.warnings.push(
      `scene_count_padded_to_minimum: ${minExpand.countBefore}→${scenes.length} scenes (min ${config.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN})`
    );
  }

  const needsClipRender = scenes.some((sc) => !extractSceneClipUrl(sc) && scenePrimaryPrompt(sc));
  if (needsClipRender) {
    if (config.SCENE_ASSEMBLY_CLIP_PROVIDER === "sora") {
      await maybeRenderMissingSceneClipsWithSora(db, config, job, scenes, bundle, gen);
    } else if (config.SCENE_ASSEMBLY_CLIP_PROVIDER === "heygen" && config.SCENE_ASSEMBLY_HEYGEN_CLIP_FALLBACK) {
      await maybeRenderMissingSceneClipsWithHeyGen(db, config, job, scenes, bundle, gen);
    }
  }

  await db.query(
    `UPDATE caf_core.content_jobs SET render_state = $1::jsonb, updated_at = now() WHERE id = $2`,
    [
      JSON.stringify({
        provider: "video",
        status: "in_progress",
        phase: "scene_import_concat",
        scene_total: scenes.length,
      }),
      job.id,
    ]
  );

  const sceneUrls: string[] = [];
  /** Probed duration of each imported MP4 (aligned with `sceneUrls` / `scenes` order). */
  const sceneClipProbeSec: (number | null)[] = [];
  let ord = 0;
  for (const raw of scenes) {
    if (!raw || typeof raw !== "object") continue;
    const sc = raw as Record<string, unknown>;
    let clipUrl = extractSceneClipUrl(sc);
    if (!clipUrl) {
      const sid = String(sc.scene_id ?? ord);
      const fullPrompt = String(sc.video_prompt ?? sc.scene_prompt ?? sc.prompt ?? "").trim();
      const hintPreview = fullPrompt.slice(0, 120);
      throw new Error(
        `Scene assembly: scene ${sid} has no public clip URL (rendered_scene_url, video_url, …). ` +
          `Add URLs on each scene, or SCENE_ASSEMBLY_CLIP_PROVIDER=sora with OPENAI_API_KEY + Supabase, ` +
          `or explicitly SCENE_ASSEMBLY_CLIP_PROVIDER=heygen with SCENE_ASSEMBLY_HEYGEN_CLIP_FALLBACK=1 and HEYGEN_API_KEY. ` +
          (hintPreview ? `Prompt preview: ${hintPreview}` : "")
      );
    }

    const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const sid = String(sc.scene_id ?? ord).replace(/[^a-zA-Z0-9_-]/g, "_");

    let urlForStitch = clipUrl;
    let publicUrl: string | null = clipUrl;
    let objectPath: string | null = null;
    let probedSceneSec: number | null = null;
    try {
      const buf = await downloadBufferFromUrl(config, clipUrl);
      probedSceneSec = await probeMediaDurationSec(buf);
      const relPath = `scenes/${safeRun}/${safeTask}/scene_${sid}_imported.mp4`;
      const up = await uploadBuffer(config, relPath, buf, "video/mp4");
      objectPath = up.object_path;
      if (up.public_url) {
        publicUrl = up.public_url;
      }
      // video-assembly only does anonymous fetch unless it has service role; private buckets need a signed URL here.
      const bucket = config.SUPABASE_ASSETS_BUCKET || "assets";
      const stitchSigned = await createSignedUrlForObjectKey(config, bucket, up.object_path, 14_400);
      urlForStitch =
        "signedUrl" in stitchSigned ? stitchSigned.signedUrl : (up.public_url ?? clipUrl);
    } catch {
      /* use original URL for stitch if copy to storage fails */
    }
    sceneClipProbeSec.push(probedSceneSec);

    await insertAsset(db, {
      asset_id: `${job.task_id}__SCENE_${ord}_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      task_id: job.task_id,
      project_id: job.project_id,
      asset_type: "SCENE_VIDEO",
      position: ord,
      bucket: config.SUPABASE_ASSETS_BUCKET,
      object_path: objectPath,
      public_url: publicUrl,
      provider: "scene_clip_url",
      metadata_json: { scene_id: sc.scene_id, source_url: clipUrl },
    });

    sceneUrls.push(urlForStitch);
    ord++;
  }

  if (sceneUrls.length === 0) throw new Error("no scene clips produced");

  const concatEndpoint = `${videoAssemblyBaseUrl.replace(/\/$/, "")}/concat-videos?async=1`;
  const concatPayload = { video_urls: sceneUrls, task_id: job.task_id, run_id: job.run_id };
  const concatRes = await fetch(concatEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(concatPayload),
  });
  const concatRaw = await concatRes.text();
  const concatJson = parseVideoAssemblyJson(concatRaw, concatRes.status, "concat-videos", concatEndpoint) as {
    request_id?: string;
    ok?: boolean;
  };
  if (!concatRes.ok || !concatJson.request_id) {
    throw new Error(`concat-videos failed (${concatRes.status}): ${concatRaw.slice(0, 600)}`);
  }
  const merged = await pollVideoAssemblyJob(
    videoAssemblyBaseUrl,
    concatJson.request_id,
    config.VIDEO_ASSEMBLY_CONCAT_POLL_MAX_MS
  );
  report.concat_ok = true;
  await tryInsertApiCallAudit(db, {
    projectId: job.project_id,
    runId: job.run_id,
    taskId: job.task_id,
    step: "video_assembly_concat",
    provider: "video_assembly",
    model: null,
    ok: true,
    requestJson: { endpoint: concatEndpoint, body: concatPayload },
    responseJson: { request_id: concatJson.request_id, public_url: merged.public_url },
  });
  let mergedUrl = merged.public_url;
  if (!mergedUrl && merged.local_path) {
    throw new Error("concat completed without public_url — configure Supabase on video-assembly or use sync concat from CAF Core");
  }

  if (mergedUrl) {
    const finalBuf = await downloadBufferFromUrl(config, mergedUrl);
    const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const finalPath = `videos/${safeRun}/${safeTask}/scene_merged.mp4`;
    let finalPublic: string | null = null;
    let mergedObjectPath: string = finalPath;
    try {
      const up = await uploadBuffer(config, finalPath, finalBuf, "video/mp4");
      finalPublic = up.public_url;
      mergedObjectPath = up.object_path;
    } catch {
      finalPublic = mergedUrl;
    }

    await insertAsset(db, {
      asset_id: `${job.task_id}__VIDEO_MERGED_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
      task_id: job.task_id,
      project_id: job.project_id,
      asset_type: "VIDEO",
      position: 100,
      bucket: config.SUPABASE_ASSETS_BUCKET,
      object_path: mergedObjectPath,
      public_url: finalPublic,
      provider: "scene_concat",
      metadata_json: { scene_count: sceneUrls.length },
    });
    report.merged_object_path = mergedObjectPath;

    const T_video_probe = await probeMediaDurationSec(finalBuf);
    report.probed_merged_video_duration_sec = T_video_probe;
    const clipDurs = mergeProbedClipDurations(
      scenes,
      config.SCENE_ASSEMBLY_CLIP_DURATION_SEC,
      sceneClipProbeSec,
      T_video_probe
    );
    const T_timeline = clipDurs.reduce((a, b) => a + b, 0);
    const probedClipCount = sceneClipProbeSec.filter((x) => x != null && x > 0.15).length;
    if (probedClipCount === 0 && scenes.length > 0) {
      report.warnings.push(
        "scene_clip_duration_probe_none: could not read MP4 duration on import — using planner clip lengths only; word budget may be off if real clips differ"
      );
    }

    let script = String(gen.spoken_script ?? gen.script ?? "").trim();
    const apiKey = config.OPENAI_API_KEY?.trim();
    const bucketForSign = config.SUPABASE_ASSETS_BUCKET || "assets";
    const signTtlSec = 14_400;

    if (!script || !apiKey) {
      if (!script) report.warnings.push("skipped_tts_mux: no spoken_script/script on generated_output");
      if (!apiKey) report.warnings.push("skipped_tts_mux: OPENAI_API_KEY not set");
    } else {
      try {
        let maxWords: number | null = null;
        let trimmedForTts = false;
        if (config.SCENE_ENFORCE_SPOKEN_SCRIPT_WORD_TRIM) {
          maxWords = Math.max(
            4,
            Math.floor(
              Math.max(0.2, T_timeline) *
                (config.SCENE_VO_WORDS_PER_MINUTE / 60) *
                config.SCENE_VO_WORD_BUDGET_SAFETY
            )
          );
          report.spoken_script_max_words_budget = maxWords;
          const fitted = fitSpokenScriptToWordBudget(script, clipDurs, maxWords);
          script = fitted.script;
          trimmedForTts = fitted.trimmed;
          report.spoken_script_trimmed_for_timeline = fitted.trimmed;
          if (fitted.trimmed) {
            report.warnings.push(
              `spoken_script_trimmed_for_timeline: ${fitted.wordsBefore}→${fitted.wordsAfter} words (budget ${maxWords} for ~${T_timeline.toFixed(1)}s)`
            );
            gen.spoken_script = script;
            gen.script = script;
            await db.query(
              `UPDATE caf_core.content_jobs SET generation_payload = jsonb_set(
                COALESCE(generation_payload,'{}'::jsonb),
                '{generated_output}',
                (COALESCE(generation_payload->'generated_output','{}'::jsonb) || $1::jsonb),
                true
              ), updated_at = now() WHERE id = $2`,
              [JSON.stringify({ spoken_script: script, script }), job.id]
            );
          }
        } else {
          report.spoken_script_max_words_budget = null;
          report.spoken_script_trimmed_for_timeline = false;
        }

        const audioPath = `audios/${safeRun}/${safeTask}/voiceover.mp3`;
        const tts = await synthesizeSpeechToStorage(config, apiKey, script, audioPath);
        report.voiceover_uploaded = true;
        report.probed_voiceover_duration_sec = tts.duration_sec;
        if (tts.duration_sec == null) {
          report.warnings.push(
            "voiceover_duration_unknown: could not probe TTS MP3 — duration checks skipped; captions may drift vs audio"
          );
        }
        await tryInsertApiCallAudit(db, {
          projectId: job.project_id,
          runId: job.run_id,
          taskId: job.task_id,
          step: "openai_tts_voiceover",
          provider: "openai",
          model: config.OPENAI_TTS_MODEL,
          ok: true,
          requestJson: {
            endpoint: "https://api.openai.com/v1/audio/speech",
            voice: config.OPENAI_TTS_VOICE,
            input_excerpt: script.slice(0, 8000),
            spoken_script_word_budget: maxWords,
            spoken_script_trimmed: trimmedForTts,
          },
          responseJson: {
            object_path: tts.object_path,
            public_url: tts.public_url,
            duration_sec: tts.duration_sec,
          },
        });
        const strictLines = narrationLinesAlignedWithScript(scenes, script);
        const looseLines = !strictLines ? narrationLinesLooseConcatMatchesScript(scenes, script) : null;
        if (!strictLines && !looseLines && sceneNarrationLinesStrict(scenes)) {
          report.warnings.push(
            "scene_narration_lines_not_aligned_with_spoken_script: using duration-weighted subtitle chunks; set scene_narration_line to consecutive slices of spoken_script (same words, same order)"
          );
        }
        const linesForSrt = strictLines ?? looseLines ?? splitScriptIntoSceneChunksByWeights(script, clipDurs);
        const { srt } = buildSrtFromScenesWithSentenceCues(
          linesForSrt,
          clipDurs,
          config.SCENE_ASSEMBLY_CLIP_DURATION_SEC,
          { minCueSec: config.SCENE_SUBTITLE_MIN_CUE_SEC }
        );
        const srtPath = `subtitles/${safeRun}/${safeTask}/captions.srt`;
        const srtUp = await uploadBuffer(config, srtPath, Buffer.from(srt, "utf8"), "text/plain; charset=utf-8");
        report.subtitles_uploaded = true;

        const videoSign = await createSignedUrlForObjectKey(config, bucketForSign, mergedObjectPath, signTtlSec);
        const audioSign = await createSignedUrlForObjectKey(config, bucketForSign, tts.object_path, signTtlSec);
        const srtSign = await createSignedUrlForObjectKey(config, bucketForSign, srtUp.object_path, signTtlSec);
        const videoMuxUrl =
          "signedUrl" in videoSign ? videoSign.signedUrl : (finalPublic ?? mergedUrl ?? "");
        const audioMuxUrl =
          "signedUrl" in audioSign ? audioSign.signedUrl : (tts.public_url ?? "");
        const subtitlesMuxUrl = "signedUrl" in srtSign ? srtSign.signedUrl : null;
        if (!subtitlesMuxUrl) {
          report.warnings.push(
            `subtitles_url_unsigned: ${"error" in srtSign ? srtSign.error : "missing"} — mux will omit burned captions`
          );
        }
        if (!videoMuxUrl) {
          report.mux_error = `no fetchable video URL for mux (${"error" in videoSign ? videoSign.error : "missing public fallback"})`;
        } else if (!audioMuxUrl) {
          report.mux_error = `no fetchable audio URL for mux (${"error" in audioSign ? audioSign.error : "missing public_url"})`;
        } else {
          const muxEndpoint = `${videoAssemblyBaseUrl.replace(/\/$/, "")}/mux?async=1`;
          const muxBody: Record<string, unknown> = {
            video_url: videoMuxUrl,
            audio_url: audioMuxUrl,
            task_id: job.task_id,
            run_id: job.run_id,
          };
          if (subtitlesMuxUrl) muxBody.subtitles_url = subtitlesMuxUrl;
          const T_video_timeline = clipDurs.reduce((a, b) => a + b, 0);
          const T_audio = tts.duration_sec;
          const stretchForMux =
            config.SCENE_MUX_STRETCH_AUDIO_TO_VIDEO || config.SCENE_ASSEMBLY_STRETCH_TTS_TO_VIDEO;
          if (
            stretchForMux &&
            T_audio != null &&
            T_audio > 0.2 &&
            T_video_timeline > 0.2 &&
            Number.isFinite(T_video_timeline)
          ) {
            const ratio = T_audio / T_video_timeline;
            if (ratio < 0.985 || ratio > 1.015) {
              muxBody.options = { audio_atempo_product: ratio };
              report.mux_audio_atempo_product = ratio;
              report.warnings.push(
                `mux_audio_time_stretch: TTS ${T_audio.toFixed(2)}s vs video ${T_video_timeline.toFixed(2)}s → atempo product ${ratio.toFixed(4)}`
              );
            }
          } else if (
            !stretchForMux &&
            T_audio != null &&
            T_audio > 0.2 &&
            T_video_timeline > 0.2 &&
            Number.isFinite(T_video_timeline)
          ) {
            const ratio = T_audio / T_video_timeline;
            if (ratio < 0.92 || ratio > 1.08) {
              report.warnings.push(
                `voiceover_vs_video_duration: TTS ~${T_audio.toFixed(1)}s vs video ~${T_video_timeline.toFixed(1)}s at 1× (mux stretch off). Set SCENE_ASSEMBLY_STRETCH_TTS_TO_VIDEO=true (default) or SCENE_MUX_STRETCH_AUDIO_TO_VIDEO=true, or trim spoken_script.`
              );
            }
          }
          const muxRes = await fetch(muxEndpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(muxBody),
          });
          const muxRaw = await muxRes.text();
          const muxJson = parseVideoAssemblyJson(muxRaw, muxRes.status, "video-assembly mux", muxEndpoint) as {
            request_id?: string;
          };
          if (!muxRes.ok || !muxJson.request_id) {
            report.mux_error = `mux start failed (${muxRes.status}): ${muxRaw.slice(0, 1200)}`;
          } else {
            const muxed = await pollVideoAssemblyJob(
              videoAssemblyBaseUrl,
              muxJson.request_id,
              config.VIDEO_ASSEMBLY_MUX_POLL_MAX_MS
            );
            await tryInsertApiCallAudit(db, {
              projectId: job.project_id,
              runId: job.run_id,
              taskId: job.task_id,
              step: "video_assembly_mux",
              provider: "video_assembly",
              model: null,
              ok: true,
              requestJson: {
                endpoint: muxEndpoint,
                video_object_path: mergedObjectPath,
                audio_object_path: tts.object_path,
                subtitles_object_path: subtitlesMuxUrl ? srtUp.object_path : null,
                subtitles_burn: Boolean(subtitlesMuxUrl),
              },
              responseJson: { request_id: muxJson.request_id, public_url: muxed.public_url },
            });
            if (!muxed.public_url) {
              report.mux_error =
                "mux job completed without public_url — set SUPABASE_* on video-assembly or check mux logs";
            } else {
              const muxBuf = await downloadBufferFromUrl(config, muxed.public_url);
              const outPath = `videos/${safeRun}/${safeTask}/final_muxed.mp4`;
              const up = await uploadBuffer(config, outPath, muxBuf, "video/mp4");
              report.mux_completed = true;
              report.final_video_object_path = up.object_path;
              if (subtitlesMuxUrl) report.subtitles_burned_into_video = true;
              await insertAsset(db, {
                asset_id: `${job.task_id}__VIDEO_FINAL_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
                task_id: job.task_id,
                project_id: job.project_id,
                asset_type: "VIDEO",
                position: 200,
                bucket: config.SUPABASE_ASSETS_BUCKET,
                object_path: up.object_path,
                public_url: up.public_url,
                provider: "mux",
                metadata_json: { subtitles_burned: Boolean(subtitlesMuxUrl) },
              });
            }
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        report.mux_error = report.mux_error ?? msg;
        report.warnings.push(`tts_mux: ${msg}`);
      }
    }
  }

  await db.query(
    `UPDATE caf_core.content_jobs SET scene_bundle_state = $1::jsonb, updated_at = now() WHERE id = $2`,
    [
      JSON.stringify({
        status: "completed",
        scene_count: sceneUrls.length,
        merged_url: mergedUrl ?? null,
        mux_completed: report.mux_completed,
        mux_error: report.mux_error,
        final_video_object_path: report.final_video_object_path,
        subtitles_burned_into_video: report.subtitles_burned_into_video,
        pipeline_warnings: report.warnings,
        content_policy: {
          scene_target_min: config.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN,
          scene_target_max: config.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX,
          clip_duration_sec: config.SCENE_ASSEMBLY_CLIP_DURATION_SEC,
          assembly_model: "script_first",
          prepend_global_clip_context: config.SCENE_PREPEND_GLOBAL_CONTEXT_TO_CLIP_PROMPTS,
          enforce_spoken_script_trim: config.SCENE_ENFORCE_SPOKEN_SCRIPT_WORD_TRIM,
        },
      }),
      job.id,
    ]
  );

  return report;
}
