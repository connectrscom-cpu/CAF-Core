import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";
import { isReadyToPublishApproval } from "../domain/editorial-edits-detect.js";

export interface ObservabilityJobBreakdown {
  by_status: Record<string, number>;
  total_jobs: number;
}

export interface ReadyToPublishMetrics {
  /** Distinct tasks with at least one editorial review row (proxy: entered human review). */
  jobs_reviewed: number;
  /** Latest decision APPROVED (per task). */
  approved_count: number;
  /** APPROVED with no copy/render overrides on that approval row. */
  ready_to_publish_count: number;
  /** ready_to_publish_count / jobs_reviewed when denominator > 0. */
  ready_to_publish_rate: number | null;
  needs_edit_count: number;
  rejected_count: number;
}

export interface RejectionTagCount {
  tag: string;
  count: number;
}

export interface PublicationMetrics {
  by_status: Record<string, number>;
  publish_attempts: number;
  published: number;
  failed: number;
}

export interface ObservabilityLearningSummary {
  rules_by_status: Record<string, number>;
  attribution_rows_30d: number;
}

export interface ObservabilityApiAuditSummary {
  audited_calls: number;
  ok_calls: number;
  failed_calls: number;
  token_usage_sum: number;
  /** Sum of api_call_audit.estimated_cost_usd when migration 053 applied and rates configured. */
  estimated_cost_usd_sum: number;
}

export interface ObservabilityTransitionSummary {
  transition_rows: number;
}

export interface ObservabilityProjectMetrics {
  scope: "project";
  project_id: string;
  run_id: string | null;
  jobs: ObservabilityJobBreakdown;
  /** QC gate: BLOCKED + QC_FAILED / jobs that reached GENERATED or beyond — approximated as share of total jobs. */
  qc_gate_failed: number;
  blocked: number;
  qc_failed: number;
  failed_jobs: number;
  planned_jobs: number;
  /** Sum of runs.total_jobs — planner output slots across runs (not the same as PLANNED status rows). */
  planned_slots_from_runs: number;
  generated_jobs: number;
  in_review_jobs: number;
  review: ReadyToPublishMetrics;
  rejection_tags: RejectionTagCount[];
  publications: PublicationMetrics;
  learning: ObservabilityLearningSummary;
  api_audit: ObservabilityApiAuditSummary;
  transitions: ObservabilityTransitionSummary;
  diagnostic_audits: number;
  definitions: Record<string, string>;
}

export interface ObservabilityPlatformProjectRow {
  slug: string;
  display_name: string | null;
  active: boolean;
  total_jobs: number;
  jobs_reviewed: number;
  ready_to_publish_rate: number | null;
  qc_gate_failed: number;
}

export interface ObservabilityPlatformSummary {
  scope: "platform";
  projects: ObservabilityPlatformProjectRow[];
  totals: {
    projects: number;
    jobs: number;
    jobs_reviewed: number;
    ready_to_publish_count: number;
  };
}

interface LatestReviewRow {
  task_id: string;
  decision: string | null;
  overrides_json: unknown;
  rejection_tags: unknown;
}

async function latestEditorialReviewsForProject(
  db: Pool,
  projectId: string,
  runId?: string | null
): Promise<LatestReviewRow[]> {
  const params: unknown[] = [projectId];
  let runClause = "";
  if (runId?.trim()) {
    params.push(runId.trim());
    runClause = ` AND ER.run_id = $${params.length}`;
  }
  return q<LatestReviewRow>(
    db,
    `SELECT DISTINCT ON (ER.task_id)
        ER.task_id,
        ER.decision,
        ER.overrides_json,
        ER.rejection_tags
     FROM caf_core.editorial_reviews ER
     WHERE ER.project_id = $1${runClause}
     ORDER BY ER.task_id, ER.created_at DESC`,
    params
  );
}

function aggregateRejectionTags(rows: LatestReviewRow[]): RejectionTagCount[] {
  const map = new Map<string, number>();
  for (const r of rows) {
    if ((r.decision ?? "").toUpperCase() !== "REJECTED") continue;
    const raw = r.rejection_tags;
    if (!Array.isArray(raw)) continue;
    for (const t of raw) {
      const tag = String(t).trim();
      if (!tag) continue;
      map.set(tag, (map.get(tag) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 40);
}

export async function getProjectObservabilityMetrics(
  db: Pool,
  projectId: string,
  opts?: { runId?: string | null }
): Promise<ObservabilityProjectMetrics> {
  const runId = opts?.runId?.trim() || null;
  const runClause = runId ? ` AND c.run_id = $2 ` : "";
  const params: unknown[] = runId ? [projectId, runId] : [projectId];

  const statusRows = await q<{ status: string | null; c: string }>(
    db,
    `SELECT COALESCE(c.status, '(null)') AS status, COUNT(*)::text AS c
     FROM caf_core.content_jobs c
     WHERE c.project_id = $1 ${runClause}
     GROUP BY c.status`,
    params
  );
  const by_status: Record<string, number> = {};
  let total_jobs = 0;
  for (const r of statusRows) {
    const n = parseInt(r.c, 10);
    by_status[r.status ?? "(null)"] = n;
    total_jobs += n;
  }

  const latestReviews = await latestEditorialReviewsForProject(db, projectId, runId);

  let approved_count = 0;
  let ready_to_publish_count = 0;
  let needs_edit_count = 0;
  let rejected_count = 0;

  for (const r of latestReviews) {
    const d = (r.decision ?? "").toUpperCase();
    if (d === "APPROVED") {
      approved_count++;
      if (isReadyToPublishApproval(r.overrides_json)) ready_to_publish_count++;
    } else if (d === "NEEDS_EDIT") needs_edit_count++;
    else if (d === "REJECTED") rejected_count++;
  }

  const jobs_reviewed = latestReviews.length;
  const ready_to_publish_rate =
    jobs_reviewed > 0 ? ready_to_publish_count / jobs_reviewed : null;

  const rejection_tags = aggregateRejectionTags(latestReviews);

  const publications = await q<{ status: string; c: string }>(
    db,
    `SELECT pp.status, COUNT(*)::text AS c
     FROM caf_core.publication_placements pp
     INNER JOIN caf_core.content_jobs cj ON cj.project_id = pp.project_id AND cj.task_id = pp.task_id
     WHERE pp.project_id = $1 AND ($2::text IS NULL OR cj.run_id = $2)
     GROUP BY pp.status`,
    [projectId, runId]
  );
  const pubBy: Record<string, number> = {};
  let published = 0;
  let failed = 0;
  let publish_attempts = 0;
  for (const p of publications) {
    const n = parseInt(p.c, 10);
    pubBy[p.status] = n;
    publish_attempts += n;
    if (p.status === "published") published += n;
    if (p.status === "failed") failed += n;
  }

  const learningRows = await q<{ status: string; c: string }>(
    db,
    `SELECT COALESCE(status, '(null)') AS status, COUNT(*)::text AS c
     FROM caf_core.learning_rules WHERE project_id = $1 GROUP BY status`,
    [projectId]
  );
  const rules_by_status: Record<string, number> = {};
  for (const r of learningRows) rules_by_status[r.status] = parseInt(r.c, 10);

  const attrRow = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.learning_generation_attribution
     WHERE project_id = $1 AND created_at >= now() - interval '30 days'`,
    [projectId]
  );
  const attribution_rows_30d = attrRow ? parseInt(attrRow.c, 10) : 0;

  const auditWhere = runId
    ? `project_id = $1 AND (run_id = $2 OR task_id IN (SELECT task_id FROM caf_core.content_jobs WHERE project_id = $1 AND run_id = $2))`
    : `project_id = $1`;
  const auditParams = runId ? [projectId, runId] : [projectId];
  const auditAgg = await qOne<{
    n: string | null;
    ok_n: string | null;
    tok: string | null;
    cost: string | null;
  }>(
    db,
    `SELECT
       COUNT(*)::text AS n,
       COUNT(*) FILTER (WHERE ok IS TRUE)::text AS ok_n,
       COALESCE(SUM(token_usage), 0)::text AS tok,
       COALESCE(SUM(estimated_cost_usd), 0)::text AS cost
     FROM caf_core.api_call_audit
     WHERE ${auditWhere}`,
    auditParams
  );
  const audited_calls = auditAgg?.n ? parseInt(auditAgg.n, 10) : 0;
  const ok_calls = auditAgg?.ok_n ? parseInt(auditAgg.ok_n, 10) : 0;
  const failed_calls = Math.max(0, audited_calls - ok_calls);
  const token_usage_sum = auditAgg?.tok ? parseFloat(auditAgg.tok) : 0;
  const estimated_cost_usd_sum = auditAgg?.cost ? parseFloat(auditAgg.cost) : 0;

  const transParams = runId ? [projectId, runId] : [projectId];
  const transWhere = runId
    ? `jt.project_id = $1 AND EXISTS (SELECT 1 FROM caf_core.content_jobs c WHERE c.project_id = jt.project_id AND c.task_id = jt.task_id AND c.run_id = $2)`
    : `jt.project_id = $1`;
  const transRow = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.job_state_transitions jt WHERE ${transWhere}`,
    transParams
  );
  const transition_rows = transRow ? parseInt(transRow.c, 10) : 0;

  const diagRow = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.diagnostic_audits WHERE project_id = $1`,
    [projectId]
  );
  const diagnostic_audits = diagRow ? parseInt(diagRow.c, 10) : 0;

  const blocked = by_status.BLOCKED ?? 0;
  const qc_failed = by_status.QC_FAILED ?? 0;
  const qc_gate_failed = blocked + qc_failed;
  const failed_jobs = by_status.FAILED ?? 0;
  const planned_jobs = by_status.PLANNED ?? 0;
  const generated_jobs = by_status.GENERATED ?? 0;
  const in_review_jobs = by_status.IN_REVIEW ?? 0;

  const slotsRow = await qOne<{ s: string | null }>(
    db,
    `SELECT COALESCE(SUM(total_jobs), 0)::text AS s FROM caf_core.runs WHERE project_id = $1`,
    [projectId]
  );
  const planned_slots_from_runs = slotsRow?.s ? parseInt(slotsRow.s, 10) : 0;

  return {
    scope: "project",
    project_id: projectId,
    run_id: runId,
    jobs: { by_status, total_jobs },
    qc_gate_failed,
    blocked,
    qc_failed,
    failed_jobs,
    planned_jobs,
    planned_slots_from_runs,
    generated_jobs,
    in_review_jobs,
    review: {
      jobs_reviewed,
      approved_count,
      ready_to_publish_count,
      ready_to_publish_rate,
      needs_edit_count,
      rejected_count,
    },
    rejection_tags,
    publications: {
      by_status: pubBy,
      publish_attempts,
      published,
      failed,
    },
    learning: {
      rules_by_status,
      attribution_rows_30d,
    },
    api_audit: {
      audited_calls,
      ok_calls,
      failed_calls,
      token_usage_sum,
      estimated_cost_usd_sum,
    },
    transitions: { transition_rows },
    diagnostic_audits,
    definitions: {
      ready_to_publish:
        "Approved on latest review row with no copy overrides and no render/meta edits (see editorial flat vs structural keys). Denominator: distinct tasks with at least one editorial review.",
      jobs_reviewed:
        "Distinct tasks with ≥1 row in editorial_reviews (latest row used for decision counts).",
      qc_gate_failed: "Jobs in status BLOCKED or QC_FAILED.",
      token_usage: "Sum of api_call_audit.token_usage (OpenAI etc.).",
      estimated_cost_usd:
        "Sum of api_call_audit.estimated_cost_usd — carousel from Fly $/h × slide HTTP latency; HeyGen from $/min × output duration. Set CAF_COST_* env vars.",
      schema_fail:
        "Not split from other QC failures in DB v1; use QC_FAILED + diagnostics for investigation.",
    },
  };
}

export async function getPlatformObservabilitySummary(db: Pool): Promise<ObservabilityPlatformSummary> {
  const projects = await q<{ id: string; slug: string; display_name: string | null; active: boolean }>(
    db,
    `SELECT id, slug, display_name, active FROM caf_core.projects ORDER BY slug ASC`
  );

  const rows: ObservabilityPlatformProjectRow[] = [];
  let sumJobs = 0;
  let sumReviewed = 0;
  let sumRtp = 0;

  for (const p of projects) {
    if (p.slug === "caf-global") continue;

    const jobRow = await qOne<{ c: string }>(
      db,
      `SELECT COUNT(*)::text AS c FROM caf_core.content_jobs WHERE project_id = $1`,
      [p.id]
    );
    const total_jobs = jobRow ? parseInt(jobRow.c, 10) : 0;

    const reviews = await latestEditorialReviewsForProject(db, p.id, null);
    const jobs_reviewed = reviews.length;
    let ready = 0;
    for (const r of reviews) {
      if ((r.decision ?? "").toUpperCase() === "APPROVED" && isReadyToPublishApproval(r.overrides_json)) {
        ready++;
      }
    }
    const ready_to_publish_rate = jobs_reviewed > 0 ? ready / jobs_reviewed : null;

    const st = await q<{ status: string | null; c: string }>(
      db,
      `SELECT COALESCE(status, '(null)') AS status, COUNT(*)::text AS c
       FROM caf_core.content_jobs WHERE project_id = $1 GROUP BY status`,
      [p.id]
    );
    let qc_gate_failed = 0;
    for (const s of st) {
      if (s.status === "BLOCKED" || s.status === "QC_FAILED") {
        qc_gate_failed += parseInt(s.c, 10);
      }
    }

    rows.push({
      slug: p.slug,
      display_name: p.display_name,
      active: p.active,
      total_jobs,
      jobs_reviewed,
      ready_to_publish_rate,
      qc_gate_failed,
    });
    sumJobs += total_jobs;
    sumReviewed += jobs_reviewed;
    sumRtp += ready;
  }

  return {
    scope: "platform",
    projects: rows,
    totals: {
      projects: rows.length,
      jobs: sumJobs,
      jobs_reviewed: sumReviewed,
      ready_to_publish_count: sumRtp,
    },
  };
}
