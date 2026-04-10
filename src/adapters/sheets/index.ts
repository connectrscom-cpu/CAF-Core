/**
 * Sheets adapter — reads legacy Google Sheets tabs and syncs into CAF Core DB.
 *
 * Usage:
 *   import { syncRuntimeSheet, syncReviewQueueSheet } from "./adapters/sheets";
 *   await syncRuntimeSheet(pool, { spreadsheetId, tabName, projectSlug });
 */
import { google, type sheets_v4 } from "googleapis";
import type { Pool } from "pg";
import { q, qOne } from "../../db/queries.js";

// ───── auth ──────
let authClient: Awaited<ReturnType<typeof buildAuth>> | null = null;

async function buildAuth() {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (saJson) {
    const creds = JSON.parse(saJson);
    return new google.auth.GoogleAuth({
      credentials: creds,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
  }
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (clientId && clientSecret && refreshToken) {
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    return oauth2;
  }
  throw new Error("No Google auth configured for sheets adapter");
}

async function getAuth() {
  if (!authClient) authClient = await buildAuth();
  return authClient;
}

// ───── helpers ──────

function normalizeKey(h: string): string {
  return h.trim().toLowerCase().replace(/[\s_-]+/g, "_").replace(/[^a-z0-9_]/g, "");
}

export interface SheetRow {
  [key: string]: string | undefined;
}

export async function readTab(spreadsheetId: string, tab: string): Promise<SheetRow[]> {
  const auth = await getAuth();
  const sheets = google.sheets({ version: "v4", auth: auth as any });
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tab}'!A:AZ`,
  });
  const rows = res.data.values;
  if (!rows || rows.length < 2) return [];
  const headers = rows[0].map(normalizeKey);
  return rows.slice(1).map((r) => {
    const obj: SheetRow = {};
    headers.forEach((h, i) => {
      obj[h] = r[i] ?? undefined;
    });
    return obj;
  });
}

// ───── Runtime tab sync → content_jobs ──────

export interface SyncRuntimeOpts {
  spreadsheetId: string;
  tabName: string;
  projectSlug: string;
}

export async function syncRuntimeSheet(pool: Pool, opts: SyncRuntimeOpts) {
  const rows = await readTab(opts.spreadsheetId, opts.tabName);
  let upserted = 0;
  let skipped = 0;

  for (const row of rows) {
    const taskId = row.task_id ?? row.taskid;
    if (!taskId) { skipped++; continue; }

    const runId = row.run_id ?? row.runid;
    const candidateId = row.candidate_id ?? row.candidateid;

    const existing = await qOne(pool, `SELECT 1 FROM caf_core.content_jobs WHERE task_id=$1`, [taskId]);

    const projectRow = await qOne<{ id: string }>(pool, `SELECT id FROM caf_core.projects WHERE slug=$1`, [opts.projectSlug]);
    if (!projectRow) { skipped++; continue; }

    const status = (row.status ?? row.pipeline_status ?? "UNKNOWN").toUpperCase();
    const platform = row.platform ?? null;
    const flowType = row.flow_type ?? row.content_type ?? null;

    if (existing) {
      await q(pool, `UPDATE caf_core.content_jobs SET status=$1, updated_at=now() WHERE task_id=$2`, [status, taskId]);
    } else {
      await q(
        pool,
        `INSERT INTO caf_core.content_jobs
          (project_id, run_id, candidate_id, task_id, platform, flow_type, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (task_id) DO NOTHING`,
        [projectRow.id, runId ?? null, candidateId ?? null, taskId, platform, flowType, status]
      );
    }
    upserted++;
  }

  return { upserted, skipped, total: rows.length };
}

// ───── Review Queue tab sync → editorial_reviews ──────

export interface SyncReviewQueueOpts {
  spreadsheetId: string;
  tabName: string;
  projectSlug: string;
}

export async function syncReviewQueueSheet(pool: Pool, opts: SyncReviewQueueOpts) {
  const rows = await readTab(opts.spreadsheetId, opts.tabName);
  let synced = 0;
  let skipped = 0;

  for (const row of rows) {
    const taskId = row.task_id ?? row.taskid;
    if (!taskId) { skipped++; continue; }

    const submit = (row.submit ?? row.submitted ?? "").toUpperCase();
    if (submit !== "TRUE") { skipped++; continue; }

    const projectRow = await qOne<{ id: string }>(pool, `SELECT id FROM caf_core.projects WHERE slug=$1`, [opts.projectSlug]);
    if (!projectRow) { skipped++; continue; }

    const decision = (row.decision ?? row.review_decision ?? "").toUpperCase();
    if (!["APPROVED", "NEEDS_EDIT", "REJECTED"].includes(decision)) {
      skipped++;
      continue;
    }
    const notes = row.notes ?? row.review_notes ?? null;
    const rejectionTagsRaw = row.rejection_tags ?? null;
    let rejectionTags: string[] = [];
    if (rejectionTagsRaw) {
      try { rejectionTags = JSON.parse(rejectionTagsRaw); } catch {
        rejectionTags = rejectionTagsRaw.split(",").map((t) => t.trim()).filter(Boolean);
      }
    }

    const existingReview = await qOne(
      pool,
      `SELECT 1 FROM caf_core.editorial_reviews WHERE project_id=$1 AND task_id=$2 AND decision=$3`,
      [projectRow.id, taskId, decision]
    );
    if (existingReview) { skipped++; continue; }

    const submittedAt = row.submitted_at ?? new Date().toISOString();
    const validator = row.validator ?? row.reviewer ?? "sheets_sync";

    await q(
      pool,
      `INSERT INTO caf_core.editorial_reviews
        (project_id, task_id, candidate_id, run_id, review_status, decision, rejection_tags, notes, overrides_json, validator, submit, submitted_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10, $11, $12)`,
      [
        projectRow.id,
        taskId,
        row.candidate_id ?? null,
        row.run_id ?? null,
        "SUBMITTED",
        decision,
        JSON.stringify(rejectionTags),
        notes,
        JSON.stringify({}),
        validator,
        true,
        submittedAt,
      ]
    );
    synced++;
  }

  return { synced, skipped, total: rows.length };
}
