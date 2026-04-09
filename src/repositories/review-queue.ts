import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";
import { slidesJsonForReviewUi } from "../services/review-ui-slides.js";

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
  /** First asset URL for workbench thumbnails (prefers image-like assets). */
  preview_thumb_url?: string | null;
}

export type ReviewTab = "in_review" | "approved" | "rejected" | "needs_edit";

/** Row from the cross-project review queue (includes tenant slug). */
export interface ReviewQueueJobWithProject extends ReviewQueueJob {
  project_slug: string;
  project_display_name: string | null;
}

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
  /** When listing across tenants (global queue), filter by `caf_core.projects.slug`. */
  project_slug?: string;
  sort?: "task_id" | "newest" | "oldest" | "status";
  group_by?: "project" | "platform" | "flow_type" | "recommended_route";
}

/** Latest editorial row per job (same join for list, count, and breakdown). */
const JOBS_FROM_WITH_LATEST_REVIEW = `
  FROM caf_core.content_jobs j
  LEFT JOIN LATERAL (
    SELECT decision, notes, rejection_tags, validator, submitted_at
    FROM caf_core.editorial_reviews
    WHERE task_id = j.task_id AND project_id = j.project_id
    ORDER BY created_at DESC
    LIMIT 1
  ) lr ON true`;

const PREVIEW_THUMB_SUBQUERY = `
  (
    SELECT a.public_url
    FROM caf_core.assets a
    WHERE a.project_id = j.project_id AND a.task_id = j.task_id
      AND a.public_url IS NOT NULL AND TRIM(a.public_url) <> ''
    ORDER BY
      CASE
        WHEN lower(coalesce(a.asset_type, '')) LIKE '%image%' THEN 0
        WHEN lower(coalesce(a.asset_type, '')) LIKE '%carousel%' THEN 0
        WHEN a.public_url ~* '\\.(png|jpg|jpeg|gif|webp|avif)(\\?|#|$)' THEN 0
        WHEN lower(coalesce(a.asset_type, '')) LIKE '%video%' THEN 1
        WHEN a.public_url ~* '\\.(mp4|webm|mov|m4v)(\\?|#|$)' THEN 1
        ELSE 2
      END,
      a.position ASC NULLS LAST
    LIMIT 1
  )`;

const REVIEW_QUEUE_ROW_SELECT = `
  SELECT
    j.id, j.task_id, j.project_id, j.run_id, j.candidate_id,
    j.flow_type, j.platform, j.status, j.recommended_route, j.qc_status,
    j.pre_gen_score::text, j.generation_payload, j.review_snapshot,
    j.created_at, j.updated_at,
    lr.decision AS latest_decision,
    lr.notes AS latest_notes,
    lr.rejection_tags AS latest_rejection_tags,
    lr.validator AS latest_validator,
    lr.submitted_at AS latest_submitted_at,
    ${PREVIEW_THUMB_SUBQUERY.trim()} AS preview_thumb_url
  ${JOBS_FROM_WITH_LATEST_REVIEW}`;

function buildTabWhere(tab: ReviewTab): string {
  switch (tab) {
    case "in_review":
      /* Human queue: no submitted editorial decision yet. Includes GENERATED when render has not yet promoted to IN_REVIEW. */
      return `j.status IN ('GENERATED', 'IN_REVIEW', 'READY_FOR_REVIEW') AND lr.decision IS NULL`;
    case "approved":
      return `lr.decision = 'APPROVED'`;
    case "rejected":
      return `lr.decision = 'REJECTED'`;
    case "needs_edit":
      return `lr.decision = 'NEEDS_EDIT'`;
  }
}

function buildFilterClauses(
  filters: ReviewQueueFilters,
  paramStart: number,
  opts?: { projectSlugColumn?: "p.slug" }
): { clauses: string[]; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let idx = paramStart;

  if (opts?.projectSlugColumn && filters.project_slug) {
    clauses.push(`${opts.projectSlugColumn} = $${idx}`);
    params.push(filters.project_slug);
    idx++;
  }

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
  const sql = `${REVIEW_QUEUE_ROW_SELECT.trim()} WHERE ${allClauses} ${orderBy} LIMIT $2 OFFSET $3`;
  return q<ReviewQueueJob>(db, sql, [projectId, limit, offset, ...filterParams]);
}

/** Same filters as listReviewQueue; for pagination totals. */
export async function countReviewQueueFiltered(
  db: Pool,
  projectId: string,
  tab: ReviewTab,
  filters: ReviewQueueFilters = {}
): Promise<number> {
  const tabWhere = buildTabWhere(tab);
  const { clauses, params: filterParams } = buildFilterClauses(filters, 2);
  const allClauses = [`j.project_id = $1`, tabWhere, ...clauses].join(" AND ");
  const sql = `SELECT COUNT(*)::text AS n ${JOBS_FROM_WITH_LATEST_REVIEW} WHERE ${allClauses}`;
  const row = await qOne<{ n: string }>(db, sql, [projectId, ...filterParams]);
  return row ? parseInt(row.n, 10) : 0;
}

/** Per job.status counts for the current tab + filters (review UI chips). */
export async function reviewQueueStatusBreakdown(
  db: Pool,
  projectId: string,
  tab: ReviewTab,
  filters: ReviewQueueFilters = {}
): Promise<Record<string, number>> {
  const tabWhere = buildTabWhere(tab);
  const { clauses, params: filterParams } = buildFilterClauses(filters, 2);
  const allClauses = [`j.project_id = $1`, tabWhere, ...clauses].join(" AND ");
  const sql = `SELECT COALESCE(NULLIF(TRIM(j.status), ''), '(empty)') AS st, COUNT(*)::text AS n
     ${JOBS_FROM_WITH_LATEST_REVIEW}
     WHERE ${allClauses}
     GROUP BY 1
     ORDER BY 1`;
  const rows = await q<{ st: string; n: string }>(db, sql, [projectId, ...filterParams]);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.st] = parseInt(r.n, 10);
  return out;
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
  /** Set when resolving a task across projects (workbench “all tenants”). */
  project_slug?: string;
  /** Flat slides JSON derived from merged generation payload (review UI copy). */
  review_slides_json?: string | null;
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
     WHERE j.project_id = $1 AND trim(j.task_id) = trim($2)`,
    [projectId, taskId]
  );
  if (!job) return null;

  const canonicalTid = job.task_id;

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
    [projectId, canonicalTid]
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
    [projectId, canonicalTid]
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
    [projectId, canonicalTid]
  );

  const review_slides_json = slidesJsonForReviewUi(job.flow_type, job.generation_payload as Record<string, unknown>);
  return { ...job, assets, reviews, auto_validation: autoVal, review_slides_json };
}

// ── Cross-project review queue (active projects only) ─────────────────────

const JOBS_GLOBAL_FROM = `
  FROM caf_core.content_jobs j
  INNER JOIN caf_core.projects p ON p.id = j.project_id AND p.active = true
  LEFT JOIN LATERAL (
    SELECT decision, notes, rejection_tags, validator, submitted_at
    FROM caf_core.editorial_reviews
    WHERE task_id = j.task_id AND project_id = j.project_id
    ORDER BY created_at DESC
    LIMIT 1
  ) lr ON true`;

const REVIEW_QUEUE_GLOBAL_ROW_SELECT = `
  SELECT
    j.id, j.task_id, j.project_id, j.run_id, j.candidate_id,
    j.flow_type, j.platform, j.status, j.recommended_route, j.qc_status,
    j.pre_gen_score::text, j.generation_payload, j.review_snapshot,
    j.created_at, j.updated_at,
    lr.decision AS latest_decision,
    lr.notes AS latest_notes,
    lr.rejection_tags AS latest_rejection_tags,
    lr.validator AS latest_validator,
    lr.submitted_at AS latest_submitted_at,
    p.slug AS project_slug,
    p.display_name AS project_display_name,
    ${PREVIEW_THUMB_SUBQUERY.trim()} AS preview_thumb_url
  ${JOBS_GLOBAL_FROM}`;

export async function listReviewQueueAllProjects(
  db: Pool,
  tab: ReviewTab,
  limit = 100,
  offset = 0,
  filters: ReviewQueueFilters = {}
): Promise<ReviewQueueJobWithProject[]> {
  const tabWhere = buildTabWhere(tab);
  const { clauses, params: filterParams } = buildFilterClauses(filters, 3, { projectSlugColumn: "p.slug" });
  const allClauses = [tabWhere, ...clauses].join(" AND ");
  const orderBy = buildOrderBy(filters.sort, tab);
  const sql = `${REVIEW_QUEUE_GLOBAL_ROW_SELECT.trim()} WHERE ${allClauses} ${orderBy} LIMIT $1 OFFSET $2`;
  return q<ReviewQueueJobWithProject>(db, sql, [limit, offset, ...filterParams]);
}

export async function countReviewQueueAllProjectsFiltered(
  db: Pool,
  tab: ReviewTab,
  filters: ReviewQueueFilters = {}
): Promise<number> {
  const tabWhere = buildTabWhere(tab);
  const { clauses, params: filterParams } = buildFilterClauses(filters, 1, { projectSlugColumn: "p.slug" });
  const allClauses = [tabWhere, ...clauses].join(" AND ");
  const sql = `SELECT COUNT(*)::text AS n ${JOBS_GLOBAL_FROM} WHERE ${allClauses}`;
  const row = await qOne<{ n: string }>(db, sql, [...filterParams]);
  return row ? parseInt(row.n, 10) : 0;
}

export async function reviewQueueStatusBreakdownAllProjects(
  db: Pool,
  tab: ReviewTab,
  filters: ReviewQueueFilters = {}
): Promise<Record<string, number>> {
  const tabWhere = buildTabWhere(tab);
  const { clauses, params: filterParams } = buildFilterClauses(filters, 1, { projectSlugColumn: "p.slug" });
  const allClauses = [tabWhere, ...clauses].join(" AND ");
  const sql = `SELECT COALESCE(NULLIF(TRIM(j.status), ''), '(empty)') AS st, COUNT(*)::text AS n
     ${JOBS_GLOBAL_FROM}
     WHERE ${allClauses}
     GROUP BY 1
     ORDER BY 1`;
  const rows = await q<{ st: string; n: string }>(db, sql, [...filterParams]);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.st] = parseInt(r.n, 10);
  return out;
}

export async function countReviewQueueAllProjects(db: Pool): Promise<Record<ReviewTab, number>> {
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
     ${JOBS_GLOBAL_FROM}`
  );
  return {
    in_review: row ? parseInt(row.in_review, 10) : 0,
    approved: row ? parseInt(row.approved, 10) : 0,
    rejected: row ? parseInt(row.rejected, 10) : 0,
    needs_edit: row ? parseInt(row.needs_edit, 10) : 0,
  };
}

export async function getDistinctValuesAllProjects(db: Pool): Promise<{
  projects: string[];
  platforms: string[];
  flow_types: string[];
  routes: string[];
  runs: string[];
  statuses: string[];
}> {
  const base = `FROM caf_core.content_jobs j
    INNER JOIN caf_core.projects p ON p.id = j.project_id AND p.active = true`;
  const [projects, platforms, flow_types, routes, runs, statuses] = await Promise.all([
    q<{ v: string }>(db, `SELECT DISTINCT p.slug AS v ${base} ORDER BY v`),
    q<{ v: string }>(db, `SELECT DISTINCT j.platform AS v ${base} AND j.platform IS NOT NULL ORDER BY v`),
    q<{ v: string }>(db, `SELECT DISTINCT j.flow_type AS v ${base} AND j.flow_type IS NOT NULL ORDER BY v`),
    q<{ v: string }>(
      db,
      `SELECT DISTINCT j.recommended_route AS v ${base} AND j.recommended_route IS NOT NULL ORDER BY v`
    ),
    q<{ v: string }>(db, `SELECT DISTINCT j.run_id AS v ${base} ORDER BY v`),
    q<{ v: string }>(db, `SELECT DISTINCT j.status AS v ${base} AND j.status IS NOT NULL ORDER BY v`),
  ]);
  return {
    projects: projects.map((r) => r.v),
    platforms: platforms.map((r) => r.v),
    flow_types: flow_types.map((r) => r.v),
    routes: routes.map((r) => r.v),
    runs: runs.map((r) => r.v),
    statuses: statuses.map((r) => r.v),
  };
}

export type ResolveTaskProjectResult =
  | { ok: true; project_id: string; project_slug: string }
  | { ok: false; reason: "not_found" };

/**
 * Map a task_id string to a project. Trims whitespace; if the same id exists in multiple tenants
 * (should be rare), prefers an active project then the most recently updated row — never 409.
 */
export async function resolveTaskToProject(
  db: Pool,
  taskId: string,
  projectSlug?: string | null
): Promise<ResolveTaskProjectResult> {
  const tid = taskId.trim();
  if (!tid) return { ok: false, reason: "not_found" };
  const rows = await q<{ project_id: string; slug: string }>(
    db,
    `SELECT j.project_id, p.slug
     FROM caf_core.content_jobs j
     INNER JOIN caf_core.projects p ON p.id = j.project_id
     WHERE trim(j.task_id) = $1 AND ($2::text IS NULL OR p.slug = $2)
     ORDER BY p.active DESC NULLS LAST, j.updated_at DESC NULLS LAST`,
    [tid, projectSlug?.trim() ? projectSlug.trim() : null]
  );
  if (rows.length === 0) return { ok: false, reason: "not_found" };
  return { ok: true, project_id: rows[0]!.project_id, project_slug: rows[0]!.slug };
}

