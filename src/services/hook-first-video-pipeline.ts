/**
 * Hook-first hybrid video pipeline: HeyGen AI hook clip (4–8s) + HeyGen body (avatar / video agent) → concat.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { insertAsset } from "../repositories/assets.js";
import { listHeygenConfig } from "../repositories/project-config.js";
import { fetchableUrlForVideoAssembly, uploadBuffer } from "./supabase-storage.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import { pickRenderState } from "../domain/content-job-render-state.js";
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import {
  clampHookClipDurationSec,
  extractHookScenePrompt,
  hookFirstBodyFlowType,
  isHookFirstVideoFlow,
  resolveHookClipProvider,
  resolveHookFirstBodyLane,
} from "../domain/hook-first-video.js";
import { ensureHookFirstVideoInPayload } from "./hook-first-video-prep.js";
import { createUploadSoraSceneClip } from "./sora-scene-clips.js";
import {
  applyHeygenEnvAvatarDefaults,
  buildHeyGenRequestBody,
  buildHeyGenVideoAgentRequestBody,
  mergeHeygenConfigForJob,
  resolveHeygenGeneratePath,
  resolveHeygenRenderMode,
  runHeygenVideoWithBody,
  resumeHeygenVideoPoll,
  mapHeyGenV2StyleBodyToV3CreateVideoAvatar,
  type HeygenGeneratePath,
  type HeygenSubmitProgress,
} from "./heygen-renderer.js";
import { enforceHeygenSpokenScriptWordLaw } from "./heygen-spoken-script-enforcement.js";
import { fetchVideoAssemblyJobOutput, pollVideoAssemblyJob, parseVideoAssemblyJson } from "./video-assembly-client.js";
import { extractSpokenScriptText } from "./video-gen-fields.js";

type HookFirstJob = {
  id: string;
  task_id: string;
  project_id: string;
  run_id: string;
  flow_type: string;
  platform: string | null;
  generation_payload: Record<string, unknown>;
};

async function persistHookFirstState(
  db: Pool,
  jobId: string,
  generationPayload: Record<string, unknown>,
  renderState: Record<string, unknown>
): Promise<void> {
  await db.query(
    `UPDATE caf_core.content_jobs SET
       generation_payload = $1::jsonb,
       render_state = $2::jsonb,
       updated_at = now()
     WHERE id = $3`,
    [JSON.stringify(generationPayload), JSON.stringify(renderState), jobId]
  );
}

function hookClipProvider(config: AppConfig): "sora" | "heygen" {
  return resolveHookClipProvider(config);
}

function buildHookClipAgentPrompt(
  hookScenePrompt: string,
  hookLine: string,
  durationSec: number,
  hookAudioDirection?: string | null
): string {
  const line = hookLine.trim();
  const sfx = String(hookAudioDirection ?? "").trim();
  const audioLines = line
    ? [
        "AUDIO / VO (required — must be audible and engaging, not silent)",
        `- Deliver this hook line as off-screen narrator or in-scene vocal reaction (no on-screen talking head): "${line}"`,
        "- Layer cinematic SFX and ambient sound that match the action (impacts, environment, texture)",
        sfx ? `- Sound direction: ${sfx}` : "",
        "- Mix for mobile playback — voice + SFX clear in the first second",
      ].filter(Boolean)
    : [
        "AUDIO (required — must be audible and engaging, not silent)",
        "- Cinematic SFX, diegetic sounds, and/or a brief off-screen exclamation tied to the visual beat",
        sfx ? `- Sound direction: ${sfx}` : "- Visceral ambient bed plus a punchy impact on the pattern-interrupt moment",
      ];

  return [
    "CAF HOOK CLIP BRIEF",
    "",
    "OBJECTIVE",
    `- Duration: about ${durationSec} seconds (entire clip — no longer)`,
    "- Format: portrait short-form hook opener",
    "- Primary goal: scroll-stopping cinematic hook — emotional reaction, pattern interrupt, **with sound**",
    "",
    "DELIVERY MODE",
    "- No on-screen avatar, presenter, or talking head",
    "- No on-screen text or hashtags",
    "- AI-generated cinematic footage (not stock montage unless brief specifies mood)",
    "",
    ...audioLines,
    "",
    "VISUAL / GENERATION PROMPT",
    hookScenePrompt,
    "",
    "FINAL CHECK",
    "- Single continuous hook moment with a clear audio hook; end on a beat that cuts into a presenter segment",
  ].join("\n");
}

function heygenSegmentProgress(
  db: Pool,
  jobId: string,
  phase: "hook_clip" | "body_heygen"
): HeygenSubmitProgress {
  return {
    onSession: async (sessionId) => {
      await mergeHookFirstRenderState(db, jobId, {
        provider: "hook-first-video",
        status: "in_progress",
        phase,
        session_id: sessionId,
      });
    },
    onVideoId: async (videoId) => {
      await mergeHookFirstRenderState(db, jobId, {
        provider: "hook-first-video",
        status: "in_progress",
        phase,
        video_id: videoId,
      });
    },
  };
}

function clearedHeygenResumeKeys(): Record<string, string> {
  return { video_id: "", session_id: "" };
}

async function renderHookClipSora(
  config: AppConfig,
  db: Pool,
  job: HookFirstJob,
  hookScenePrompt: string,
  hookLine: string,
  durationSec: number
): Promise<string> {
  const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const storageObjectPath = `hooks/${safeRun}/${safeTask}/hook_clip.mp4`;

  const globalContext = hookLine.trim()
    ? `Hook line (may be spoken off-screen + cinematic SFX): ${hookLine.trim()}. Engaging audio required — not silent.`
    : "Engaging cinematic SFX and ambient audio required — not silent.";

  const { publicUrl } = await createUploadSoraSceneClip(config, {
    prompt: hookScenePrompt,
    global_visual_context: globalContext,
    taskId: job.task_id,
    runId: job.run_id,
    sceneIndex: 0,
    clipDurationSec: durationSec,
    storageObjectPath,
    audit: {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      scene_index: 0,
    },
  });
  return publicUrl;
}

async function renderHookClipHeyGen(
  config: AppConfig,
  db: Pool,
  job: HookFirstJob,
  hookScenePrompt: string,
  hookLine: string,
  durationSec: number,
  hookAudioDirection?: string | null
): Promise<string> {
  const apiKey = config.HEYGEN_API_KEY?.trim();
  if (!apiKey) throw new Error("HEYGEN_API_KEY required for hook clip (provider=heygen)");

  /** Compact Video Agent brief — cinematic hook with spoken line + SFX (not the full 12s body production brief). */
  const body: Record<string, unknown> = {
    prompt: buildHookClipAgentPrompt(hookScenePrompt, hookLine, durationSec, hookAudioDirection),
    orientation: "portrait",
    duration_sec: durationSec,
  };

  const { videoUrl } = await runHeygenVideoWithBody(
    config,
    body,
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: "hook_first_clip_heygen",
      scene_index: 0,
    },
    { postPath: "/v3/video-agents", progress: heygenSegmentProgress(db, job.id, "hook_clip") }
  );
  return videoUrl;
}

async function loadJobRenderState(db: Pool, jobId: string): Promise<ReturnType<typeof pickRenderState>> {
  const row = await qOne<{ render_state: unknown }>(
    db,
    `SELECT render_state FROM caf_core.content_jobs WHERE id = $1`,
    [jobId]
  );
  return pickRenderState(row?.render_state);
}

async function resolveHookClipUrl(
  config: AppConfig,
  db: Pool,
  job: HookFirstJob,
  gen: Record<string, unknown>,
  hookScenePrompt: string,
  hookLine: string,
  durationSec: number,
  hookAudioDirection?: string | null
): Promise<string> {
  const existing = String(gen.hook_clip_url ?? "").trim();
  if (existing) return existing;

  await mergeHookFirstRenderState(db, job.id, {
    provider: "hook-first-video",
    status: "in_progress",
    phase: "hook_clip",
    hook_clip_provider: hookClipProvider(config),
  });

  const rs = await loadJobRenderState(db, job.id);
  const provider = hookClipProvider(config);
  if (rs.video_id && rs.phase === "hook_clip") {
    const resumed = await resumeHeygenVideoPoll(
      config,
      rs.video_id,
      {
        db,
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        step: "hook_first_clip_heygen_resume",
        scene_index: 0,
      },
      { postPath: "/v3/video-agents" }
    );
    return resumed.videoUrl;
  }

  return provider === "sora"
    ? await renderHookClipSora(config, db, job, hookScenePrompt, hookLine, durationSec)
    : await renderHookClipHeyGen(config, db, job, hookScenePrompt, hookLine, durationSec, hookAudioDirection);
}

async function resolveBodyVideoUrl(
  config: AppConfig,
  db: Pool,
  job: HookFirstJob,
  gen: Record<string, unknown>,
  bodyLane: ReturnType<typeof resolveHookFirstBodyLane>
): Promise<string> {
  const existing = String(gen.body_video_url ?? "").trim();
  if (existing) return existing;

  await mergeHookFirstRenderState(db, job.id, {
    provider: "hook-first-video",
    status: "in_progress",
    phase: "body_heygen",
  });

  const rs = await loadJobRenderState(db, job.id);
  if (rs.video_id && rs.phase === "body_heygen") {
    const bodyFlowType = hookFirstBodyFlowType(bodyLane);
    const renderMode = resolveHeygenRenderMode(
      bodyFlowType,
      job.generation_payload.render_mode ?? gen.render_mode ?? gen.production_route
    );
    const postPath = resolveHeygenGeneratePath(bodyFlowType, renderMode);
    const resumed = await resumeHeygenVideoPoll(
      config,
      rs.video_id,
      {
        db,
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        step: "hook_first_body_heygen_resume",
      },
      { postPath }
    );
    return resumed.videoUrl;
  }

  return renderBodyHeyGen(config, db, job, gen, bodyLane);
}

async function renderBodyHeyGen(
  config: AppConfig,
  db: Pool,
  job: HookFirstJob,
  gen: Record<string, unknown>,
  bodyLane: ReturnType<typeof resolveHookFirstBodyLane>
): Promise<string> {
  const apiKey = config.HEYGEN_API_KEY?.trim();
  if (!apiKey) throw new Error("HEYGEN_API_KEY not configured");

  const bodyFlowType = hookFirstBodyFlowType(bodyLane);
  const enforced = await enforceHeygenSpokenScriptWordLaw(
    db,
    config,
    {
      id: job.id,
      task_id: job.task_id,
      project_id: job.project_id,
      run_id: job.run_id,
    },
    { ...gen }
  );
  const bodyGen = enforced.gen;

  const rows = await listHeygenConfig(db, job.project_id);
  const renderMode = resolveHeygenRenderMode(
    bodyFlowType,
    job.generation_payload.render_mode ?? bodyGen.render_mode ?? bodyGen.production_route
  );
  const merged = mergeHeygenConfigForJob(rows, job.platform, bodyFlowType, renderMode);
  applyHeygenEnvAvatarDefaults(merged, config);
  const override = job.generation_payload.heygen_request as Record<string, unknown> | undefined;

  let postPath: HeygenGeneratePath = resolveHeygenGeneratePath(bodyFlowType, renderMode);
  let body: Record<string, unknown>;

  if (postPath === "/v3/videos") {
    body = buildHeyGenRequestBody(merged, bodyGen, override, {
      defaultVoiceId: config.HEYGEN_DEFAULT_VOICE_ID,
      flowType: bodyFlowType,
      taskId: job.task_id,
      visualOnlySilenceDurationSec: config.HEYGEN_VISUAL_ONLY_SILENCE_DURATION_SEC,
    });
    body = mapHeyGenV2StyleBodyToV3CreateVideoAvatar(body);
  } else {
    body = buildHeyGenVideoAgentRequestBody(merged, bodyGen, override, {
      flowType: bodyFlowType,
      taskId: job.task_id,
      platform: job.platform,
      agentMode: renderMode === "HEYGEN_NO_AVATAR" ? "no_avatar" : "prompt_avatar",
      durationBounds: {
        minSec: config.HEYGEN_AGENT_MIN_DURATION_SEC,
        maxSec: 300,
        missingFallbackSec: config.VIDEO_TARGET_DURATION_MIN_SEC,
      },
      spokenMode: "user_provided",
    });
  }

  const heygenResult = await runHeygenVideoWithBody(
    config,
    body,
    {
      db,
      projectId: job.project_id,
      runId: job.run_id,
      taskId: job.task_id,
      step: "hook_first_body_heygen",
    },
    { postPath, progress: heygenSegmentProgress(db, job.id, "body_heygen") }
  );

  return heygenResult.videoUrl;
}

async function concatHookAndBody(
  config: AppConfig,
  db: Pool,
  job: HookFirstJob,
  videoAssemblyBaseUrl: string,
  hookUrl: string,
  bodyUrl: string
): Promise<{ publicUrl: string; objectPath: string }> {
  const concatEndpoint = `${videoAssemblyBaseUrl.replace(/\/$/, "")}/concat-videos?async=1`;
  // video-assembly fetches clips anonymously unless it has Supabase service role; sign our bucket URLs first.
  const [hookFetchUrl, bodyFetchUrl] = await Promise.all([
    fetchableUrlForVideoAssembly(config, hookUrl),
    fetchableUrlForVideoAssembly(config, bodyUrl),
  ]);
  const concatPayload = { video_urls: [hookFetchUrl, bodyFetchUrl], task_id: job.task_id, run_id: job.run_id };
  const concatRes = await fetch(concatEndpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(concatPayload),
  });
  const concatRaw = await concatRes.text();
  const concatJson = parseVideoAssemblyJson(concatRaw, concatRes.status, "concat-videos", concatEndpoint) as {
    request_id?: string;
  };
  if (!concatRes.ok || !concatJson.request_id) {
    throw new Error(`hook-first concat failed (${concatRes.status}): ${concatRaw.slice(0, 600)}`);
  }

  const merged = await pollVideoAssemblyJob(
    videoAssemblyBaseUrl,
    concatJson.request_id,
    config.VIDEO_ASSEMBLY_CONCAT_POLL_MAX_MS
  );

  await tryInsertApiCallAudit(db, {
    projectId: job.project_id,
    runId: job.run_id,
    taskId: job.task_id,
    step: "hook_first_concat",
    provider: "video_assembly",
    model: null,
    ok: true,
    requestJson: { endpoint: concatEndpoint, body: concatPayload },
    responseJson: {
      request_id: concatJson.request_id,
      public_url: merged.public_url,
      upload_error: merged.upload_error ?? null,
    },
  });

  const finalBuf = await fetchVideoAssemblyJobOutput(
    videoAssemblyBaseUrl,
    concatJson.request_id,
    merged,
    { timeoutMs: config.VIDEO_ASSEMBLY_CONCAT_POLL_MAX_MS }
  );
  const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const finalPath = `videos/${safeRun}/${safeTask}/hook_first_merged.mp4`;

  const up = await uploadBuffer(config, finalPath, finalBuf, "video/mp4");
  if (!up.public_url?.trim()) {
    throw new Error("hook-first final upload to Supabase failed");
  }

  return { publicUrl: up.public_url.trim(), objectPath: up.object_path };
}

export async function runHookFirstVideoPipeline(
  db: Pool,
  config: AppConfig,
  videoAssemblyBaseUrl: string,
  job: HookFirstJob
): Promise<void> {
  if (!isHookFirstVideoFlow(job.flow_type)) {
    throw new Error(`runHookFirstVideoPipeline: unsupported flow_type ${job.flow_type}`);
  }
  if (!config.HEYGEN_API_KEY?.trim()) {
    throw new Error("HEYGEN_API_KEY required for hook-first video body segment");
  }

  await mergeHookFirstRenderState(db, job.id, { provider: "hook-first-video", status: "in_progress", phase: "prep" });

  const prep = await ensureHookFirstVideoInPayload(db, config, job.id);
  if (!prep.ok) throw new Error(prep.error ?? "hook-first prep failed");

  const fresh = await qOne<HookFirstJob>(
    db,
    `SELECT id, task_id, project_id, run_id, flow_type, platform, generation_payload FROM caf_core.content_jobs WHERE id = $1`,
    [job.id]
  );
  if (!fresh) throw new Error("job not found after hook-first prep");

  const payload = fresh.generation_payload;
  let gen = pickGeneratedOutputOrEmpty(payload);
  const hookScenePrompt = extractHookScenePrompt(gen, 20);
  if (!hookScenePrompt) throw new Error("hook-first: missing hook_scene_prompt");

  const hookLine = String(gen.hook ?? gen.hook_line ?? "").trim();
  const hookAudioDirection = String(gen.hook_audio_direction ?? gen.hook_sound_direction ?? "").trim() || null;
  const durationSec = clampHookClipDurationSec(
    gen.hook_duration_sec ?? config.HOOK_FIRST_HOOK_DURATION_SEC,
    config.HOOK_FIRST_HOOK_DURATION_SEC
  );
  const bodyLane = resolveHookFirstBodyLane(gen.body_lane ?? gen.video_lane ?? gen.hook_first_body_lane);

  let hookClipUrl = await resolveHookClipUrl(
    config,
    db,
    fresh,
    gen,
    hookScenePrompt,
    hookLine,
    durationSec,
    hookAudioDirection
  );
  if (!String(gen.hook_clip_url ?? "").trim()) {
    gen = { ...gen, hook_clip_url: hookClipUrl, hook_clip_provider: hookClipProvider(config) };
    payload.generated_output = gen;
    await persistHookFirstState(db, fresh.id, payload, {
      provider: "hook-first-video",
      status: "in_progress",
      phase: "body_heygen",
      hook_clip_url: hookClipUrl,
      ...clearedHeygenResumeKeys(),
    });
  }

  let bodyVideoUrl = await resolveBodyVideoUrl(config, db, fresh, gen, bodyLane);
  if (!String(gen.body_video_url ?? "").trim()) {
    gen = { ...gen, body_video_url: bodyVideoUrl, body_lane: bodyLane };
    payload.generated_output = gen;
    await persistHookFirstState(db, fresh.id, payload, {
      provider: "hook-first-video",
      status: "in_progress",
      phase: "concat",
      hook_clip_url: hookClipUrl,
      body_video_url: bodyVideoUrl,
      ...clearedHeygenResumeKeys(),
    });
  }

  await mergeHookFirstRenderState(db, fresh.id, {
    provider: "hook-first-video",
    status: "in_progress",
    phase: "concat",
  });

  const { publicUrl, objectPath } = await concatHookAndBody(
    config,
    db,
    fresh,
    videoAssemblyBaseUrl,
    hookClipUrl,
    bodyVideoUrl
  );

  gen = {
    ...gen,
    hook_clip_url: hookClipUrl,
    body_video_url: bodyVideoUrl,
    merged_video_url: publicUrl,
    video_pipeline: "hook_first",
  };
  payload.generated_output = gen;

  await insertAsset(db, {
    asset_id: `${fresh.task_id}__VIDEO_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_"),
    task_id: fresh.task_id,
    project_id: fresh.project_id,
    asset_type: "VIDEO",
    position: 1,
    bucket: config.SUPABASE_ASSETS_BUCKET,
    object_path: objectPath,
    public_url: publicUrl,
    provider: "hook_first_video",
    metadata_json: {
      hook_clip_url: hookClipUrl,
      body_video_url: bodyVideoUrl,
      body_lane: bodyLane,
      hook_duration_sec: durationSec,
      spoken_script_preview: extractSpokenScriptText(gen, 1).slice(0, 500),
    },
  });

  await persistHookFirstState(db, fresh.id, payload, {
    provider: "hook-first-video",
    status: "completed",
    phase: "completed",
    public_url: publicUrl,
  });
}

async function mergeHookFirstRenderState(
  db: Pool,
  jobId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await db.query(
    `UPDATE caf_core.content_jobs SET
       render_state = COALESCE(render_state, '{}'::jsonb) || $1::jsonb,
       updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(patch), jobId]
  );
}
