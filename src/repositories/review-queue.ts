import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface ReviewQueueJob {
  id: string;
  task_id: string;
  project_id: string;
  run_id: string;
  candidate_id: string | null;
  flow_type: string | null;
  platform: string | null;
  status: string | null;
  recommended_route: string | null;
  qc_status: string | null;
  pre_gen_score: string | null;
  generation_payload: Record<string, unknown>;
  review_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  latest_decision: string | null;
  latest_notes: string | null;
  latest_rejection_tags: unknown[];
  latest_validator: string | null;
  latest_submitted_at: string | null;
}

type ReviewTab = "in_review" | "approved" | "rejected" | "needs_edit";

function buildQueueQuery(tab: ReviewTab): string {
  const baseSelect = `
    SELECT
      j.id, j.task_id, j.project_id, j.run_id, j.candidate_id,
      j.flow_type, j.platform, j.status, j.recommended_route, j.qc_status,
      j.pre_gen_score::text, j.generation_payload, j.review_snapshot,
      j.created_at, j.updated_at,
      lr.decision AS latest_decision,
      lr.notes AS latest_notes,
      lr.rejection_tags AS latest_rejection_tags,
      lr.validator AS latest_validator,
      lr.submitted_at AS latest_submitted_at
    FROM caf_core.content_jobs j
    LEFT JOIN LATERAL (
      SELECT decision, notes, rejection_tags, validator, submitted_at
      FROM caf_core.editorial_reviews
      WHERE task_id = j.task_id AND project_id = j.project_id
      ORDER BY created_at DESC
      LIMIT 1
    ) lr ON true`;

  switch (tab) {
    case "in_review":
      return `${baseSelect}
        WHERE j.project_id = $1
          AND j.status IN ('GENERATED', 'IN_REVIEW', 'READY_FOR_REVIEW')
          AND (lr.decision IS NULL)
        ORDER BY j.created_at DESC`;
    case "approved":
      return `${baseSelect}
        WHERE j.project_id = $1
          AND lr.decision = 'APPROVED'
        ORDER BY lr.submitted_at DESC NULLS LAST`;
    case "rejected":
      return `${baseSelect}
        WHERE j.project_id = $1
          AND lr.decision = 'REJECTED'
        ORDER BY lr.submitted_at DESC NULLS LAST`;
    case "needs_edit":
      return `${baseSelect}
        WHERE j.project_id = $1
          AND lr.decision = 'NEEDS_EDIT'
        ORDER BY lr.submitted_at DESC NULLS LAST`;
  }
}

export async function listReviewQueue(
  db: Pool,
  projectId: string,
  tab: ReviewTab,
  limit = 100,
  offset = 0
): Promise<ReviewQueueJob[]> {
  const sql = buildQueueQuery(tab) + ` LIMIT $2 OFFSET $3`;
  return q<ReviewQueueJob>(db, sql, [projectId, limit, offset]);
}

export async function countReviewQueue(
  db: Pool,
  projectId: string
): Promise<Record<ReviewTab, number>> {
  const row = await qOne<{
    in_review: string;
    approved: string;
    rejected: string;
    needs_edit: string;
  }>(
    db,
    `SELECT
       COUNT(*) FILTER (
         WHERE j.status IN ('GENERATED', 'IN_REVIEW', 'READY_FOR_REVIEW')
           AND lr.decision IS NULL
       )::text AS in_review,
       COUNT(*) FILTER (WHERE lr.decision = 'APPROVED')::text AS approved,
       COUNT(*) FILTER (WHERE lr.decision = 'REJECTED')::text AS rejected,
       COUNT(*) FILTER (WHERE lr.decision = 'NEEDS_EDIT')::text AS needs_edit
     FROM caf_core.content_jobs j
     LEFT JOIN LATERAL (
       SELECT decision FROM caf_core.editorial_reviews
       WHERE task_id = j.task_id AND project_id = j.project_id
       ORDER BY created_at DESC LIMIT 1
     ) lr ON true
     WHERE j.project_id = $1`,
    [projectId]
  );
  return {
    in_review: row ? parseInt(row.in_review, 10) : 0,
    approved: row ? parseInt(row.approved, 10) : 0,
    rejected: row ? parseInt(row.rejected, 10) : 0,
    needs_edit: row ? parseInt(row.needs_edit, 10) : 0,
  };
}

export interface ReviewJobDetail extends ReviewQueueJob {
  assets: Array<{
    id: string;
    asset_type: string | null;
    public_url: string | null;
    position: number;
  }>;
  reviews: Array<{
    id: string;
    decision: string | null;
    notes: string | null;
    rejection_tags: unknown[];
    validator: string | null;
    submitted_at: string | null;
    created_at: string;
  }>;
  auto_validation: {
    format_ok: boolean | null;
    hook_score: string | null;
    clarity_score: string | null;
    overall_score: string | null;
    pass_auto: boolean;
    banned_hits: unknown[];
  } | null;
}

export async function getReviewJobDetail(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<ReviewJobDetail | null> {
  const job = await qOne<ReviewQueueJob>(
    db,
    `SELECT
       j.id, j.task_id, j.project_id, j.run_id, j.candidate_id,
       j.flow_type, j.platform, j.status, j.recommended_route, j.qc_status,
       j.pre_gen_score::text, j.generation_payload, j.review_snapshot,
       j.created_at, j.updated_at,
       lr.decision AS latest_decision,
       lr.notes AS latest_notes,
       lr.rejection_tags AS latest_rejection_tags,
       lr.validator AS latest_validator,
       lr.submitted_at AS latest_submitted_at
     FROM caf_core.content_jobs j
     LEFT JOIN LATERAL (
       SELECT decision, notes, rejection_tags, validator, submitted_at
       FROM caf_core.editorial_reviews
       WHERE task_id = j.task_id AND project_id = j.project_id
       ORDER BY created_at DESC LIMIT 1
     ) lr ON true
     WHERE j.project_id = $1 AND j.task_id = $2`,
    [projectId, taskId]
  );
  if (!job) return null;

  const assets = await q<{
    id: string;
    asset_type: string | null;
    public_url: string | null;
    position: number;
  }>(
    db,
    `SELECT id, asset_type, public_url, position
     FROM caf_core.assets
     WHERE project_id = $1 AND task_id = $2
     ORDER BY position ASC`,
    [projectId, taskId]
  );

  const reviews = await q<{
    id: string;
    decision: string | null;
    notes: string | null;
    rejection_tags: unknown[];
    validator: string | null;
    submitted_at: string | null;
    created_at: string;
  }>(
    db,
    `SELECT id, decision, notes, rejection_tags, validator, submitted_at, created_at
     FROM caf_core.editorial_reviews
     WHERE project_id = $1 AND task_id = $2
     ORDER BY created_at DESC`,
    [projectId, taskId]
  );

  const autoVal = await qOne<{
    format_ok: boolean | null;
    hook_score: string | null;
    clarity_score: string | null;
    overall_score: string | null;
    pass_auto: boolean;
    banned_hits: unknown[];
  }>(
    db,
    `SELECT format_ok, hook_score::text, clarity_score::text, overall_score::text, pass_auto, banned_hits
     FROM caf_core.auto_validation_results
     WHERE project_id = $1 AND task_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [projectId, taskId]
  );

  return { ...job, assets, reviews, auto_validation: autoVal };
}
