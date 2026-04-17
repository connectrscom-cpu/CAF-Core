/**
 * NEEDS_EDIT → override-only, partial, or full rework (n8n CAF_REWORK_ORCHESTRATOR subset).
 * Full/partial rework keeps the same `task_id`, clears render/output state via `prepareContentJobForFullRerun`,
 * then runs the standard pipeline so `job_drafts` and assets accumulate per task.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { insertEditorialReview } from "../repositories/ops.js";
import { insertJobStateTransition } from "../repositories/transitions.js";
import {
  appendReworkHistory,
  prepareContentJobForFullRerun,
  processContentJobById,
  RenderNotReadyError,
} from "./job-pipeline.js";
import {
  applyEditorialFlatOverridesToGeneratedOutput,
  hasEditorialCopyFlatOverrides,
  partitionEditorialOverrides,
} from "./editorial-copy-apply.js";

export type ReworkMode = "OVERRIDE_ONLY" | "FULL_REWORK" | "PARTIAL_REWRITE";

export function inferReworkMode(review: {
  rejection_tags?: unknown;
  notes?: string | null;
  overrides_json?: Record<string, unknown> | null;
}): ReworkMode {
  const ov = review.overrides_json ?? {};
  const tags = Array.isArray(review.rejection_tags)
    ? (review.rejection_tags as unknown[]).map((t) => String(t).toLowerCase())
    : [];
  const notes = (review.notes ?? "").toLowerCase();
  if (tags.some((t) => t.includes("full") || t.includes("regenerate"))) return "FULL_REWORK";
  if (notes.includes("full rewrite") || notes.includes("start over")) return "FULL_REWORK";
  if (tags.length >= 3) return "FULL_REWORK";
  const rewriteCopy = ov.rewrite_copy;
  if (rewriteCopy === false && hasEditorialCopyFlatOverrides(ov)) return "OVERRIDE_ONLY";
  if (tags.some((t) => t.includes("override") || t.includes("typo")) || notes.includes("override only")) {
    return "OVERRIDE_ONLY";
  }
  return "PARTIAL_REWRITE";
}

/** True if editorial `overrides_json` has at least one non-empty field worth merging into `generated_output`. */
export function hasMeaningfulOverrides(overrides: Record<string, unknown> | null | undefined): boolean {
  if (overrides == null || typeof overrides !== "object") return false;
  return Object.keys(overrides).some((k) => {
    if (k === "rewrite_copy") return false;
    const v = (overrides as Record<string, unknown>)[k];
    if (v == null) return false;
    if (typeof v === "string") return v.trim() !== "";
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === "object") return Object.keys(v as object).length > 0;
    return true;
  });
}

export interface ReworkResult {
  ok: boolean;
  mode: ReworkMode;
  /** Canonical job key; same as input for FULL/PARTIAL in-place rework. */
  task_id?: string;
  error?: string;
}

/**
 * Latest `editorial_reviews` row wins for queue tabs. After rework, insert a row with `decision` NULL so the
 * job leaves the NEEDS_EDIT tab while keeping full history; `task_id` never changes.
 */
async function insertReworkSupersedingReview(
  db: Pool,
  projectId: string,
  job: { task_id: string; candidate_id: string | null; run_id: string },
  mode: ReworkMode
): Promise<void> {
  await insertEditorialReview(db, {
    task_id: job.task_id,
    project_id: projectId,
    candidate_id: job.candidate_id,
    run_id: job.run_id,
    review_status: "REWORK_SUPERSEDED",
    decision: null,
    notes: `Prior NEEDS_EDIT cycle closed by ${mode} rework (same task_id). Older reviews and job_drafts remain for audit; this row resets queue routing.`,
    rejection_tags: [],
    overrides_json: {},
    validator: "rework-orchestrator",
    submit: false,
  });
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
    status: string | null;
    generation_payload: Record<string, unknown>;
  }>(
    db,
    `SELECT id, task_id, run_id, candidate_id, variation_name, flow_type, platform, status, generation_payload
     FROM caf_core.content_jobs WHERE project_id = $1 AND task_id = $2`,
    [projectId, taskId]
  );
  if (!job) return { ok: false, mode: "OVERRIDE_ONLY", error: "job not found" };

  type RevRow = {
    decision: string | null;
    rejection_tags: unknown;
    notes: string | null;
    overrides_json: Record<string, unknown>;
  };

  let rev: RevRow | null = await qOne<RevRow>(
    db,
    `SELECT decision, rejection_tags, notes, overrides_json FROM caf_core.editorial_reviews
     WHERE project_id = $1 AND task_id = $2 AND decision = 'NEEDS_EDIT'
     ORDER BY created_at DESC LIMIT 1`,
    [projectId, taskId]
  );

  /** QC / validation-router can set `content_jobs.status = NEEDS_EDIT` (REWORK_REQUIRED) with no editorial row. */
  if (!rev) {
    if (String(job.status ?? "").trim() !== "NEEDS_EDIT") {
      return { ok: false, mode: "OVERRIDE_ONLY", error: "no NEEDS_EDIT review found" };
    }
    const gp = job.generation_payload ?? {};
    const qc = gp.qc_result;
    let note =
      "System routing: job is NEEDS_EDIT (e.g. QC REWORK_REQUIRED) with no human NEEDS_EDIT review row — running partial rework.";
    if (qc && typeof qc === "object" && qc !== null) {
      const rs = String((qc as Record<string, unknown>).reason_short ?? "").trim();
      if (rs) note = `QC / system NEEDS_EDIT: ${rs}`;
    }
    rev = {
      decision: "NEEDS_EDIT",
      rejection_tags: [],
      notes: note,
      overrides_json: {},
    };
  }

  let mode = inferReworkMode(rev);
  if (mode === "OVERRIDE_ONLY" && !hasMeaningfulOverrides(rev.overrides_json)) {
    mode = "PARTIAL_REWRITE";
  }

  if (mode === "OVERRIDE_ONLY") {
    const gp: Record<string, unknown> = { ...(job.generation_payload ?? {}) };
    const gen = (gp.generated_output as Record<string, unknown>) ?? {};
    const overrides = rev.overrides_json ?? {};
    const { structural, flat } = partitionEditorialOverrides(overrides);
    let mergedOutput = { ...gen, ...structural };
    mergedOutput = applyEditorialFlatOverridesToGeneratedOutput(mergedOutput, flat);
    let genSnapshot: unknown = gen;
    try {
      genSnapshot = JSON.parse(JSON.stringify(gen)) as unknown;
    } catch {
      /* non-JSON-serializable generated_output: keep shallow ref in history */
    }
    appendReworkHistory(gp, {
      kind: "before_override_rework",
      draft_id: gp.draft_id ?? null,
      generated_output: genSnapshot,
      qc_result: gp.qc_result ?? null,
    });
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
          rework_history: gp.rework_history,
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
    await insertReworkSupersedingReview(db, projectId, job, mode);
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
        human_feedback: {
          notes: rev.notes,
          rejection_tags: rev.rejection_tags,
          rewrite_copy: rev.overrides_json?.rewrite_copy,
          editorial_overrides_json: rev.overrides_json ?? {},
        },
        generation_reason: mode === "PARTIAL_REWRITE" ? "REWORK_PARTIAL" : "REWORK_FULL",
      }),
      job.id,
    ]
  );

  try {
    await processContentJobById(db, config, job.id);
  } catch (err) {
    if (err instanceof RenderNotReadyError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, mode, error: msg, task_id: job.task_id };
  }

  await insertReworkSupersedingReview(db, projectId, job, mode);

  return { ok: true, mode, task_id: job.task_id };
}
