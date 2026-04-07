/**
 * Market Learning Service — Learning Loop C.
 *
 * Ingests publishing performance data and analyzes actual audience response.
 * Compares performance across:
 * - Flow types
 * - Prompt versions
 * - Content archetypes/topics
 * - Hook patterns
 *
 * Produces LearningRules that influence future candidate scoring and generation.
 */
import type { Pool } from "pg";
import { q } from "../db/queries.js";
import { insertLearningRule } from "../repositories/learning.js";
import { insertPerformanceMetric } from "../repositories/ops.js";

export interface PerformanceIngestionInput {
  candidate_id?: string;
  task_id?: string;
  platform: string;
  posted_at: string;
  metric_date?: string;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  watch_time?: number;
  engagement_rate?: number;
  notes?: string;
}

export interface MarketInsight {
  insight_type: string;
  scope: string;
  detail: string;
  confidence: number;
  sample_size: number;
  rule_created: boolean;
  rule_id?: string;
}

export interface MarketAnalysisResult {
  project_slug: string;
  window_days: number;
  total_metrics: number;
  avg_engagement_rate: number;
  avg_saves: number;
  insights: MarketInsight[];
  rules_created: number;
}

/**
 * Ingest a batch of performance metrics from publishing results.
 */
export async function ingestPerformanceMetrics(
  db: Pool,
  projectId: string,
  metrics: PerformanceIngestionInput[],
  metricWindow: "early" | "stabilized" = "stabilized"
): Promise<{ ingested: number; errors: string[] }> {
  let ingested = 0;
  const errors: string[] = [];

  for (const m of metrics) {
    try {
      await insertPerformanceMetric(db, {
        project_id: projectId,
        candidate_id: m.candidate_id ?? null,
        task_id: m.task_id ?? null,
        platform: m.platform,
        metric_window: metricWindow,
        window_label: `${metricWindow}_${m.metric_date ?? m.posted_at}`,
        metric_date: m.metric_date ?? null,
        posted_at: m.posted_at,
        likes: m.likes ?? null,
        comments: m.comments ?? null,
        shares: m.shares ?? null,
        saves: m.saves ?? null,
        watch_time_sec: m.watch_time ?? null,
        engagement_rate: m.engagement_rate ?? null,
        raw_json: m as unknown as Record<string, unknown>,
      });
      ingested++;
    } catch (err) {
      errors.push(`${m.task_id ?? m.candidate_id ?? "unknown"}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return { ingested, errors };
}

/**
 * Analyze market performance and generate learning rules.
 */
export async function analyzeMarketPerformance(
  db: Pool,
  projectId: string,
  projectSlug: string,
  windowDays: number = 60,
  autoCreateRules: boolean = true
): Promise<MarketAnalysisResult> {

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const metrics = await q<{
    task_id: string | null; candidate_id: string | null; platform: string | null;
    saves: string | null; likes: string | null; comments: string | null;
    shares: string | null; engagement_rate: string | null;
  }>(db, `
    SELECT task_id, candidate_id, platform, saves::text, likes::text,
           comments::text, shares::text, engagement_rate::text
    FROM caf_core.performance_metrics
    WHERE project_id = $1 AND created_at >= $2 AND metric_window = 'stabilized'
    ORDER BY created_at DESC
  `, [projectId, cutoff.toISOString()]);

  if (metrics.length === 0) {
    return {
      project_slug: projectSlug,
      window_days: windowDays,
      total_metrics: 0,
      avg_engagement_rate: 0,
      avg_saves: 0,
      insights: [],
      rules_created: 0,
    };
  }

  const savesArr = metrics.map((m) => parseFloat(m.saves ?? "0")).filter((n) => !isNaN(n));
  const engArr = metrics.map((m) => parseFloat(m.engagement_rate ?? "0")).filter((n) => !isNaN(n));
  const avgSaves = savesArr.length > 0 ? savesArr.reduce((a, b) => a + b, 0) / savesArr.length : 0;
  const avgEngagement = engArr.length > 0 ? engArr.reduce((a, b) => a + b, 0) / engArr.length : 0;

  // Per-flow-type performance
  const flowPerf = await q<{
    flow_type: string; avg_saves: string; avg_eng: string; cnt: string;
  }>(db, `
    SELECT j.flow_type,
           AVG(pm.saves)::text AS avg_saves,
           AVG(pm.engagement_rate)::text AS avg_eng,
           COUNT(*)::text AS cnt
    FROM caf_core.performance_metrics pm
    JOIN caf_core.content_jobs j ON j.task_id = pm.task_id AND j.project_id = pm.project_id
    WHERE pm.project_id = $1 AND pm.created_at >= $2 AND pm.metric_window = 'stabilized'
    GROUP BY j.flow_type
    HAVING COUNT(*) >= 3
  `, [projectId, cutoff.toISOString()]);

  const insights: MarketInsight[] = [];
  let rulesCreated = 0;

  // Identify top and bottom performing flow types
  for (const row of flowPerf) {
    const flowSaves = parseFloat(row.avg_saves);
    const count = parseInt(row.cnt, 10);

    if (flowSaves > avgSaves * 1.5 && count >= 5) {
      const insight: MarketInsight = {
        insight_type: "high_performing_flow",
        scope: row.flow_type,
        detail: `Flow "${row.flow_type}" avg saves ${flowSaves.toFixed(1)} vs overall ${avgSaves.toFixed(1)} (${count} samples)`,
        confidence: Math.min(0.9, 0.5 + count * 0.04),
        sample_size: count,
        rule_created: false,
      };

      if (autoCreateRules) {
        const ruleId = `market_boost_${row.flow_type}_${Date.now()}`;
        await insertLearningRule(db, {
          rule_id: ruleId,
          project_id: projectId,
          trigger_type: "market_performance",
          scope_flow_type: row.flow_type,
          action_type: "SCORE_BOOST",
          action_payload: {
            flow_type: row.flow_type,
            boost: 0.1,
            avg_saves: flowSaves,
            overall_avg_saves: avgSaves,
            observation: insight.detail,
          },
          confidence: insight.confidence,
          source_entity_ids: [],
        });
        insight.rule_created = true;
        insight.rule_id = ruleId;
        rulesCreated++;
      }

      insights.push(insight);
    }

    if (flowSaves < avgSaves * 0.5 && count >= 5) {
      const insight: MarketInsight = {
        insight_type: "low_performing_flow",
        scope: row.flow_type,
        detail: `Flow "${row.flow_type}" avg saves ${flowSaves.toFixed(1)} vs overall ${avgSaves.toFixed(1)} (${count} samples)`,
        confidence: Math.min(0.9, 0.5 + count * 0.04),
        sample_size: count,
        rule_created: false,
      };

      if (autoCreateRules) {
        const ruleId = `market_penalty_${row.flow_type}_${Date.now()}`;
        await insertLearningRule(db, {
          rule_id: ruleId,
          project_id: projectId,
          trigger_type: "market_performance",
          scope_flow_type: row.flow_type,
          action_type: "SCORE_PENALTY",
          action_payload: {
            flow_type: row.flow_type,
            penalty: -0.1,
            avg_saves: flowSaves,
            overall_avg_saves: avgSaves,
            observation: insight.detail,
          },
          confidence: insight.confidence,
          source_entity_ids: [],
        });
        insight.rule_created = true;
        insight.rule_id = ruleId;
        rulesCreated++;
      }

      insights.push(insight);
    }
  }

  return {
    project_slug: projectSlug,
    window_days: windowDays,
    total_metrics: metrics.length,
    avg_engagement_rate: avgEngagement,
    avg_saves: avgSaves,
    insights,
    rules_created: rulesCreated,
  };
}
