import type { Pool } from "pg";

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
}

export async function insertApiCallAudit(db: Pool, row: ApiCallAuditInsert): Promise<void> {
  const req = clipForAuditJson(row.requestJson);
  const res = clipForAuditJson(row.responseJson);
  await db.query(
    `INSERT INTO caf_core.api_call_audit (
       project_id, run_id, task_id, signal_pack_id, step, provider, model, ok, error_message,
       request_json, response_json, token_usage
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12)`,
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
      JSON.stringify(req ?? {}),
      JSON.stringify(res ?? {}),
      row.tokenUsage ?? null,
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
