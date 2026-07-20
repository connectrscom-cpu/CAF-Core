/**
 * Performance learning entry point — manual trigger today; event hooks stubbed for later.
 */
import type { Pool } from "pg";
import { randomUUID } from "node:crypto";
import { q } from "../db/queries.js";
import { markJobOutcomesAnalyzed } from "../repositories/job-outcomes.js";
import {
  analyzePerformanceAnalysis,
  type PerformanceAnalysisResult,
} from "./performance-learning.js";
import {
  synthesizePerformanceDriversWithLlm,
  type PerformanceDriverResult,
} from "./performance-driver-synthesis.js";
import type { AppConfig } from "../config.js";
import { emitGlobalLearningObservation } from "./global-learning-observe.js";

export type PerformanceLearningTrigger = "manual" | "metric_ingest" | "outcome_stabilized";

export interface PerformanceLearningOpts {
  trigger?: PerformanceLearningTrigger;
  window_days?: number;
  auto_create_rules?: boolean;
  emit_global_observation?: boolean;
  /** Run the OpenAI content-feature contrast (top vs bottom performers). Needs config. */
  run_llm_synthesis?: boolean;
  /** Mint pending GENERATION_GUIDANCE rules from LLM recommended guidance (max 3). */
  mint_llm_guidance_rules?: boolean;
  /** Required when run_llm_synthesis is true. */
  config?: AppConfig;
}

export interface PerformanceLearningRunResult extends PerformanceAnalysisResult {
  trigger: PerformanceLearningTrigger;
  global_observation_emitted: boolean;
  llm_driver_synthesis?: PerformanceDriverResult | null;
}

export async function runPerformanceLearning(
  db: Pool,
  projectId: string,
  projectSlug: string,
  opts?: PerformanceLearningOpts
): Promise<PerformanceLearningRunResult> {
  const trigger = opts?.trigger ?? "manual";
  const windowDays = opts?.window_days ?? 60;
  const autoCreate = opts?.auto_create_rules === true;
  const emitGlobal = opts?.emit_global_observation !== false;

  const result = await analyzePerformanceAnalysis(
    db,
    projectId,
    projectSlug,
    windowDays,
    autoCreate
  );

  let llmDriverSynthesis: PerformanceDriverResult | null = null;
  if (opts?.run_llm_synthesis && opts.config) {
    llmDriverSynthesis = await synthesizePerformanceDriversWithLlm(db, opts.config, projectId, projectSlug, {
      windowDays,
      mint_pending_rules: opts.mint_llm_guidance_rules === true,
    });
  }

  let globalEmitted = false;
  if (emitGlobal) {
    const sampleTaskIds = await q<{ task_id: string | null }>(
      db,
      `SELECT DISTINCT pm.task_id
       FROM caf_core.performance_metrics pm
       WHERE pm.project_id = $1::uuid
         AND pm.created_at >= now() - make_interval(days => $2)
         AND pm.metric_window = 'stabilized'
         AND pm.task_id IS NOT NULL
       ORDER BY pm.task_id
       LIMIT 20`,
      [projectId, windowDays]
    );
    globalEmitted = await emitGlobalLearningObservation(db, {
      source_type: "performance_outcome_global",
      observation_type: "performance_analysis_run",
      entity_ref: projectSlug,
      payload_json: {
        project_slug: projectSlug,
        window_days: windowDays,
        trigger,
        auto_create_rules: autoCreate,
        total_metrics: result.total_metrics,
        avg_engagement_rate: result.avg_engagement_rate,
        avg_saves: result.avg_saves,
        rules_created: result.rules_created,
        insights: result.insights,
        sample_task_ids: sampleTaskIds.map((r) => r.task_id).filter(Boolean),
      },
      confidence: result.total_metrics > 0 ? 0.7 : 0.3,
      observation_id: `perf_global_${projectSlug}_${Date.now()}`,
    });
  }

  if (result.total_metrics > 0) {
    const taskRows = await q<{ task_id: string | null }>(
      db,
      `SELECT DISTINCT task_id FROM caf_core.performance_metrics
       WHERE project_id = $1::uuid AND created_at >= now() - make_interval(days => $2)
         AND task_id IS NOT NULL`,
      [projectId, windowDays]
    );
    const tids = taskRows.map((r) => r.task_id).filter((t): t is string => Boolean(t));
    if (tids.length > 0) {
      await markJobOutcomesAnalyzed(db, projectId, tids).catch(() => {});
    }
  }

  return {
    ...result,
    trigger,
    global_observation_emitted: globalEmitted,
    llm_driver_synthesis: llmDriverSynthesis,
  };
}

/** Groundwork for future event-driven analysis — not wired to ingest yet. */
export async function onPerformanceMetricsIngested(
  _db: Pool,
  _projectId: string,
  _opts?: { ingestion_batch_id?: string }
): Promise<void> {
  // Phase 4: debounce and call runPerformanceLearning with trigger: "metric_ingest"
}

export function newPerformanceAnalysisObservationId(projectSlug: string): string {
  return `perf_run_${projectSlug}_${randomUUID().replace(/-/g, "").slice(0, 10)}`;
}
