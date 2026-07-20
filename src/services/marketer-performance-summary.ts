/**
 * Marketer-facing "Performance & learning" summary.
 *
 * One read-only aggregate powering the brand performance page in the Review
 * app: editorial funnel (what you approved/rejected), published-post
 * engagement by format (what worked), what CAF learned (rules), and
 * suggestions for the next cycle (rule lifecycle advisor + format lifts).
 *
 * Honesty rules: every section carries explicit sample counts and the response
 * flags which evidence is missing instead of pretending. No LLM calls, no
 * writes.
 */
import type { Pool } from "pg";
import { q } from "../db/queries.js";
import { computeGroupPerformanceStats } from "./performance-stats.js";
import {
  getRuleLifecycleSuggestionsForProject,
  type RuleLifecycleSuggestion,
} from "./learning-rule-lifecycle.js";

export interface FlowDecisionStats {
  flow_type: string;
  decided: number;
  approved: number;
  needs_edit: number;
  rejected: number;
  approval_rate: number;
}

export interface FormatPerformance {
  flow_type: string;
  posts_with_metrics: number;
  avg_engagement_rate: number;
  /** Shrunk lift vs project baseline; only trust when significant. */
  lift: number;
  significant: boolean;
  direction: "increase" | "decrease" | "neutral";
}

export interface LearnedRuleSummary {
  rule_id: string;
  status: string;
  action_type: string;
  rule_family: string | null;
  scope_flow_type: string | null;
  scope_platform: string | null;
  provenance: string | null;
  /** Short human-readable description of what the rule does. */
  headline: string;
  created_at: string;
}

export interface MarketerPerformanceSummary {
  window_days: number;
  editorial: {
    decided_tasks: number;
    approved: number;
    needs_edit: number;
    rejected: number;
    approval_rate: number | null;
    by_flow: FlowDecisionStats[];
  };
  performance: {
    posts_with_metrics: number;
    avg_engagement_rate: number | null;
    baseline_engagement_rate: number | null;
    by_format: FormatPerformance[];
  };
  learning: {
    active_rules: number;
    pending_rules: number;
    recent_rules: LearnedRuleSummary[];
  };
  suggestions: RuleLifecycleSuggestion[];
  /** Which evidence sources have data — the UI uses this for honest empty states. */
  evidence: {
    has_reviews: boolean;
    has_metrics: boolean;
    has_rules: boolean;
  };
}

function round(v: number, places = 4): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

/** Best-effort one-liner for a rule from its action payload. */
export function ruleHeadline(
  actionType: string,
  payload: Record<string, unknown> | null
): string {
  const p = payload ?? {};
  const text =
    typeof p.instruction === "string" && p.instruction.trim()
      ? p.instruction.trim()
      : typeof p.guidance === "string" && p.guidance.trim()
        ? p.guidance.trim()
        : typeof p.observation === "string" && p.observation.trim()
          ? p.observation.trim()
          : "";
  if (text) return text.length > 180 ? `${text.slice(0, 177)}...` : text;
  if (actionType === "SCORE_BOOST" && typeof p.flow_type === "string") {
    return `Prioritize ${p.flow_type} in planning`;
  }
  if (actionType === "SCORE_PENALTY" && typeof p.flow_type === "string") {
    return `De-prioritize ${p.flow_type} in planning`;
  }
  return actionType.replaceAll("_", " ").toLowerCase();
}

export async function getMarketerPerformanceSummary(
  db: Pool,
  projectId: string,
  opts?: { window_days?: number }
): Promise<MarketerPerformanceSummary> {
  const windowDays = Math.max(1, Math.min(365, opts?.window_days ?? 60));

  // ── Editorial funnel: latest decision per task in the window ──────────
  const decisionRows = await q<{ flow_type: string | null; decision: string; c: string }>(
    db,
    `SELECT j.flow_type, t.decision, COUNT(*)::text AS c
     FROM (
       SELECT DISTINCT ON (task_id) task_id, decision
       FROM caf_core.editorial_reviews
       WHERE project_id = $1 AND decision IS NOT NULL
         AND created_at >= now() - make_interval(days => $2)
       ORDER BY task_id, created_at DESC
     ) t
     LEFT JOIN caf_core.content_jobs j
       ON j.project_id = $1 AND j.task_id = t.task_id
     GROUP BY j.flow_type, t.decision`,
    [projectId, windowDays]
  );

  const byFlow = new Map<string, FlowDecisionStats>();
  let approved = 0;
  let needsEdit = 0;
  let rejected = 0;
  for (const row of decisionRows) {
    const c = parseInt(row.c, 10) || 0;
    const flow = (row.flow_type ?? "unknown").trim() || "unknown";
    let s = byFlow.get(flow);
    if (!s) {
      s = { flow_type: flow, decided: 0, approved: 0, needs_edit: 0, rejected: 0, approval_rate: 0 };
      byFlow.set(flow, s);
    }
    s.decided += c;
    if (row.decision === "APPROVED") {
      s.approved += c;
      approved += c;
    } else if (row.decision === "NEEDS_EDIT") {
      s.needs_edit += c;
      needsEdit += c;
    } else if (row.decision === "REJECTED") {
      s.rejected += c;
      rejected += c;
    }
  }
  const flowStats = [...byFlow.values()]
    .map((s) => ({ ...s, approval_rate: s.decided > 0 ? round(s.approved / s.decided) : 0 }))
    .sort((a, b) => b.decided - a.decided);
  const decidedTasks = approved + needsEdit + rejected;

  // ── Published performance by format (shrunk lift vs baseline) ─────────
  const metricRows = await q<{ flow_type: string | null; engagement_rate: string | null }>(
    db,
    `SELECT j.flow_type, pm.engagement_rate::text
     FROM caf_core.performance_metrics pm
     LEFT JOIN caf_core.content_jobs j
       ON j.project_id = pm.project_id AND j.task_id = pm.task_id
     WHERE pm.project_id = $1
       AND pm.engagement_rate IS NOT NULL
       AND pm.created_at >= now() - make_interval(days => $2)`,
    [projectId, windowDays]
  );
  const samples = metricRows
    .map((r) => ({
      group: (r.flow_type ?? "unknown").trim() || "unknown",
      value: parseFloat(r.engagement_rate ?? "NaN"),
    }))
    .filter((s) => Number.isFinite(s.value));
  const stats = computeGroupPerformanceStats(samples, {
    priorStrength: 5,
    minSamples: 3,
    liftThreshold: 0.2,
  });
  const byFormat: FormatPerformance[] = stats.groups.map((g) => ({
    flow_type: g.group,
    posts_with_metrics: g.n,
    avg_engagement_rate: g.raw_mean,
    lift: g.lift,
    significant: g.significant,
    direction: g.significant ? (g.lift > 0 ? "increase" : "decrease") : "neutral",
  }));

  // ── What CAF learned: rule counts + recent rules ───────────────────────
  const ruleCountRows = await q<{ status: string; c: string }>(
    db,
    `SELECT status, COUNT(*)::text AS c FROM caf_core.learning_rules
     WHERE project_id = $1 GROUP BY status`,
    [projectId]
  );
  let activeRules = 0;
  let pendingRules = 0;
  for (const r of ruleCountRows) {
    const c = parseInt(r.c, 10) || 0;
    if (r.status === "active") activeRules = c;
    else if (r.status === "pending") pendingRules = c;
  }

  const recentRuleRows = await q<{
    rule_id: string;
    status: string;
    action_type: string;
    rule_family: string | null;
    scope_flow_type: string | null;
    scope_platform: string | null;
    provenance: string | null;
    action_payload: Record<string, unknown> | null;
    created_at: string;
  }>(
    db,
    `SELECT rule_id, status, action_type, rule_family, scope_flow_type, scope_platform,
            provenance, action_payload, created_at::text
     FROM caf_core.learning_rules
     WHERE project_id = $1 AND status IN ('active', 'pending')
     ORDER BY created_at DESC
     LIMIT 12`,
    [projectId]
  );
  const recentRules: LearnedRuleSummary[] = recentRuleRows.map((r) => ({
    rule_id: r.rule_id,
    status: r.status,
    action_type: r.action_type,
    rule_family: r.rule_family,
    scope_flow_type: r.scope_flow_type,
    scope_platform: r.scope_platform,
    provenance: r.provenance,
    headline: ruleHeadline(r.action_type, r.action_payload),
    created_at: r.created_at,
  }));

  // ── Next-cycle suggestions (rule lifecycle advisor) ────────────────────
  let suggestions: RuleLifecycleSuggestion[] = [];
  try {
    const lifecycle = await getRuleLifecycleSuggestionsForProject(db, projectId, {
      window_days: windowDays,
    });
    // Marketers only need actionable calls, not raw "needs more data" noise.
    suggestions = lifecycle.suggestions
      .filter((s) => s.suggestion !== "needs_more_data")
      .slice(0, 8);
  } catch {
    suggestions = [];
  }

  return {
    window_days: windowDays,
    editorial: {
      decided_tasks: decidedTasks,
      approved,
      needs_edit: needsEdit,
      rejected,
      approval_rate: decidedTasks > 0 ? round(approved / decidedTasks) : null,
      by_flow: flowStats,
    },
    performance: {
      posts_with_metrics: stats.total_samples,
      avg_engagement_rate: stats.total_samples > 0 ? stats.baseline : null,
      baseline_engagement_rate: stats.total_samples > 0 ? stats.baseline : null,
      by_format: byFormat,
    },
    learning: {
      active_rules: activeRules,
      pending_rules: pendingRules,
      recent_rules: recentRules,
    },
    suggestions,
    evidence: {
      has_reviews: decidedTasks > 0,
      has_metrics: stats.total_samples > 0,
      has_rules: activeRules + pendingRules > 0,
    },
  };
}
