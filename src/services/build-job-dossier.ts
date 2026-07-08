/**
 * Full job journey dossier: evidence → plan → generate → review → publish → performance.
 */
import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";
import { getJobLineageByTaskId } from "../repositories/job-lineage.js";
import { getJobOutcomeByTaskId } from "../repositories/job-outcomes.js";
import { pickStoredQcResult } from "../domain/generation-payload-qc.js";

export interface JobDossier {
  task_id: string;
  project_id: string;
  upstream: Awaited<ReturnType<typeof getJobLineageByTaskId>>;
  planning: Record<string, unknown> | null;
  generation: Record<string, unknown> | null;
  render: Record<string, unknown> | null;
  nemotron_output: Record<string, unknown> | null;
  editorial: Record<string, unknown>[];
  llm_review: Record<string, unknown>[];
  publish: Record<string, unknown> | null;
  performance: Record<string, unknown> | null;
  refs: Array<{ table: string; id: string }>;
}

export async function buildJobDossier(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<JobDossier | null> {
  const tid = taskId.trim();
  const upstream = await getJobLineageByTaskId(db, projectId, tid);
  if (!upstream) return null;

  const job = await qOne<{
    generation_payload: Record<string, unknown>;
    run_id: string | null;
    status: string | null;
  }>(
    db,
    `SELECT generation_payload, run_id, status FROM caf_core.content_jobs
     WHERE project_id = $1::uuid AND task_id = $2`,
    [projectId, tid]
  );
  if (!job) return null;

  const gp = job.generation_payload ?? {};
  const refs: JobDossier["refs"] = [{ table: "content_jobs", id: tid }];

  let planning: Record<string, unknown> | null = null;
  if (job.run_id) {
    const run = await qOne<{ context_snapshot_json: Record<string, unknown> | null }>(
      db,
      `SELECT context_snapshot_json FROM caf_core.runs
       WHERE project_id = $1::uuid AND run_id = $2`,
      [projectId, job.run_id]
    );
    if (run?.context_snapshot_json) {
      planning = { context_snapshot: run.context_snapshot_json };
      refs.push({ table: "runs", id: job.run_id });
    }
    const trace = await qOne<{ trace_id: string; output_snapshot: Record<string, unknown> }>(
      db,
      `SELECT trace_id, output_snapshot FROM caf_core.decision_traces
       WHERE project_id = $1::uuid AND run_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [projectId, job.run_id]
    );
    if (trace) {
      planning = { ...(planning ?? {}), trace_id: trace.trace_id, output_snapshot: trace.output_snapshot };
    }
  }

  const draft = await qOne<{ draft_id: string; prompt_name: string | null; created_at: string }>(
    db,
    `SELECT draft_id, prompt_name, created_at::text FROM caf_core.job_drafts
     WHERE project_id = $1::uuid AND task_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [projectId, tid]
  );

  const attribution = await qOne<{ applied_rule_ids: unknown; created_at: string }>(
    db,
    `SELECT applied_rule_ids, created_at::text FROM caf_core.learning_generation_attribution
     WHERE project_id = $1::uuid AND task_id = $2
     ORDER BY created_at DESC LIMIT 1`,
    [projectId, tid]
  );

  const generation: Record<string, unknown> = {
    job_status: job.status,
    qc_result: pickStoredQcResult(gp),
    latest_draft: draft,
    learning_attribution: attribution,
  };

  const assets = await q<{ asset_id: string; asset_type: string | null; public_url: string | null }>(
    db,
    `SELECT asset_id, asset_type, public_url FROM caf_core.assets
     WHERE project_id = $1::uuid AND task_id = $2 ORDER BY created_at`,
    [projectId, tid]
  );

  const render: Record<string, unknown> = {
    assets,
    publication_results: gp.publication_results ?? null,
  };

  const editorial = await q<Record<string, unknown>>(
    db,
    `SELECT id::text, decision, rejection_tags, notes, overrides_json, created_at::text
     FROM caf_core.editorial_reviews
     WHERE project_id = $1::uuid AND task_id = $2
     ORDER BY created_at DESC`,
    [projectId, tid]
  );

  const llmReview = await q<Record<string, unknown>>(
    db,
    `SELECT review_id, model, overall_score, summary, output_insights_json,
            strengths, weaknesses, improvement_bullets, created_at::text
     FROM caf_core.llm_approval_reviews
     WHERE project_id = $1::uuid AND task_id = $2
     ORDER BY created_at DESC`,
    [projectId, tid]
  );

  const placements = await q<Record<string, unknown>>(
    db,
    `SELECT id::text, status, platform, platform_post_id, posted_url, published_at::text
     FROM caf_core.publication_placements
     WHERE project_id = $1::uuid AND task_id = $2
     ORDER BY created_at DESC`,
    [projectId, tid]
  );

  const metrics = await q<Record<string, unknown>>(
    db,
    `SELECT metric_window, saves::text, engagement_rate::text, posted_at::text, created_at::text
     FROM caf_core.performance_metrics
     WHERE project_id = $1::uuid AND task_id = $2
     ORDER BY created_at DESC`,
    [projectId, tid]
  );

  const outcome = await getJobOutcomeByTaskId(db, projectId, tid);

  return {
    task_id: tid,
    project_id: projectId,
    upstream,
    planning,
    generation,
    render,
    nemotron_output: llmReview[0]?.output_insights_json as Record<string, unknown> | null ?? null,
    editorial,
    llm_review: llmReview,
    publish: {
      placements,
      publication_results: gp.publication_results ?? null,
      job_outcome: outcome,
    },
    performance: {
      metrics,
      job_outcome: outcome,
    },
    refs,
  };
}
