import type { Pool } from "pg";
import { stringifyForPostgresJson } from "../lib/postgres-json.js";

const MAX_JSON_STRING = 120_000;

/** Shrink large strings so jsonb inserts stay bounded; keeps structure for objects (shallow). */
export function clipForAuditJson(value: unknown, maxStr = MAX_JSON_STRING): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (value.length <= maxStr) return value;
    return `${value.slice(0, maxStr)}\n… [truncated ${value.length - maxStr} chars]`;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((v) => clipForAuditJson(v, maxStr));
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = clipForAuditJson(v, maxStr);
  }
  return out;
}

export interface ApiCallAuditInsert {
  projectId: string;
  runId?: string | null;
  taskId?: string | null;
  signalPackId?: string | null;
  step: string;
  provider: string;
  model?: string | null;
  ok?: boolean;
  errorMessage?: string | null;
  requestJson: unknown;
  responseJson: unknown;
  tokenUsage?: number | null;
  /** Carousel slide: wall ms for POST /render-binary. */
  latencyMs?: number | null;
  /** HeyGen (and similar): output duration in seconds when known. */
  billableVideoSeconds?: number | null;
  /** Allocated estimate from CAF_COST_* at insert time. */
  estimatedCostUsd?: number | null;
}

export async function insertApiCallAudit(db: Pool, row: ApiCallAuditInsert): Promise<void> {
  const req = clipForAuditJson(row.requestJson);
  const res = clipForAuditJson(row.responseJson);
  await db.query(
    `INSERT INTO caf_core.api_call_audit (
       project_id, run_id, task_id, signal_pack_id, step, provider, model, ok, error_message,
       request_json, response_json, token_usage,
       latency_ms, billable_video_seconds, estimated_cost_usd
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12,$13,$14,$15)`,
    [
      row.projectId,
      row.runId ?? null,
      row.taskId ?? null,
      row.signalPackId ?? null,
      row.step,
      row.provider,
      row.model ?? null,
      row.ok !== false,
      row.errorMessage ?? null,
      stringifyForPostgresJson(req ?? {}),
      stringifyForPostgresJson(res ?? {}),
      row.tokenUsage ?? null,
      row.latencyMs ?? null,
      row.billableVideoSeconds ?? null,
      row.estimatedCostUsd ?? null,
    ]
  );
}

export async function listApiCallAuditsForTask(
  db: Pool,
  projectId: string,
  taskId: string,
  limit = 80
): Promise<
  Array<{
    id: string;
    run_id: string | null;
    task_id: string | null;
    step: string;
    provider: string;
    model: string | null;
    ok: boolean;
    error_message: string | null;
    request_json: unknown;
    response_json: unknown;
    token_usage: number | null;
    created_at: string;
  }>
> {
  const { rows } = await db.query(
    `SELECT id::text, run_id, task_id, step, provider, model, ok, error_message,
            request_json, response_json, token_usage, created_at::text
     FROM caf_core.api_call_audit
     WHERE project_id = $1 AND task_id = $2
     ORDER BY created_at ASC
     LIMIT $3`,
    [projectId, taskId, limit]
  );
  return rows as never[];
}

/** Never let audit persistence break generation/render paths. */
export async function tryInsertApiCallAudit(db: Pool, row: ApiCallAuditInsert): Promise<void> {
  try {
    await insertApiCallAudit(db, row);
  } catch {
    /* ignore */
  }
}

export async function listApiCallAuditsForRun(
  db: Pool,
  projectId: string,
  runId: string,
  limit = 120
): Promise<
  Array<{
    id: string;
    task_id: string | null;
    step: string;
    provider: string;
    model: string | null;
    ok: boolean;
    error_message: string | null;
    created_at: string;
    request_json: unknown;
    response_json: unknown;
  }>
> {
  const { rows } = await db.query(
    `SELECT id::text, task_id, step, provider, model, ok, error_message, created_at::text, request_json, response_json
     FROM caf_core.api_call_audit
     WHERE project_id = $1 AND run_id = $2
     ORDER BY created_at ASC
     LIMIT $3`,
    [projectId, runId, limit]
  );
  return rows as never[];
}

export interface LatestHeygenSubmitAudit {
  id: string;
  created_at: string;
  ok: boolean;
  error_message: string | null;
  /**
   * Full /v3/video-agents prompt string (prompt-led) — the exact body the agent received.
   * Null when the submission was /v3/videos (script-led path has no `prompt` field; see `script_text`).
   */
  prompt: string | null;
  /**
   * Verbatim avatar TTS text from `video_inputs[0].script_text` when script-led.
   * Null when the submission was /v3/video-agents.
   */
  script_text: string | null;
  avatar_id: string | null;
  voice_id: string | null;
  post_path: string | null;
  video_id: string | null;
}

/**
 * Most recent `heygen_video_generate` audit row for a task (there is usually only one, but
 * re-renders produce multiple — we always show the latest). Flattens the interesting bits of
 * request_json / response_json so the review UI can render the actual submitted prompt
 * without having to understand HeyGen's endpoint shapes.
 *
 * Returns null when the task has never been submitted to HeyGen. Never throws — we prefer a
 * missing panel to a broken review screen.
 */
export interface MimicImageAuditRow {
  id: string;
  created_at: string;
  step: string;
  provider: string;
  model: string | null;
  ok: boolean;
  error_message: string | null;
  /** Exact text prompt sent to Qwen / image-edit provider. */
  prompt: string | null;
  endpoint: string | null;
  reference_url: string | null;
  size: string | null;
  latency_ms: number | null;
}

function pickMimicAuditPrompt(req: Record<string, unknown>): string | null {
  const direct = typeof req.prompt === "string" ? req.prompt.trim() : "";
  if (direct) return direct;
  const body = req.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const b = body as Record<string, unknown>;
    const p = typeof b.prompt === "string" ? b.prompt.trim() : "";
    if (p) return p;
  }
  const input = req.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const messages = (input as Record<string, unknown>).messages;
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
        const content = (msg as Record<string, unknown>).content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
          if (!part || typeof part !== "object" || Array.isArray(part)) continue;
          const text = (part as Record<string, unknown>).text;
          if (typeof text === "string" && text.trim()) return text.trim();
        }
      }
    }
  }
  return null;
}

function pickMimicAuditReferenceUrl(req: Record<string, unknown>): string | null {
  const direct = typeof req.reference_url === "string" ? req.reference_url.trim() : "";
  if (direct) return direct;
  const input = req.input;
  if (input && typeof input === "object" && !Array.isArray(input)) {
    const messages = (input as Record<string, unknown>).messages;
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        if (!msg || typeof msg !== "object" || Array.isArray(msg)) continue;
        const content = (msg as Record<string, unknown>).content;
        if (!Array.isArray(content)) continue;
        for (const part of content) {
          if (!part || typeof part !== "object" || Array.isArray(part)) continue;
          const image = (part as Record<string, unknown>).image;
          if (typeof image === "string" && image.trim()) return image.trim();
        }
      }
    }
  }
  return null;
}

/** Mimic carousel/image Qwen calls logged under step `mimic_bg_extract*` / `mimic_slide_gen_*`. */
export async function listMimicImageAuditsForTask(
  db: Pool,
  projectId: string,
  taskId: string,
  limit = 40
): Promise<MimicImageAuditRow[]> {
  const { rows } = await db.query(
    `SELECT id::text, created_at::text, step, provider, model, ok, error_message,
            request_json, latency_ms
     FROM caf_core.api_call_audit
     WHERE project_id = $1
       AND task_id = $2
       AND (
         step LIKE 'mimic_bg_extract%' OR
         step LIKE 'mimic_slide_gen_%' OR
         step LIKE 'mimic_slide_flux_text_%' OR
         step LIKE 'mimic_flux_carousel_slide_%' OR
         step = 'mimic_image_edit'
       )
     ORDER BY created_at ASC
     LIMIT $3`,
    [projectId, taskId, limit]
  );
  return rows.map((r) => {
    const req = (r.request_json as Record<string, unknown> | null) ?? {};
    return {
      id: String(r.id),
      created_at: String(r.created_at),
      step: String(r.step),
      provider: String(r.provider),
      model: r.model != null ? String(r.model) : null,
      ok: Boolean(r.ok),
      error_message: r.error_message != null ? String(r.error_message) : null,
      prompt: pickMimicAuditPrompt(req),
      endpoint: typeof req.endpoint === "string" ? req.endpoint : null,
      reference_url: pickMimicAuditReferenceUrl(req),
      size: typeof req.size === "string" ? req.size : null,
      latency_ms: r.latency_ms != null ? Number(r.latency_ms) : null,
    };
  });
}

export async function getLatestHeygenSubmitAuditForTask(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<LatestHeygenSubmitAudit | null> {
  const { rows } = await db.query(
    `SELECT id::text, created_at::text, ok, error_message, request_json, response_json
     FROM caf_core.api_call_audit
     WHERE project_id = $1
       AND task_id = $2
       AND step = 'heygen_video_generate'
     ORDER BY created_at DESC
     LIMIT 1`,
    [projectId, taskId]
  );
  const r = rows[0];
  if (!r) return null;
  const req = (r.request_json as Record<string, unknown> | null) ?? {};
  const body = (req.body as Record<string, unknown> | null) ?? {};
  // runHeygenVideoWithBody audits { endpoint, body, scene_index }. Older rows may use { path } / { url }.
  const endpointStr =
    typeof req.endpoint === "string" ? req.endpoint :
    typeof req.path === "string" ? req.path :
    typeof req.url === "string" ? req.url :
    null;
  const postPath = endpointStr ? endpointStr.replace(/^https?:\/\/[^/]+/, "") : null;
  const prompt = typeof body.prompt === "string" ? body.prompt : null;
  const avatarId =
    typeof body.avatar_id === "string" && body.avatar_id ? body.avatar_id : null;
  const voiceId =
    typeof body.voice_id === "string" && body.voice_id ? body.voice_id : null;

  // /v3/videos nests the spoken script at body.video_inputs[0].script_text; fish it out defensively.
  let scriptText: string | null = null;
  const vi = body.video_inputs;
  if (Array.isArray(vi) && vi.length > 0) {
    const head = vi[0];
    if (head && typeof head === "object" && !Array.isArray(head)) {
      const st = (head as Record<string, unknown>).script_text;
      if (typeof st === "string" && st.trim()) scriptText = st;
    }
  }

  const res = (r.response_json as Record<string, unknown> | null) ?? {};
  const data = (res.data as Record<string, unknown> | null) ?? {};
  const videoId =
    (typeof data.video_id === "string" && data.video_id) ||
    (typeof res.video_id === "string" && res.video_id) ||
    null;

  return {
    id: String(r.id),
    created_at: String(r.created_at),
    ok: Boolean(r.ok),
    error_message: r.error_message ? String(r.error_message) : null,
    prompt,
    script_text: scriptText,
    avatar_id: avatarId,
    voice_id: voiceId,
    post_path: postPath,
    video_id: videoId || null,
  };
}

export async function listApiCallAuditsForSignalPack(
  db: Pool,
  projectId: string,
  signalPackId: string,
  limit = 20
): Promise<
  Array<{
    id: string;
    step: string;
    provider: string;
    created_at: string;
    request_json: unknown;
    response_json: unknown;
  }>
> {
  const { rows } = await db.query(
    `SELECT id::text, step, provider, created_at::text, request_json, response_json
     FROM caf_core.api_call_audit
     WHERE project_id = $1 AND signal_pack_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [projectId, signalPackId, limit]
  );
  return rows as never[];
}

/** Inputs pipeline, signal-pack ingest, and related audit rows for the Processing tab. */
export async function listApiCallAuditsForInputsPipeline(
  db: Pool,
  projectId: string,
  limit = 80
): Promise<
  Array<{
    id: string;
    step: string;
    provider: string;
    model: string | null;
    ok: boolean;
    error_message: string | null;
    created_at: string;
    request_json: unknown;
    response_json: unknown;
  }>
> {
  const { rows } = await db.query(
    `SELECT id::text, step, provider, model, ok, error_message, created_at::text, request_json, response_json
     FROM caf_core.api_call_audit
     WHERE project_id = $1 AND (
       step LIKE 'inputs%' OR
       step IN ('signal_pack_xlsx_ingest', 'signal_pack_json_ingest')
     )
     ORDER BY created_at DESC
     LIMIT $2`,
    [projectId, limit]
  );
  return rows as never[];
}
