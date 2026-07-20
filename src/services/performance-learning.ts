/**
 * Performance Learning Service — Learning Loop C.
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
import { markJobOutcomeMetricsPresent } from "../repositories/job-outcomes.js";
import { q } from "../db/queries.js";
import { insertLearningRule } from "../repositories/learning.js";
import { insertPerformanceMetric } from "../repositories/ops.js";
import { boostFromLift, computeGroupPerformanceStats } from "./performance-stats.js";

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

export interface PerformanceInsight {
  insight_type: string;
  scope: string;
  detail: string;
  confidence: number;
  sample_size: number;
  rule_created: boolean;
  rule_id?: string;
}

export interface PerformanceAnalysisResult {
  project_slug: string;
  window_days: number;
  total_metrics: number;
  avg_engagement_rate: number;
  avg_saves: number;
  insights: PerformanceInsight[];
  rules_created: number;
}

/**
 * Ingest a batch of performance metrics from publishing results.
 */
export async function ingestPerformanceMetrics(
  db: Pool,
  projectId: string,
  metrics: PerformanceIngestionInput[],
  metricWindow: "early" | "stabilized" = "stabilized",
  ingestionBatchId?: string | null
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
        ingestion_batch_id: ingestionBatchId ?? null,
      });
      ingested++;
    } catch (err) {
      errors.push(
        `${m.task_id ?? m.candidate_id ?? "unknown"}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const taskIds = [
    ...new Set(metrics.map((m) => m.task_id?.trim()).filter((t): t is string => Boolean(t))),
  ];
  if (taskIds.length > 0) {
    await markJobOutcomeMetricsPresent(db, projectId, taskIds).catch(() => {});
  }

  return { ingested, errors };
}

/**
 * Analyze performance signals and generate learning rules.
 */
export async function analyzePerformanceAnalysis(
  db: Pool,
  projectId: string,
  projectSlug: string,
  windowDays: number = 60,
  autoCreateRules: boolean = true
): Promise<PerformanceAnalysisResult> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - windowDays);

  const metrics = await q<{
    task_id: string | null;
    candidate_id: string | null;
    platform: string | null;
    saves: string | null;
    likes: string | null;
    comments: string | null;
    shares: string | null;
    engagement_rate: string | null;
  }>(
    db,
    `
    SELECT task_id, candidate_id, platform, saves::text, likes::text,
           comments::text, shares::text, engagement_rate::text
    FROM caf_core.performance_metrics
    WHERE project_id = $1 AND created_at >= $2 AND metric_window = 'stabilized'
    ORDER BY created_at DESC
  `,
    [projectId, cutoff.toISOString()]
  );

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

  // Per-task metric joined to flow_type; engagement_rate preferred, saves fallback.
  const perTask = await q<{
    flow_type: string;
    engagement_rate: string | null;
    saves: string | null;
  }>(
    db,
    `
    SELECT j.flow_type, pm.engagement_rate::text, pm.saves::text
    FROM caf_core.performance_metrics pm
    JOIN caf_core.content_jobs j ON j.task_id = pm.task_id AND j.project_id = pm.project_id
    WHERE pm.project_id = $1 AND pm.created_at >= $2 AND pm.metric_window = 'stabilized'
  `,
    [projectId, cutoff.toISOString()]
  );

  // Prefer engagement rate when at least half the rows carry it; else saves.
  const engRows = perTask.filter((r) => r.engagement_rate != null && !isNaN(parseFloat(r.engagement_rate)));
  const useEngagement = engRows.length >= Math.max(3, perTask.length / 2);
  const metricName = useEngagement ? "engagement_rate" : "saves";
  const samples = (useEngagement ? engRows : perTask)
    .map((r) => ({
      group: r.flow_type ?? "",
      value: parseFloat((useEngagement ? r.engagement_rate : r.saves) ?? "NaN"),
    }))
    .filter((s) => Number.isFinite(s.value));

  // Empirical-Bayes shrinkage toward the project baseline (see performance-stats.ts).
  const stats = computeGroupPerformanceStats(samples, {
    priorStrength: 5,
    minSamples: 5,
    liftThreshold: 0.25,
  });

  const insights: PerformanceInsight[] = [];
  let rulesCreated = 0;

  for (const g of stats.groups) {
    if (!g.significant) continue;
    const direction = g.lift > 0 ? "high_performing_flow" : "low_performing_flow";
    const insight: PerformanceInsight = {
      insight_type: direction,
      scope: g.group,
      detail: `Flow "${g.group}" ${metricName} shrunk mean ${g.shrunk_mean} vs baseline ${stats.baseline} (lift ${(g.lift * 100).toFixed(0)}%, ${g.n} samples, raw mean ${g.raw_mean})`,
      confidence: Math.min(0.9, 0.5 + g.n * 0.04),
      sample_size: g.n,
      rule_created: false,
    };

    if (autoCreateRules) {
      const magnitude = boostFromLift(g.lift);
      const isBoost = magnitude > 0;
      const ruleId = `performance_${isBoost ? "boost" : "penalty"}_${g.group}_${Date.now()}`;
      await insertLearningRule(db, {
        rule_id: ruleId,
        project_id: projectId,
        trigger_type: "performance_analysis",
        scope_flow_type: g.group,
        action_type: isBoost ? "SCORE_BOOST" : "SCORE_PENALTY",
        action_payload: {
          flow_type: g.group,
          ...(isBoost ? { boost: magnitude } : { penalty: magnitude }),
          metric: metricName,
          lift: g.lift,
          shrunk_mean: g.shrunk_mean,
          raw_mean: g.raw_mean,
          baseline: stats.baseline,
          sample_size: g.n,
          observation: insight.detail,
        },
        confidence: insight.confidence,
        source_entity_ids: [],
        evidence_refs: [`performance_flow:${g.group}`],
        rule_family: "ranking",
        provenance: "performance_analysis",
      });
      insight.rule_created = true;
      insight.rule_id = ruleId;
      rulesCreated++;
    }

    insights.push(insight);
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

