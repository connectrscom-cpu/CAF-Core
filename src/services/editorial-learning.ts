/**
 * Editorial Learning Service — Learning Loop B.
 *
 * Analyzes editorial review patterns to detect:
 * - Frequent rejection reasons
 * - Recurring edits to hooks/captions
 * - Flow types with low approval
 * - Platform-specific failure patterns
 * - Prompt versions associated with more overrides
 *
 * Produces LearningRules that influence future generation.
 */
import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";
import { insertLearningRule } from "../repositories/learning.js";

export interface EditorialInsight {
  insight_type: string;
  scope: string;
  detail: string;
  confidence: number;
  sample_size: number;
  rule_created: boolean;
  rule_id?: string;
}

export interface EditorialAnalysisResult {
  project_slug: string;
  window_days: number;
  total_reviews: number;
  approval_rate: number;
  rejection_rate: number;
  needs_edit_rate: number;
  top_rejection_tags: Array<{ tag: string; count: number }>;
  insights: EditorialInsight[];
  rules_created: number;
}

/**
 * Analyze editorial review history for a project and generate learning rules.
 */
export async function analyzeEditorialPatterns(
  db: Pool,
  projectId: string,
  projectSlug: string,
  windowDays: number = 30,
  autoCreateRules: boolean = true
): Promise<EditorialAnalysisResult> {

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const reviews = await q<{
    task_id: string; decision: string | null;
    rejection_tags: unknown[]; notes: string | null;
    overrides_json: Record<string, unknown>;
    created_at: string;
  }>(db, `
    SELECT task_id, decision, rejection_tags, notes, overrides_json, created_at
    FROM caf_core.editorial_reviews
    WHERE project_id = $1 AND created_at >= $2
    ORDER BY created_at DESC
  `, [projectId, cutoff.toISOString()]);

  if (reviews.length === 0) {
    return {
      project_slug: projectSlug,
      window_days: windowDays,
      total_reviews: 0,
      approval_rate: 0,
      rejection_rate: 0,
      needs_edit_rate: 0,
      top_rejection_tags: [],
      insights: [],
      rules_created: 0,
    };
  }

  const total = reviews.length;
  const approved = reviews.filter((r) => r.decision === "APPROVED").length;
  const rejected = reviews.filter((r) => r.decision === "REJECTED").length;
  const needsEdit = reviews.filter((r) => r.decision === "NEEDS_EDIT").length;

  // Aggregate rejection tags
  const tagCounts = new Map<string, number>();
  for (const review of reviews) {
    const tags = review.rejection_tags;
    if (Array.isArray(tags)) {
      for (const tag of tags) {
        const t = String(tag);
        tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
      }
    }
  }

  const topTags = Array.from(tagCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([tag, count]) => ({ tag, count }));

  // Aggregate override patterns
  const overrideFields = new Map<string, number>();
  for (const review of reviews) {
    const overrides = review.overrides_json;
    if (overrides && typeof overrides === "object") {
      for (const key of Object.keys(overrides)) {
        if (overrides[key] != null && overrides[key] !== "") {
          overrideFields.set(key, (overrideFields.get(key) ?? 0) + 1);
        }
      }
    }
  }

  // Per-flow-type approval rates
  const flowReviews = await q<{ flow_type: string; decision: string; cnt: string }>(db, `
    SELECT j.flow_type, er.decision, COUNT(*)::text AS cnt
    FROM caf_core.editorial_reviews er
    JOIN caf_core.content_jobs j ON j.task_id = er.task_id AND j.project_id = er.project_id
    WHERE er.project_id = $1 AND er.created_at >= $2 AND er.decision IS NOT NULL
    GROUP BY j.flow_type, er.decision
  `, [projectId, cutoff.toISOString()]);

  const flowStats = new Map<string, { approved: number; rejected: number; needs_edit: number; total: number }>();
  for (const row of flowReviews) {
    const stats = flowStats.get(row.flow_type) ?? { approved: 0, rejected: 0, needs_edit: 0, total: 0 };
    const count = parseInt(row.cnt, 10);
    stats.total += count;
    if (row.decision === "APPROVED") stats.approved += count;
    else if (row.decision === "REJECTED") stats.rejected += count;
    else if (row.decision === "NEEDS_EDIT") stats.needs_edit += count;
    flowStats.set(row.flow_type, stats);
  }

  const insights: EditorialInsight[] = [];
  let rulesCreated = 0;

  // Insight: high rejection tags
  for (const { tag, count } of topTags) {
    if (count >= 3 && count / total >= 0.15) {
      const insight: EditorialInsight = {
        insight_type: "frequent_rejection_tag",
        scope: tag,
        detail: `Tag "${tag}" appears in ${count}/${total} reviews (${(count / total * 100).toFixed(0)}%)`,
        confidence: Math.min(0.95, count / total + 0.3),
        sample_size: count,
        rule_created: false,
      };

      if (autoCreateRules) {
        const ruleId = `editorial_tag_${tag.replace(/[^a-zA-Z0-9]/g, "_").toLowerCase()}_${Date.now()}`;
        const tagTaskIds = reviews
          .filter((r) => Array.isArray(r.rejection_tags) && r.rejection_tags.includes(tag))
          .map((r) => r.task_id);
        await insertLearningRule(db, {
          rule_id: ruleId,
          project_id: projectId,
          trigger_type: "editorial_rejection_pattern",
          action_type: "SCORE_PENALTY",
          action_payload: {
            rejection_tag: tag,
            penalty: -0.15,
            window_days: windowDays,
            observation: insight.detail,
          },
          confidence: insight.confidence,
          source_entity_ids: tagTaskIds,
          evidence_refs: tagTaskIds,
          rule_family: "ranking",
          provenance: "editorial_analysis",
        });
        insight.rule_created = true;
        insight.rule_id = ruleId;
        rulesCreated++;
      }

      insights.push(insight);
    }
  }

  // Insight: flow types with low approval
  for (const [flowType, stats] of flowStats) {
    if (stats.total >= 5) {
      const approvalRate = stats.approved / stats.total;
      if (approvalRate < 0.5) {
        const insight: EditorialInsight = {
          insight_type: "low_approval_flow",
          scope: flowType,
          detail: `Flow "${flowType}" has ${(approvalRate * 100).toFixed(0)}% approval (${stats.approved}/${stats.total})`,
          confidence: Math.min(0.9, 0.4 + stats.total * 0.05),
          sample_size: stats.total,
          rule_created: false,
        };

        if (autoCreateRules && approvalRate < 0.3) {
          const ruleId = `editorial_low_approval_${flowType}_${Date.now()}`;
          await insertLearningRule(db, {
            rule_id: ruleId,
            project_id: projectId,
            trigger_type: "editorial_low_approval",
            scope_flow_type: flowType,
            action_type: "REDUCE_VOLUME",
            action_payload: {
              flow_type: flowType,
              approval_rate: approvalRate,
              recommendation: "reduce volume or switch prompt version",
              observation: insight.detail,
            },
            confidence: insight.confidence,
            source_entity_ids: [],
            evidence_refs: [`flow_stats:${flowType}:${windowDays}d`],
            rule_family: "suppression",
            provenance: "editorial_analysis",
          });
          insight.rule_created = true;
          insight.rule_id = ruleId;
          rulesCreated++;
        }

        insights.push(insight);
      }
    }
  }

  // Insight: frequently overridden fields
  for (const [field, count] of overrideFields) {
    if (count >= 3 && count / total >= 0.2) {
      insights.push({
        insight_type: "frequent_override_field",
        scope: field,
        detail: `Field "${field}" is overridden in ${count}/${total} reviews (${(count / total * 100).toFixed(0)}%)`,
        confidence: Math.min(0.85, count / total + 0.2),
        sample_size: count,
        rule_created: false,
      });
    }
  }

  return {
    project_slug: projectSlug,
    window_days: windowDays,
    total_reviews: total,
    approval_rate: approved / total,
    rejection_rate: rejected / total,
    needs_edit_rate: needsEdit / total,
    top_rejection_tags: topTags,
    insights,
    rules_created: rulesCreated,
  };
}
