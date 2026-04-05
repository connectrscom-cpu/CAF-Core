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

export type ReviewTab = "in_review" | "approved" | "rejected" | "needs_edit";

export interface ReviewQueueFilters {
  search?: string;
  platform?: string;
  flow_type?: string;
  recommended_route?: string;
  qc_status?: string;
  review_status?: string;
  decision?: string;
  has_preview?: boolean;
  risk_score_min?: number;
  run_id?: string;
  sort?: "task_id" | "newest" | "oldest" | "status";
  group_by?: "project" | "platform" | "flow_type" | "recommended_route";
}

const BASE_SELECT = `
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

function buildTabWhere(tab: ReviewTab): string {
  switch (tab) {
    case "in_review":
      return `j.status IN ('GENERATED', 'IN_REVIEW', 'READY_FOR_REVIEW') AND lr.decision IS NULL`;
    case "approved":
      return `lr.decision = 'APPROVED'`;
    case "rejected":
      return `lr.decision = 'REJECTED'`;
    case "needs_edit":
      return `lr.decision = 'NEEDS_EDIT'`;
  }
}

function buildFilterClauses(filters: ReviewQueueFilters, paramStart: number): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = paramStart;

  if (filters.search) {
    clauses.push(`(j.task_id ILIKE $${idx} OR j.generation_payload::text ILIKE $${idx})`);
    params.push(`%${filters.search}%`);
    idx++;
  }
  if (filters.platform) {
    clauses.push(`j.platform = $${idx}`);
    params.push(filters.platform);
    idx++;
  }
  if (filters.flow_type) {
    clauses.push(`j.flow_type = $${idx}`);
    params.push(filters.flow_type);
    idx++;
  }
  if (filters.recommended_route) {
    clauses.push(`j.recommended_route = $${idx}`);
    params.push(filters.recommended_route);
    idx++;
  }
  if (filters.qc_status) {
    clauses.push(`j.qc_status = $${idx}`);
    params.push(filters.qc_status);
    idx++;
  }
  if (filters.review_status) {
    clauses.push(`j.status = $${idx}`);
    params.push(filters.review_status);
    idx++;
  }
  if (filters.decision) {
    clauses.push(`lr.decision = $${idx}`);
    params.push(filters.decision);
    idx++;
  }
  if (filters.run_id) {
    clauses.push(`j.run_id = $${idx}`);
    params.push(filters.run_id);
    idx++;
  }
  if (filters.risk_score_min != null) {
    clauses.push(`j.pre_gen_score >= $${idx}`);
    params.push(filters.risk_score_min);
    idx++;
  }
  if (filters.has_preview === true) {
    clauses.push(`EXISTS (SELECT 1 FROM caf_core.assets a WHERE a.task_id = j.task_id AND a.project_id = j.project_id)`);
  }

  return { clauses, params };
}

function buildOrderBy(sort?: string, tab?: ReviewTab): string {
  switch (sort) {
    case "task_id": return `ORDER BY j.task_id ASC`;
    case "oldest": return `ORDER BY j.created_at ASC`;
    case "status": return `ORDER BY j.status ASC, j.created_at DESC`;
    default:
      if (tab && tab !== "in_review") return `ORDER BY lr.submitted_at DESC NULLS LAST`;
      return `ORDER BY j.created_at DESC`;
  }
}

export async function listReviewQueue(
  db: Pool,
  projectId: string,
  tab: ReviewTab,
  limit = 100,
  offset = 0,
  filters: ReviewQueueFilters = {}
): Promise<ReviewQueueJob[]> {
  const tabWhere = buildTabWhere(tab);
  const { clauses, params: filterParams } = buildFilterClauses(filters, 4);
  const allClauses = [`j.project_id = $1`, tabWhere, ...clauses].join(" AND ");
  const orderBy = buildOrderBy(filters.sort, tab);
  const sql = `${BASE_SELECT} WHERE ${allClauses} ${orderBy} LIMIT $2 OFFSET $3`;
  return q<ReviewQueueJob>(db, sql, [projectId, limit, offset, ...filterParams]);
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

export async function getDistinctValues(
  db: Pool,
  projectId: string
): Promise<{
  platforms: string[];
  flow_types: string[];
  routes: string[];
  runs: string[];
  statuses: string[];
}> {
  const [platforms, flow_types, routes, runs, statuses] = await Promise.all([
    q<{ v: string }>(db, `SELECT DISTINCT platform AS v FROM caf_core.content_jobs WHERE project_id = $1 AND platform IS NOT NULL ORDER BY v`, [projectId]),
    q<{ v: string }>(db, `SELECT DISTINCT flow_type AS v FROM caf_core.content_jobs WHERE project_id = $1 AND flow_type IS NOT NULL ORDER BY v`, [projectId]),
    q<{ v: string }>(db, `SELECT DISTINCT recommended_route AS v FROM caf_core.content_jobs WHERE project_id = $1 AND recommended_route IS NOT NULL ORDER BY v`, [projectId]),
    q<{ v: string }>(db, `SELECT DISTINCT run_id AS v FROM caf_core.content_jobs WHERE project_id = $1 ORDER BY v`, [projectId]),
    q<{ v: string }>(db, `SELECT DISTINCT status AS v FROM caf_core.content_jobs WHERE project_id = $1 AND status IS NOT NULL ORDER BY v`, [projectId]),
  ]);
  return {
    platforms: platforms.map((r) => r.v),
    flow_types: flow_types.map((r) => r.v),
    routes: routes.map((r) => r.v),
    runs: runs.map((r) => r.v),
    statuses: statuses.map((r) => r.v),
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
