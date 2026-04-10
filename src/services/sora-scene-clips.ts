/**
 * OpenAI Videos API (Sora): create scene clip → poll → download MP4 → upload to Supabase for a public URL
 * (video-assembly concat needs fetchable URLs; OpenAI `/videos/{id}/content` requires auth).
 */
import type { AppConfig } from "../config.js";
import type { Pool } from "pg";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import { uploadBuffer } from "./supabase-storage.js";

const ALLOWED_SORA_SIZES = new Set(["720x1280", "1280x720", "1024x1792", "1792x1024"]);
const SORA_PROMPT_MAX = 32_000;

type OpenAiVideoJob = {
  id?: string;
  object?: string;
  status?: string;
  error?: { code?: string; message?: string };
  progress?: number;
  model?: string;
  seconds?: string;
  size?: string;
};

export class SoraPollTimeoutError extends Error {
  videoId: string;
  sceneIndex: number;
  maxMs: number;
  lastStatus: string | null;
  lastProgress: number | null;

  constructor(args: {
    videoId: string;
    sceneIndex: number;
    maxMs: number;
    lastStatus?: string | null;
    lastProgress?: number | null;
  }) {
    super(
      `Sora video poll timeout after ${args.maxMs}ms (video_id=${args.videoId}, last_status=${args.lastStatus ?? "unknown"})`
    );
    this.name = "SoraPollTimeoutError";
    this.videoId = args.videoId;
    this.sceneIndex = args.sceneIndex;
    this.maxMs = args.maxMs;
    this.lastStatus = args.lastStatus ?? null;
    this.lastProgress = typeof args.lastProgress === "number" ? args.lastProgress : null;
  }
}

function openAiBase(config: AppConfig): string {
  return config.OPENAI_API_BASE.replace(/\/$/, "");
}

function authHeaders(apiKey: string): HeadersInit {
  return { Authorization: `Bearer ${apiKey}` };
}

function normalizeSoraVideoSize(raw: string): string {
  const s = raw.trim();
  if (ALLOWED_SORA_SIZES.has(s)) return s;
  return "720x1280";
}

/** Sora allows 4 / 8 / 12 second clips; map from `SCENE_ASSEMBLY_CLIP_DURATION_SEC`. */
function soraSecondsFromClipHint(sec: number): "4" | "8" | "12" {
  const n = Number(sec);
  if (!Number.isFinite(n) || n <= 4) return "4";
  if (n <= 8) return "8";
  return "12";
}

function buildSoraScenePrompt(globalVisualContext: string | null, segmentPrompt: string): string {
  const g = (globalVisualContext ?? "").trim();
  const seg = segmentPrompt.trim();
  const combined = g
    ? `${g.slice(0, 2800)}\n\n---\n\nSegment visual (this shot only):\n${seg}`
    : seg;
  return combined.slice(0, SORA_PROMPT_MAX);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function readOpenAiVideoJson(res: Response, label: string): Promise<OpenAiVideoJob> {
  const text = await res.text();
  const t = text.trim();
  if (t.startsWith("<!") || t.startsWith("<html") || t.startsWith("<HTML")) {
    throw new Error(`${label}: expected JSON but got HTML (${res.status}). Preview: ${t.slice(0, 200)}`);
  }
  try {
    return JSON.parse(t) as OpenAiVideoJob;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${label}: invalid JSON (${res.status}): ${msg}. Preview: ${t.slice(0, 400)}`);
  }
}

async function pollSoraVideoUntilComplete(
  config: AppConfig,
  base: string,
  apiKey: string,
  videoId: string,
  audit: {
    db: Pool;
    projectId: string;
    runId: string;
    taskId: string;
    scene_index: number;
  },
  model: string
): Promise<OpenAiVideoJob> {
  const statusUrl = `${base}/videos/${videoId}`;
  const start = Date.now();
  let delay = 2000;
  let last: OpenAiVideoJob = {};

  while (Date.now() - start < config.SORA_POLL_MAX_MS) {
    const r = await fetch(statusUrl, { headers: authHeaders(apiKey) });
    last = await readOpenAiVideoJson(r, "OpenAI GET /videos/{id}");
    if (!r.ok) {
      await tryInsertApiCallAudit(audit.db, {
        projectId: audit.projectId,
        runId: audit.runId,
        taskId: audit.taskId,
        step: `sora_scene_clip_poll_scene_${audit.scene_index}`,
        provider: "openai_videos",
        model,
        ok: false,
        errorMessage: `HTTP ${r.status}: ${JSON.stringify(last).slice(0, 2000)}`,
        requestJson: { endpoint: statusUrl, video_id: videoId },
        responseJson: last,
      });
      throw new Error(`OpenAI video status ${r.status}: ${JSON.stringify(last).slice(0, 1500)}`);
    }

    const st = last.status;
    if (st === "completed") return last;
    if (st === "failed") {
      const msg = last.error?.message ?? last.error?.code ?? "Sora video generation failed";
      await tryInsertApiCallAudit(audit.db, {
        projectId: audit.projectId,
        runId: audit.runId,
        taskId: audit.taskId,
        step: `sora_scene_clip_failed_scene_${audit.scene_index}`,
        provider: "openai_videos",
        model,
        ok: false,
        errorMessage: msg,
        requestJson: { endpoint: statusUrl, video_id: videoId },
        responseJson: last,
      });
      throw new Error(`Sora scene clip failed: ${msg}`);
    }

    await sleep(delay);
    delay = Math.min(delay * 2, 30_000);
  }

  await tryInsertApiCallAudit(audit.db, {
    projectId: audit.projectId,
    runId: audit.runId,
    taskId: audit.taskId,
    step: `sora_scene_clip_timeout_scene_${audit.scene_index}`,
    provider: "openai_videos",
    model,
    ok: false,
    errorMessage: `poll exceeded ${config.SORA_POLL_MAX_MS}ms`,
    requestJson: { endpoint: statusUrl, video_id: videoId },
    responseJson: last,
  });
  throw new SoraPollTimeoutError({
    videoId,
    sceneIndex: audit.scene_index,
    maxMs: config.SORA_POLL_MAX_MS,
    lastStatus: last.status ?? null,
    lastProgress: typeof last.progress === "number" ? last.progress : null,
  });
}

export async function createUploadSoraSceneClip(
  config: AppConfig,
  args: {
    prompt: string;
    global_visual_context: string | null;
    taskId: string;
    runId: string;
    sceneIndex: number;
    audit: {
      db: Pool;
      projectId: string;
      runId: string;
      taskId: string;
      scene_index: number;
    };
  }
): Promise<{ publicUrl: string }> {
  const apiKey = config.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required for Sora scene clips");
  }

  const base = openAiBase(config);
  const model = (config.SORA_VIDEO_MODEL || "sora-2").trim();
  const size = normalizeSoraVideoSize(config.SORA_VIDEO_SIZE || "720x1280");
  const seconds = soraSecondsFromClipHint(config.SCENE_ASSEMBLY_CLIP_DURATION_SEC);
  const fullPrompt = buildSoraScenePrompt(args.global_visual_context, args.prompt);
  if (!fullPrompt.trim()) {
    throw new Error("Sora scene clip: empty prompt after merging global context");
  }

  const createUrl = `${base}/videos`;
  const fd = new FormData();
  fd.append("model", model);
  fd.append("prompt", fullPrompt);
  fd.append("seconds", seconds);
  fd.append("size", size);

  const createRes = await fetch(createUrl, {
    method: "POST",
    headers: authHeaders(apiKey),
    body: fd,
  });

  let created = await readOpenAiVideoJson(createRes, "OpenAI POST /videos");
  if (!createRes.ok) {
    await tryInsertApiCallAudit(args.audit.db, {
      projectId: args.audit.projectId,
      runId: args.audit.runId,
      taskId: args.audit.taskId,
      step: `sora_scene_clip_create_scene_${args.sceneIndex}`,
      provider: "openai_videos",
      model,
      ok: false,
      errorMessage: `HTTP ${createRes.status}: ${JSON.stringify(created).slice(0, 2000)}`,
      requestJson: {
        endpoint: createUrl,
        model,
        seconds,
        size,
        prompt_preview: fullPrompt.slice(0, 2000),
      },
      responseJson: created,
    });
    throw new Error(`OpenAI video create ${createRes.status}: ${JSON.stringify(created).slice(0, 2000)}`);
  }

  const videoId = created.id;
  if (!videoId || typeof videoId !== "string") {
    throw new Error("OpenAI video create: missing id in response");
  }

  await tryInsertApiCallAudit(args.audit.db, {
    projectId: args.audit.projectId,
    runId: args.audit.runId,
    taskId: args.audit.taskId,
    step: `sora_scene_clip_create_scene_${args.sceneIndex}`,
    provider: "openai_videos",
    model,
    ok: true,
    requestJson: {
      endpoint: createUrl,
      model,
      seconds,
      size,
      prompt_preview: fullPrompt.slice(0, 2000),
    },
    responseJson: { id: videoId, status: created.status, progress: created.progress },
  });

  if (created.status === "failed") {
    const msg = created.error?.message ?? "Sora job failed immediately after create";
    throw new Error(msg);
  }

  const finalMeta =
    created.status === "completed"
      ? created
      : await pollSoraVideoUntilComplete(config, base, apiKey, videoId, args.audit, model);

  const contentUrl = `${base}/videos/${videoId}/content`;
  const downloadTimeout = Math.min(
    600_000,
    Math.max(120_000, config.STORAGE_HTTP_FETCH_TIMEOUT_MS || 180_000)
  );
  const contentRes = await fetch(contentUrl, {
    headers: authHeaders(apiKey),
    signal: AbortSignal.timeout(downloadTimeout),
  });
  if (!contentRes.ok) {
    const errText = await contentRes.text().catch(() => "");
    await tryInsertApiCallAudit(args.audit.db, {
      projectId: args.audit.projectId,
      runId: args.audit.runId,
      taskId: args.audit.taskId,
      step: `sora_scene_clip_download_scene_${args.sceneIndex}`,
      provider: "openai_videos",
      model,
      ok: false,
      errorMessage: `HTTP ${contentRes.status}: ${errText.slice(0, 2000)}`,
      requestJson: { endpoint: contentUrl, video_id: videoId },
      responseJson: { raw_error_preview: errText.slice(0, 4000) },
    });
    throw new Error(`OpenAI video content ${contentRes.status}: ${errText.slice(0, 1500)}`);
  }

  const buf = Buffer.from(await contentRes.arrayBuffer());
  if (buf.length < 1024) {
    throw new Error(`Sora video download suspiciously small (${buf.length} bytes)`);
  }

  const safeTask = args.taskId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeRun = args.runId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const objectPath = `scenes/${safeRun}/${safeTask}/sora_scene_${args.sceneIndex}.mp4`;

  const up = await uploadBuffer(config, objectPath, buf, "video/mp4");
  if (!up.public_url?.trim()) {
    throw new Error(
      "Supabase upload succeeded but public_url is empty — ensure the bucket is public or use a signed-URL flow for scene concat."
    );
  }

  await tryInsertApiCallAudit(args.audit.db, {
    projectId: args.audit.projectId,
    runId: args.audit.runId,
    taskId: args.audit.taskId,
    step: `sora_scene_clip_uploaded_scene_${args.sceneIndex}`,
    provider: "openai_videos",
    model,
    ok: true,
    requestJson: {
      openai_video_id: videoId,
      object_path: up.object_path,
      mp4_bytes: buf.length,
    },
    responseJson: {
      status: finalMeta.status,
      public_url_host: (() => {
        try {
          return new URL(up.public_url).host;
        } catch {
          return null;
        }
      })(),
    },
  });

  return { publicUrl: up.public_url.trim() };
}
