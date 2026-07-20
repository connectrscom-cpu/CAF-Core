/**
 * Rule effectiveness read-back.
 *
 * Joins the write-only evidence we already collect —
 * `learning_generation_attribution` (which rules touched each generation),
 * `editorial_reviews` (human decisions), `job_outcomes` (publish anchor) and
 * `performance_metrics` (engagement) — into a per-rule scorecard vs the
 * project baseline. Read-only: no learning tables are written here.
 *
 * Coverage: generation-path rows join on task_id directly; planning-path rows
 * (migration 083) are keyed by (candidate_id, run_id) and resolve to task_ids
 * through content_jobs on the documented text-ID pattern.
 */
import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export interface AttributionOutcomeRow {
  task_id: string;
  /** jsonb array of rule ids from learning_generation_attribution. */
  applied_rule_ids: unknown;
  /** jsonb array of rule ids withheld from this task (holdout control group). */
  control_rule_ids?: unknown;
  /** 'generation' | 'planning' */
  phase?: string | null;
  /** Latest non-null editorial decision for the task, if any. */
  decision: string | null;
  /** job_outcomes.tracking_status, null when never published. */
  tracking_status: string | null;
  /** Avg engagement_rate across performance_metrics rows for the task. */
  engagement_rate: number | string | null;
}

export interface EffectivenessBaseline {
  decided_tasks: number;
  approved_tasks: number;
  approval_rate: number | null;
  avg_engagement_rate: number | null;
}

export interface RuleEffectiveness {
  rule_id: string;
  attributed_tasks: number;
  decided_tasks: number;
  approved: number;
  needs_edit: number;
  rejected: number;
  approval_rate: number | null;
  approval_delta_vs_baseline: number | null;
  published: number;
  metrics_present: number;
  analyzed: number;
  avg_engagement_rate: number | null;
  engagement_delta_vs_baseline: number | null;
  /** decided_tasks >= min threshold; below it, deltas are noise. */
  sample_sufficient: boolean;
  /** Up to 10 task ids for drill-in from the UI. */
  sample_task_ids: string[];
  /** Attribution phases seen for this rule ('generation', 'planning'). */
  phases: string[];
  /**
   * Holdout experiment readout: outcomes of tasks where this rule was
   * deliberately withheld. Present only when control attribution exists.
   * Treatment-vs-control deltas are far stronger evidence than vs-baseline.
   */
  holdout: {
    control_tasks: number;
    control_decided: number;
    control_approved: number;
    control_approval_rate: number | null;
    approval_delta_vs_control: number | null;
    control_avg_engagement_rate: number | null;
    engagement_delta_vs_control: number | null;
  } | null;
}

function toNumber(v: number | string | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/**
 * Pure aggregation: attribution rows (possibly several per task from rework
 * regenerations) → one scorecard per rule. Tasks are deduped per rule.
 */
export function aggregateRuleEffectiveness(
  rows: AttributionOutcomeRow[],
  baseline: EffectivenessBaseline,
  opts?: { min_decided?: number; sample_task_limit?: number }
): RuleEffectiveness[] {
  const minDecided = Math.max(1, opts?.min_decided ?? 5);
  const sampleLimit = Math.max(0, opts?.sample_task_limit ?? 10);

  interface TaskFacts {
    decision: string | null;
    tracking_status: string | null;
    engagement_rate: number | null;
  }
  const taskFacts = new Map<string, TaskFacts>();
  const ruleTasks = new Map<string, Set<string>>();
  const ruleControlTasks = new Map<string, Set<string>>();
  const rulePhases = new Map<string, Set<string>>();

  for (const row of rows) {
    const taskId = String(row.task_id ?? "").trim();
    if (!taskId) continue;
    if (!taskFacts.has(taskId)) {
      taskFacts.set(taskId, {
        decision: row.decision ?? null,
        tracking_status: row.tracking_status ?? null,
        engagement_rate: toNumber(row.engagement_rate),
      });
    }
    const phase = String(row.phase ?? "generation").trim() || "generation";
    const ids = Array.isArray(row.applied_rule_ids) ? row.applied_rule_ids : [];
    for (const raw of ids) {
      const ruleId = String(raw ?? "").trim();
      if (!ruleId) continue;
      let set = ruleTasks.get(ruleId);
      if (!set) {
        set = new Set<string>();
        ruleTasks.set(ruleId, set);
      }
      set.add(taskId);
      let phases = rulePhases.get(ruleId);
      if (!phases) {
        phases = new Set<string>();
        rulePhases.set(ruleId, phases);
      }
      phases.add(phase);
    }
    const controlIds = Array.isArray(row.control_rule_ids) ? row.control_rule_ids : [];
    for (const raw of controlIds) {
      const ruleId = String(raw ?? "").trim();
      if (!ruleId) continue;
      let set = ruleControlTasks.get(ruleId);
      if (!set) {
        set = new Set<string>();
        ruleControlTasks.set(ruleId, set);
      }
      set.add(taskId);
    }
  }

  const out: RuleEffectiveness[] = [];
  for (const [ruleId, tasks] of ruleTasks) {
    let approved = 0;
    let needsEdit = 0;
    let rejected = 0;
    let published = 0;
    let metricsPresent = 0;
    let analyzed = 0;
    let engagementSum = 0;
    let engagementCount = 0;
    const sampleTaskIds: string[] = [];

    for (const taskId of tasks) {
      const facts = taskFacts.get(taskId);
      if (!facts) continue;
      if (sampleTaskIds.length < sampleLimit) sampleTaskIds.push(taskId);
      switch (facts.decision) {
        case "APPROVED":
          approved += 1;
          break;
        case "NEEDS_EDIT":
          needsEdit += 1;
          break;
        case "REJECTED":
          rejected += 1;
          break;
      }
      switch (facts.tracking_status) {
        case "published":
          published += 1;
          break;
        case "metrics_present":
          metricsPresent += 1;
          break;
        case "analyzed":
          analyzed += 1;
          break;
      }
      if (facts.engagement_rate != null) {
        engagementSum += facts.engagement_rate;
        engagementCount += 1;
      }
    }

    const decided = approved + needsEdit + rejected;
    const approvalRate = decided > 0 ? round(approved / decided) : null;
    const avgEngagement = engagementCount > 0 ? round(engagementSum / engagementCount, 8) : null;

    // Holdout control aggregates (tasks where this rule was withheld).
    let holdout: RuleEffectiveness["holdout"] = null;
    const controlTasks = ruleControlTasks.get(ruleId);
    if (controlTasks && controlTasks.size > 0) {
      let cApproved = 0;
      let cDecided = 0;
      let cEngSum = 0;
      let cEngCount = 0;
      for (const taskId of controlTasks) {
        const facts = taskFacts.get(taskId);
        if (!facts) continue;
        if (facts.decision === "APPROVED") {
          cApproved += 1;
          cDecided += 1;
        } else if (facts.decision === "NEEDS_EDIT" || facts.decision === "REJECTED") {
          cDecided += 1;
        }
        if (facts.engagement_rate != null) {
          cEngSum += facts.engagement_rate;
          cEngCount += 1;
        }
      }
      const cApprovalRate = cDecided > 0 ? round(cApproved / cDecided) : null;
      const cAvgEngagement = cEngCount > 0 ? round(cEngSum / cEngCount, 8) : null;
      holdout = {
        control_tasks: controlTasks.size,
        control_decided: cDecided,
        control_approved: cApproved,
        control_approval_rate: cApprovalRate,
        approval_delta_vs_control:
          approvalRate != null && cApprovalRate != null ? round(approvalRate - cApprovalRate) : null,
        control_avg_engagement_rate: cAvgEngagement,
        engagement_delta_vs_control:
          avgEngagement != null && cAvgEngagement != null
            ? round(avgEngagement - cAvgEngagement, 8)
            : null,
      };
    }

    out.push({
      rule_id: ruleId,
      attributed_tasks: tasks.size,
      decided_tasks: decided,
      approved,
      needs_edit: needsEdit,
      rejected,
      approval_rate: approvalRate,
      approval_delta_vs_baseline:
        approvalRate != null && baseline.approval_rate != null
          ? round(approvalRate - baseline.approval_rate)
          : null,
      published,
      metrics_present: metricsPresent,
      analyzed,
      avg_engagement_rate: avgEngagement,
      engagement_delta_vs_baseline:
        avgEngagement != null && baseline.avg_engagement_rate != null
          ? round(avgEngagement - baseline.avg_engagement_rate, 8)
          : null,
      sample_sufficient: decided >= minDecided,
      sample_task_ids: sampleTaskIds,
      phases: [...(rulePhases.get(ruleId) ?? new Set(["generation"]))].sort(),
      holdout,
    });
  }

  out.sort(
    (a, b) => b.attributed_tasks - a.attributed_tasks || a.rule_id.localeCompare(b.rule_id)
  );
  return out;
}

export interface RuleEffectivenessReport {
  window_days: number;
  min_decided: number;
  baseline: EffectivenessBaseline;
  rules: Array<
    RuleEffectiveness & {
      action_type: string | null;
      rule_family: string | null;
      status: string | null;
      applied_at: string | null;
    }
  >;
}

export async function getRuleEffectivenessForProject(
  db: Pool,
  projectId: string,
  opts?: { window_days?: number; min_decided?: number }
): Promise<RuleEffectivenessReport> {
  const windowDays = Math.max(1, Math.min(365, opts?.window_days ?? 90));
  const minDecided = Math.max(1, Math.min(100, opts?.min_decided ?? 5));

  // Resolve each attribution row to task_ids: generation rows carry task_id
  // directly; planning rows (phase='planning') fan out to the content_jobs
  // planned from that candidate in that run.
  const attributionRows = await q<AttributionOutcomeRow>(
    db,
    `WITH resolved AS (
       SELECT a.applied_rule_ids, a.control_rule_ids, a.phase, a.task_id
       FROM caf_core.learning_generation_attribution a
       WHERE a.project_id = $1 AND a.phase = 'generation' AND a.task_id IS NOT NULL
         AND a.created_at >= now() - make_interval(days => $2)
       UNION ALL
       SELECT a.applied_rule_ids, a.control_rule_ids, a.phase, j.task_id
       FROM caf_core.learning_generation_attribution a
       JOIN caf_core.content_jobs j
         ON j.project_id = a.project_id
        AND j.candidate_id = a.candidate_id
        AND (a.run_id IS NULL OR j.run_id = a.run_id)
       WHERE a.project_id = $1 AND a.phase = 'planning' AND a.candidate_id IS NOT NULL
         AND a.created_at >= now() - make_interval(days => $2)
     )
     SELECT resolved.task_id,
            resolved.applied_rule_ids,
            resolved.control_rule_ids,
            resolved.phase,
            er.decision,
            o.tracking_status,
            pm.engagement_rate
     FROM resolved
     LEFT JOIN LATERAL (
       SELECT r.decision
       FROM caf_core.editorial_reviews r
       WHERE r.project_id = $1 AND r.task_id = resolved.task_id AND r.decision IS NOT NULL
       ORDER BY r.created_at DESC
       LIMIT 1
     ) er ON true
     LEFT JOIN caf_core.job_outcomes o
       ON o.project_id = $1 AND o.task_id = resolved.task_id
     LEFT JOIN LATERAL (
       SELECT AVG(m.engagement_rate)::float AS engagement_rate
       FROM caf_core.performance_metrics m
       WHERE m.project_id = $1 AND m.task_id = resolved.task_id
     ) pm ON true`,
    [projectId, windowDays]
  );

  const baselineDecisions = await q<{ decision: string; c: string }>(
    db,
    `SELECT t.decision, COUNT(*)::text AS c
     FROM (
       SELECT DISTINCT ON (task_id) task_id, decision
       FROM caf_core.editorial_reviews
       WHERE project_id = $1 AND decision IS NOT NULL
         AND created_at >= now() - make_interval(days => $2)
       ORDER BY task_id, created_at DESC
     ) t
     GROUP BY t.decision`,
    [projectId, windowDays]
  );

  const baselineEngagement = await qOne<{ avg: number | string | null }>(
    db,
    `SELECT AVG(engagement_rate)::float AS avg
     FROM caf_core.performance_metrics
     WHERE project_id = $1 AND created_at >= now() - make_interval(days => $2)`,
    [projectId, windowDays]
  );

  let decidedTasks = 0;
  let approvedTasks = 0;
  for (const row of baselineDecisions) {
    const c = parseInt(row.c, 10) || 0;
    decidedTasks += c;
    if (row.decision === "APPROVED") approvedTasks += c;
  }
  const baseline: EffectivenessBaseline = {
    decided_tasks: decidedTasks,
    approved_tasks: approvedTasks,
    approval_rate: decidedTasks > 0 ? round(approvedTasks / decidedTasks) : null,
    avg_engagement_rate: toNumber(baselineEngagement?.avg ?? null),
  };

  const stats = aggregateRuleEffectiveness(attributionRows, baseline, {
    min_decided: minDecided,
  });

  const ruleMeta = await q<{
    rule_id: string;
    action_type: string | null;
    rule_family: string | null;
    status: string | null;
    applied_at: string | null;
  }>(
    db,
    `SELECT rule_id, action_type, rule_family, status, applied_at::text
     FROM caf_core.learning_rules
     WHERE project_id = $1`,
    [projectId]
  );
  const metaById = new Map(ruleMeta.map((m) => [m.rule_id, m]));

  return {
    window_days: windowDays,
    min_decided: minDecided,
    baseline,
    rules: stats.map((s) => {
      const meta = metaById.get(s.rule_id);
      return {
        ...s,
        action_type: meta?.action_type ?? null,
        rule_family: meta?.rule_family ?? null,
        status: meta?.status ?? null,
        applied_at: meta?.applied_at ?? null,
      };
    }),
  };
}
