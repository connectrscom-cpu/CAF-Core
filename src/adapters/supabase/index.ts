/**
 * Supabase adapter — mirrors public.tasks + public.assets into caf_core DB.
 *
 * Usage:
 *   import { syncTasksFromSupabase, syncAssetsFromSupabase } from "./adapters/supabase";
 *   await syncTasksFromSupabase(pool, { supabaseUrl, supabaseKey, projectSlug });
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Pool } from "pg";
import { q, qOne } from "../../db/queries.js";

function getClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false } });
}

// ───── tasks → content_jobs ──────

export interface SyncTasksOpts {
  supabaseUrl: string;
  supabaseKey: string;
  projectSlug: string;
  batchSize?: number;
  sinceHoursAgo?: number;
}

export async function syncTasksFromSupabase(pool: Pool, opts: SyncTasksOpts) {
  const sb = getClient(opts.supabaseUrl, opts.supabaseKey);
  const batchSize = opts.batchSize ?? 500;

  const projectRow = await qOne<{ id: string }>(pool, `SELECT id FROM caf_core.projects WHERE slug=$1`, [opts.projectSlug]);
  if (!projectRow) throw new Error(`Project ${opts.projectSlug} not found — run seed first`);

  let query = sb.from("tasks").select("*").order("created_at", { ascending: false }).limit(batchSize);
  if (opts.sinceHoursAgo) {
    const since = new Date(Date.now() - opts.sinceHoursAgo * 3600000).toISOString();
    query = query.gte("created_at", since);
  }

  const { data: tasks, error } = await query;
  if (error) throw new Error(`Supabase query error: ${error.message}`);

  let upserted = 0;
  let skipped = 0;

  for (const task of tasks ?? []) {
    const taskId = task.task_id;
    if (!taskId) { skipped++; continue; }

    const status = (task.pipeline_status ?? task.status ?? "UNKNOWN").toUpperCase();
    const platform = task.platform ?? null;
    const flowType = task.flow_type ?? task.content_type ?? null;
    const runId = task.run_id ?? null;
    const candidateId = task.candidate_id ?? null;

    const generationPayload: Record<string, unknown> = {};
    if (task.generated_hook) generationPayload.hook = task.generated_hook;
    if (task.generated_title) generationPayload.title = task.generated_title;
    if (task.generated_caption) generationPayload.caption = task.generated_caption;
    if (task.generated_slides_json) {
      try { generationPayload.slides = JSON.parse(task.generated_slides_json); } catch {
        generationPayload.slides_raw = task.generated_slides_json;
      }
    }

    await q(
      pool,
      `INSERT INTO caf_core.content_jobs
        (project_id, run_id, candidate_id, task_id, platform, flow_type, status, generation_payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (task_id) DO UPDATE SET
         status = EXCLUDED.status,
         generation_payload = COALESCE(EXCLUDED.generation_payload, caf_core.content_jobs.generation_payload),
         updated_at = now()`,
      [
        projectRow.id,
        runId,
        candidateId,
        taskId,
        platform,
        flowType,
        status,
        Object.keys(generationPayload).length > 0 ? JSON.stringify(generationPayload) : null,
      ]
    );
    upserted++;
  }

  return { upserted, skipped, total: (tasks ?? []).length };
}

// ───── assets → caf_core.assets ──────

export interface SyncAssetsOpts {
  supabaseUrl: string;
  supabaseKey: string;
  projectSlug: string;
  batchSize?: number;
  sinceHoursAgo?: number;
}

export async function syncAssetsFromSupabase(pool: Pool, opts: SyncAssetsOpts) {
  const sb = getClient(opts.supabaseUrl, opts.supabaseKey);
  const batchSize = opts.batchSize ?? 1000;

  const projectRow = await qOne<{ id: string }>(pool, `SELECT id FROM caf_core.projects WHERE slug=$1`, [opts.projectSlug]);
  if (!projectRow) throw new Error(`Project ${opts.projectSlug} not found`);

  let query = sb.from("assets").select("*").order("created_at", { ascending: false }).limit(batchSize);
  if (opts.sinceHoursAgo) {
    const since = new Date(Date.now() - opts.sinceHoursAgo * 3600000).toISOString();
    query = query.gte("created_at", since);
  }

  const { data: assets, error } = await query;
  if (error) throw new Error(`Supabase assets query error: ${error.message}`);

  let upserted = 0;
  let skipped = 0;

  for (const asset of assets ?? []) {
    const taskId = asset.task_id;
    if (!taskId) { skipped++; continue; }

    const jobRow = await qOne<{ id: string }>(
      pool,
      `SELECT id FROM caf_core.content_jobs WHERE task_id=$1`,
      [taskId]
    );
    if (!jobRow) { skipped++; continue; }

    await q(
      pool,
      `INSERT INTO caf_core.assets
        (job_id, asset_type, public_url, storage_bucket, object_path, position, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT DO NOTHING`,
      [
        jobRow.id,
        asset.asset_type ?? "unknown",
        asset.public_url ?? null,
        asset.bucket ?? null,
        asset.object_path ?? null,
        asset.position ?? 0,
        asset.metadata ? JSON.stringify(asset.metadata) : null,
      ]
    );
    upserted++;
  }

  return { upserted, skipped, total: (assets ?? []).length };
}
