/**
 * Manual CAF Global learning digest — observatory only (no pipeline effect).
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";
import { getGlobalLearningProjectId } from "../repositories/learning-global.js";
import { emitGlobalLearningObservation } from "./global-learning-observe.js";

export interface GlobalLearningDigest {
  digest_id: string;
  window_days: number;
  captured_at: string;
  editorial_summary: Record<string, unknown>;
  llm_review_summary: Record<string, unknown>;
  nemotron_summary: Record<string, unknown>;
  performance_summary: Record<string, unknown>;
}

export async function buildGlobalLearningDigest(
  db: Pool,
  windowDays: number = 30
): Promise<GlobalLearningDigest | null> {
  const globalId = await getGlobalLearningProjectId(db);
  if (!globalId) return null;

  const editorial = await q<{ decision: string; cnt: string }>(
    db,
    `SELECT er.decision, COUNT(*)::text AS cnt
     FROM caf_core.editorial_reviews er
     WHERE er.created_at >= now() - make_interval(days => $1)
       AND er.decision IS NOT NULL AND er.submit = true
     GROUP BY er.decision`,
    [windowDays]
  );

  const tagRows = await q<{ tag: string; cnt: string }>(
    db,
    `SELECT tag, COUNT(*)::text AS cnt FROM (
       SELECT jsonb_array_elements_text(COALESCE(er.rejection_tags, '[]'::jsonb)) AS tag
       FROM caf_core.editorial_reviews er
       WHERE er.created_at >= now() - make_interval(days => $1)
     ) t GROUP BY tag ORDER BY COUNT(*) DESC LIMIT 15`,
    [windowDays]
  );

  const llmScores = await qOne<{ avg: string; cnt: string }>(
    db,
    `SELECT AVG(overall_score)::text AS avg, COUNT(*)::text AS cnt
     FROM caf_core.llm_approval_reviews
     WHERE created_at >= now() - make_interval(days => $1)`,
    [windowDays]
  );

  const formatPatterns = await q<{ fp: string; cnt: string }>(
    db,
    `SELECT COALESCE(output_insights_json->>'format_pattern', 'unknown') AS fp, COUNT(*)::text AS cnt
     FROM caf_core.llm_approval_reviews
     WHERE created_at >= now() - make_interval(days => $1)
     GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 12`,
    [windowDays]
  );

  const perf = await qOne<{ metrics: string; avg_saves: string }>(
    db,
    `SELECT COUNT(*)::text AS metrics, COALESCE(AVG(saves), 0)::text AS avg_saves
     FROM caf_core.performance_metrics
     WHERE created_at >= now() - make_interval(days => $1) AND metric_window = 'stabilized'`,
    [windowDays]
  );

  const digestId = `digest_${new Date().toISOString().slice(0, 10)}_${randomUUID().slice(0, 8)}`;
  const capturedAt = new Date().toISOString();

  const digest: GlobalLearningDigest = {
    digest_id: digestId,
    window_days: windowDays,
    captured_at: capturedAt,
    editorial_summary: {
      decisions: editorial.map((r) => ({ decision: r.decision, count: parseInt(r.cnt, 10) })),
      top_rejection_tags: tagRows.map((r) => ({ tag: r.tag, count: parseInt(r.cnt, 10) })),
    },
    llm_review_summary: {
      review_count: llmScores ? parseInt(llmScores.cnt, 10) : 0,
      avg_overall_score: llmScores ? parseFloat(llmScores.avg) : null,
      format_pattern_distribution: formatPatterns.map((r) => ({
        format_pattern: r.fp,
        count: parseInt(r.cnt, 10),
      })),
    },
    nemotron_summary: {
      note: "Aggregated from llm_approval_reviews.output_insights_json (generated-output Nemotron analysis).",
      format_pattern_distribution: formatPatterns.map((r) => ({
        format_pattern: r.fp,
        count: parseInt(r.cnt, 10),
      })),
    },
    performance_summary: {
      metric_rows: perf ? parseInt(perf.metrics, 10) : 0,
      avg_saves: perf ? parseFloat(perf.avg_saves) : 0,
    },
  };

  await emitGlobalLearningObservation(db, {
    observation_id: digestId,
    source_type: "global_learning_digest",
    observation_type: "global_learning_digest",
    payload_json: digest as unknown as Record<string, unknown>,
    confidence: 0.85,
  });

  return digest;
}

export async function getLatestGlobalLearningDigest(
  db: Pool
): Promise<Record<string, unknown> | null> {
  const globalId = await getGlobalLearningProjectId(db);
  if (!globalId) return null;
  const row = await qOne<{ payload_json: Record<string, unknown> }>(
    db,
    `SELECT payload_json FROM caf_core.learning_observations
     WHERE project_id = $1 AND source_type = 'global_learning_digest'
     ORDER BY observed_at DESC LIMIT 1`,
    [globalId]
  );
  return row?.payload_json ?? null;
}
