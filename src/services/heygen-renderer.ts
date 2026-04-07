/**
 * HeyGen video generation: config merge, submit, poll, download, Supabase upload, asset row.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { listHeygenConfig, type HeygenConfigRow } from "../repositories/project-config.js";
import { insertAsset } from "../repositories/assets.js";
import { uploadBuffer, downloadUrl } from "./supabase-storage.js";
import { extractSpokenScriptText, extractVideoPromptText } from "./video-gen-fields.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";

function rowMatchesTarget(
  r: HeygenConfigRow,
  platform: string | null,
  flowType: string | null,
  renderMode: string | null
): boolean {
  if (r.platform && platform && r.platform.toLowerCase() !== platform.toLowerCase()) return false;
  if (r.flow_type && flowType && r.flow_type !== flowType) return false;
  if (r.render_mode && renderMode && r.render_mode !== renderMode) return false;
  return true;
}

/** Merge HeyGen key/value rows that match platform / flow / render_mode (wildcards allowed). */
export function mergeHeygenConfig(
  rows: HeygenConfigRow[],
  platform: string | null,
  flowType: string | null,
  renderMode: string | null
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const r of rows) {
    if (!rowMatchesTarget(r, platform, flowType, renderMode)) continue;
    if (!r.config_key) continue;
    let v: string | number | boolean = r.value ?? "";
    if (r.value_type === "number" && r.value != null) v = Number(r.value);
    if (r.value_type === "boolean" && r.value != null) v = r.value === "true" || r.value === "1";
    out[r.config_key] = v;
  }
  return out;
}

function deepMerge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    if (v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out;
}

function extractVideoId(json: Record<string, unknown>): string | null {
  const data = json.data as Record<string, unknown> | undefined;
  const id =
    (data?.video_id as string) ??
    (json.video_id as string) ??
    (data?.id as string) ??
    (json.id as string);
  return id ? String(id) : null;
}

function extractVideoUrl(json: Record<string, unknown>): string | null {
  const data = json.data as Record<string, unknown> | undefined;
  const url =
    (data?.video_url as string) ??
    (json.video_url as string) ??
    (data?.url as string) ??
    ((data?.video as Record<string, unknown>)?.url as string);
  return url ? String(url) : null;
}

export async function submitHeyGenVideo(
  apiKey: string,
  apiBase: string,
  body: Record<string, unknown>
): Promise<string> {
  const base = apiBase.replace(/\/$/, "");
  const res = await fetch(`${base}/v2/video/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HeyGen generate ${res.status}: ${text.slice(0, 800)}`);
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error("HeyGen generate: invalid JSON");
  }
  const vid = extractVideoId(json);
  if (!vid) throw new Error(`HeyGen generate: no video_id in response: ${text.slice(0, 400)}`);
  return vid;
}

export async function getHeyGenVideoStatus(
  apiKey: string,
  apiBase: string,
  videoId: string
): Promise<{ status: string; videoUrl: string | null; raw: Record<string, unknown> }> {
  const base = apiBase.replace(/\/$/, "");
  const url = `${base}/v1/video_status.get?video_id=${encodeURIComponent(videoId)}`;
  const res = await fetch(url, {
    headers: { "X-Api-Key": apiKey },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HeyGen status ${res.status}: ${text.slice(0, 400)}`);
  const json = JSON.parse(text) as Record<string, unknown>;
  const data = json.data as Record<string, unknown> | undefined;
  const status = String(data?.status ?? json.status ?? "unknown");
  const videoUrl = extractVideoUrl(json);
  return { status: status.toLowerCase(), videoUrl, raw: json };
}

export async function pollHeyGenUntilComplete(
  apiKey: string,
  apiBase: string,
  videoId: string,
  opts?: { maxMs?: number }
): Promise<string> {
  const maxMs = opts?.maxMs ?? 600_000;
  const start = Date.now();
  let delay = 1000;
  while (Date.now() - start < maxMs) {
    const { status, videoUrl } = await getHeyGenVideoStatus(apiKey, apiBase, videoId);
    if (status === "completed" || status === "complete") {
      if (videoUrl) return videoUrl;
      const st = await getHeyGenVideoStatus(apiKey, apiBase, videoId);
      if (st.videoUrl) return st.videoUrl;
      throw new Error("HeyGen completed but no video_url in status payload");
    }
    if (status === "failed" || status === "error") {
      throw new Error(`HeyGen video ${videoId} failed`);
    }
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 2, 30_000);
  }
  throw new Error(`HeyGen poll timeout for video_id=${videoId}`);
}

export interface HeygenJobContext {
  id: string;
  task_id: string;
  project_id: string;
  run_id: string;
  flow_type: string;
  platform: string | null;
  generation_payload: Record<string, unknown>;
}

function pickVoiceFromBody(body: Record<string, unknown>, defaultVoiceId?: string | null): string | undefined {
  const fromBody = body.voice ?? body.default_voice ?? body.voice_id;
  if (fromBody != null && String(fromBody).trim() !== "") return String(fromBody).trim();
  if (defaultVoiceId != null && String(defaultVoiceId).trim() !== "") return String(defaultVoiceId).trim();
  const ev = process.env.HEYGEN_DEFAULT_VOICE_ID;
  if (ev != null && String(ev).trim() !== "") return String(ev).trim();
  return undefined;
}

/**
 * Build HeyGen v2 body: ensure required `video_inputs` and `video_inputs[0].voice`
 * (API rejects missing fields even when character/script live only on the merged config object).
 */
export function buildHeyGenRequestBody(
  mergedConfig: Record<string, unknown>,
  gen: Record<string, unknown>,
  override: Record<string, unknown> | undefined,
  opts?: { defaultVoiceId?: string | null }
): Record<string, unknown> {
  const script = extractSpokenScriptText(gen, 1);
  const prompt = extractVideoPromptText(gen, 1);

  let body: Record<string, unknown> = { ...mergedConfig };

  if (typeof body.video_inputs === "undefined" && (script || prompt)) {
    const voice = pickVoiceFromBody(body, opts?.defaultVoiceId);
    body = deepMerge(body, {
      video_inputs: [
        {
          ...(body.character != null ? { character: body.character } : {}),
          ...(voice ? { voice } : {}),
          ...(script ? { script_text: script } : {}),
          ...(prompt ? { prompt } : {}),
        },
      ],
    });
  }

  if (override && Object.keys(override).length > 0) {
    body = deepMerge(body, override);
  }

  const viRaw = body.video_inputs;
  if (!Array.isArray(viRaw) || viRaw.length === 0) {
    if (!script && !prompt) {
      throw new Error(
        "HeyGen: missing video_inputs and no spoken_script/script or video_prompt in generated_output. Configure heygen_config or fix LLM output."
      );
    }
    const voice = pickVoiceFromBody(body, opts?.defaultVoiceId);
    body.video_inputs = [
      {
        ...(body.character != null ? { character: body.character } : {}),
        ...(voice ? { voice } : {}),
        ...(script ? { script_text: script } : {}),
        ...(prompt ? { prompt } : {}),
      },
    ];
  } else {
    const first = (typeof viRaw[0] === "object" && viRaw[0] && !Array.isArray(viRaw[0])
      ? ({ ...(viRaw[0] as Record<string, unknown>) } as Record<string, unknown>)
      : {}) as Record<string, unknown>;
    const voice =
      (first.voice != null && String(first.voice).trim() !== "" ? String(first.voice).trim() : undefined) ??
      pickVoiceFromBody(body, opts?.defaultVoiceId);
    const mergedFirst: Record<string, unknown> = {
      ...first,
      ...(first.character == null && body.character != null ? { character: body.character } : {}),
      ...(voice ? { voice } : {}),
      ...(script && (first.script_text == null || String(first.script_text).trim() === "")
        ? { script_text: script }
        : {}),
      ...(prompt && (first.prompt == null || String(first.prompt).trim() === "") ? { prompt } : {}),
    };
    body.video_inputs = [mergedFirst, ...viRaw.slice(1)];
  }

  const vi0 = (body.video_inputs as Record<string, unknown>[])[0];
  if (!vi0 || vi0.voice == null || String(vi0.voice).trim() === "") {
    throw new Error(
      "HeyGen: video_inputs[0].voice is required. Add a `voice` key in heygen_config for this flow/platform, or set HEYGEN_DEFAULT_VOICE_ID in the environment."
    );
  }

  return body;
}

export interface HeyGenRunAudit {
  db: Pool;
  projectId: string;
  runId: string;
  taskId: string;
  step: string;
  scene_index?: number;
}

export async function runHeygenVideoWithBody(
  appConfig: AppConfig,
  body: Record<string, unknown>,
  audit?: HeyGenRunAudit | null
): Promise<{ videoUrl: string; videoId: string }> {
  const apiKey = appConfig.HEYGEN_API_KEY?.trim();
  if (!apiKey) throw new Error("HEYGEN_API_KEY not configured");
  const endpoint = `${appConfig.HEYGEN_API_BASE.replace(/\/$/, "")}/v2/video/generate`;
  try {
    const videoId = await submitHeyGenVideo(apiKey, appConfig.HEYGEN_API_BASE, body);
    const videoUrl = await pollHeyGenUntilComplete(apiKey, appConfig.HEYGEN_API_BASE, videoId);
    if (audit) {
      await tryInsertApiCallAudit(audit.db, {
        projectId: audit.projectId,
        runId: audit.runId,
        taskId: audit.taskId,
        step: audit.step,
        provider: "heygen",
        model: null,
        ok: true,
        requestJson: { endpoint, body, scene_index: audit.scene_index },
        responseJson: { video_id: videoId, video_url: videoUrl },
      });
    }
    return { videoUrl, videoId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (audit) {
      await tryInsertApiCallAudit(audit.db, {
        projectId: audit.projectId,
        runId: audit.runId,
        taskId: audit.taskId,
        step: audit.step,
        provider: "heygen",
        model: null,
        ok: false,
        errorMessage: msg.slice(0, 4000),
        requestJson: { endpoint, body, scene_index: audit.scene_index },
        responseJson: {},
      });
    }
    throw err;
  }
}

export async function runHeygenForContentJob(
  db: Pool,
  appConfig: AppConfig,
  job: HeygenJobContext
): Promise<{ public_url: string | null; object_path: string | null; video_id: string }> {
  const apiKey = appConfig.HEYGEN_API_KEY?.trim();
  if (!apiKey) throw new Error("HEYGEN_API_KEY not configured");

  const rows = await listHeygenConfig(db, job.project_id);
  const gen = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
  const renderMode =
    String(job.generation_payload.render_mode ?? gen.render_mode ?? gen.production_route ?? "HEYGEN_AVATAR") ||
    "HEYGEN_AVATAR";

  const merged = mergeHeygenConfig(rows, job.platform, job.flow_type, renderMode);
  const override = job.generation_payload.heygen_request as Record<string, unknown> | undefined;
  const body = buildHeyGenRequestBody(merged, gen, override, {
    defaultVoiceId: appConfig.HEYGEN_DEFAULT_VOICE_ID,
  });

  const { videoUrl, videoId } = await runHeygenVideoWithBody(appConfig, body, {
    db,
    projectId: job.project_id,
    runId: job.run_id,
    taskId: job.task_id,
    step: "heygen_video_generate",
  });

  const buf = await downloadUrl(videoUrl);
  const safeTask = job.task_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRun = job.run_id.replace(/[^a-zA-Z0-9_-]/g, "_");
  const objectPath = `assets/videos/${safeRun}/${safeTask}/heygen_${videoId}.mp4`;

  let publicUrl: string | null = null;
  try {
    const up = await uploadBuffer(appConfig, objectPath, buf, "video/mp4");
    publicUrl = up.public_url;
  } catch {
    // Supabase optional in dev
  }

  const assetId = `${job.task_id}__VIDEO_v1`.replace(/[^a-zA-Z0-9_.-]/g, "_");
  await insertAsset(db, {
    asset_id: assetId,
    task_id: job.task_id,
    project_id: job.project_id,
    asset_type: "VIDEO",
    asset_version: "1",
    bucket: appConfig.SUPABASE_ASSETS_BUCKET,
    object_path: objectPath,
    public_url: publicUrl,
    provider: "heygen",
    position: 0,
    metadata_json: { video_id: videoId, source_url: videoUrl },
  });

  return { public_url: publicUrl, object_path: objectPath, video_id: videoId };
}
