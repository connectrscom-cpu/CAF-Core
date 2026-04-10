/**
 * NEEDS_EDIT → override-only, partial, or full rework (n8n CAF_REWORK_ORCHESTRATOR subset).
 * Full/partial rework keeps the same `task_id`, clears render/output state via `prepareContentJobForFullRerun`,
 * then runs the standard pipeline so `job_drafts` and assets accumulate per task.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { insertJobStateTransition } from "../repositories/transitions.js";
import { prepareContentJobForFullRerun, processContentJobById } from "./job-pipeline.js";

export type ReworkMode = "OVERRIDE_ONLY" | "FULL_REWORK" | "PARTIAL_REWRITE";

export function inferReworkMode(review: {
  rejection_tags?: unknown;
  notes?: string | null;
}): ReworkMode {
  const tags = Array.isArray(review.rejection_tags)
    ? (review.rejection_tags as unknown[]).map((t) => String(t).toLowerCase())
    : [];
  const notes = (review.notes ?? "").toLowerCase();
  if (tags.some((t) => t.includes("full") || t.includes("regenerate"))) return "FULL_REWORK";
  if (notes.includes("full rewrite") || notes.includes("start over")) return "FULL_REWORK";
  if (tags.length >= 3) return "FULL_REWORK";
  if (tags.some((t) => t.includes("override") || t.includes("typo")) || notes.includes("override only")) {
    return "OVERRIDE_ONLY";
  }
  return "PARTIAL_REWRITE";
}

export interface ReworkResult {
  ok: boolean;
  mode: ReworkMode;
  /** Canonical job key; same as input for FULL/PARTIAL in-place rework. */
  task_id?: string;
  error?: string;
}

/**
 * Uses latest NEEDS_EDIT review on the job. For FULL/PARTIAL resets the same task_id, appends a new
 * `job_drafts` row via the normal LLM path, and runs the full pipeline through render.
 */
export async function executeRework(
  db: Pool,
  config: AppConfig,
  projectId: string,
  taskId: string
): Promise<ReworkResult> {
  const job = await qOne<{
    id: string;
    task_id: string;
    run_id: string;
    candidate_id: string | null;
    variation_name: string | null;
    flow_type: string | null;
    platform: string | null;
    generation_payload: Record<string, unknown>;
  }>(
    db,
    `SELECT id, task_id, run_id, candidate_id, variation_name, flow_type, platform, generation_payload
     FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
    [projectId, taskId]
  );
  if (!job) return { ok: false, mode: "OVERRIDE_ONLY", error: "job not found" };

  const rev = await qOne<{
    decision: string | null;
    rejection_tags: unknown;
    notes: string | null;
    overrides_json: Record<string, unknown>;
  }>(
    db,
    `SELECT decision, rejection_tags, notes, overrides_json FROM caf_core.editorial_reviews
     WHERE project_id = $1 AND task_id = $2 AND decision = 'NEEDS_EDIT'
     ORDER BY created_at DESC LIMIT 1`,
    [projectId, taskId]
  );
  if (!rev) return { ok: false, mode: "OVERRIDE_ONLY", error: "no NEEDS_EDIT review found" };

  const mode = inferReworkMode(rev);

  if (mode === "OVERRIDE_ONLY") {
    const gen = (job.generation_payload.generated_output as Record<string, unknown>) ?? {};
    const overrides = rev.overrides_json ?? {};
    const mergedOutput = { ...gen, ...overrides };
    await db.query(
      `UPDATE caf_core.content_jobs SET
        generation_payload = generation_payload || $1::jsonb,
        status = 'IN_REVIEW',
        updated_at = now()
       WHERE id = $2`,
      [
        JSON.stringify({
          generated_output: mergedOutput,
          generation_reason: "REWORK_OVERRIDE_ONLY",
        }),
        job.id,
      ]
    );
    await insertJobStateTransition(db, {
      task_id: job.task_id,
      project_id: projectId,
      from_state: "NEEDS_EDIT",
      to_state: "IN_REVIEW",
      triggered_by: "human",
      actor: "rework-orchestrator",
    });
    return { ok: true, mode, task_id: job.task_id };
  }

  const prep = await prepareContentJobForFullRerun(db, projectId, taskId);
  if (!prep.ok) return { ok: false, mode, error: prep.error };

  await db.query(
    `UPDATE caf_core.content_jobs SET
      rework_parent_task_id = NULL,
      generation_payload = generation_payload || $1::jsonb,
      updated_at = now()
     WHERE id = $2`,
    [
      JSON.stringify({
        rework_mode: mode,
        human_feedback: { notes: rev.notes, rejection_tags: rev.rejection_tags },
        generation_reason: mode === "PARTIAL_REWRITE" ? "REWORK_PARTIAL" : "REWORK_FULL",
      }),
      job.id,
    ]
  );

  await processContentJobById(db, config, job.id);

  return { ok: true, mode, task_id: job.task_id };
}
