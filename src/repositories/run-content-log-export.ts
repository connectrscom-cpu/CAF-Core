import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";
import type { RunRow } from "./runs.js";
import type { SignalPackRow } from "./signal-packs.js";
import { listRunContentOutcomes, type RunContentOutcomeRow } from "./run-content-outcomes.js";
import { qcDetailFromGenerationPayload } from "../services/qc-runtime.js";
import { buildJobContentPreview } from "../services/content-transparency-preview.js";

type JsonRec = Record<string, unknown>;

function asRec(v: unknown): JsonRec | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRec) : null;
}

function strVal(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function groupByTaskId(rows: JsonRec[]): Map<string, JsonRec[]> {
  const m = new Map<string, JsonRec[]>();
  for (const r of rows) {
    const tid = strVal(r.task_id).trim();
    if (!tid) continue;
    const arr = m.get(tid) ?? [];
    arr.push(r);
    m.set(tid, arr);
  }
  return m;
}

function pickStageSnapshots(jobRow: JsonRec): {
  generation_payload: JsonRec | null;
  render_state: JsonRec | null;
  scene_bundle_state: JsonRec | null;
  review_snapshot: JsonRec | null;
  qc_result: JsonRec | null;
} {
  const gp = asRec(jobRow.generation_payload) ?? null;
  const rs = asRec(jobRow.render_state) ?? null;
  const sb = asRec(jobRow.scene_bundle_state) ?? null;
  const review = asRec(jobRow.review_snapshot) ?? null;
  const qc = gp ? (asRec((gp as any).qc_result) ?? null) : null;
  return { generation_payload: gp, render_state: rs, scene_bundle_state: sb, review_snapshot: review, qc_result: qc };
}

export interface RunContentLogExportJob {
  task_id: string;
  flow_type: string;
  platform: string;
  status: string;
  qc_status: string;
  /** Full content_jobs row (source of truth). */
  content_job: JsonRec;
  /** Helpful stage slices for debugging / inspection. */
  stage: ReturnType<typeof pickStageSnapshots>;
  /** A compact “what did we generate/render/review” view for humans. */
  content_preview: ReturnType<typeof buildJobContentPreview> | null;
  /** QC detail derived from generation payload (if any). */
  qc_detail: ReturnType<typeof qcDetailFromGenerationPayload> | null;
  /** Child tables (timelines, drafts, audits, artifacts). */
  assets: JsonRec[];
  job_drafts: JsonRec[];
  transitions: JsonRec[];
  editorial_reviews: JsonRec[];
  diagnostic_audits: JsonRec[];
  auto_validation_results: JsonRec[];
  api_call_audit: JsonRec[];
  validation_events: JsonRec[];
  publication_placements: JsonRec[];
  performance_metrics: JsonRec[];
  llm_approval_reviews: JsonRec[];
}

export interface RunContentLogExport {
  project_id: string;
  run_id: string;
  exported_at: string;
  run: RunRow;
  signal_pack: SignalPackRow | null;
  /** Run-level context snapshots (so you can debug “what we ran with”). */
  run_context: {
    context_snapshot_json: unknown;
    prompt_versions_snapshot: unknown;
    plan_summary_json: unknown;
    candidates_json: unknown;
  };
  /** The existing “content outcomes” rows (if migration 007 is present). */
  outcomes: RunContentOutcomeRow[];
  /** Fully enriched per-task details for the run. */
  jobs: RunContentLogExportJob[];
}

export async function buildRunContentLogExport(
  db: Pool,
  projectId: string,
  runIdText: string,
  limit = 500,
  opts?: { include_outcomes?: boolean }
): Promise<RunContentLogExport> {
  const run = await qOne<RunRow>(
    db,
    `SELECT * FROM caf_core.runs WHERE project_id = $1 AND run_id = $2`,
    [projectId, runIdText]
  );
  if (!run) {
    // Preserve old behavior pattern: caller turns this into a 404.
    throw Object.assign(new Error("run_not_found"), { code: "RUN_NOT_FOUND" });
  }

  const signal_pack = run.signal_pack_id
    ? await qOne<SignalPackRow>(db, `SELECT * FROM caf_core.signal_packs WHERE id = $1::uuid`, [run.signal_pack_id])
    : null;

  const includeOutcomes = opts?.include_outcomes !== false;

  // The “content log” table is optional (migration 007). This call may throw 42P01; caller can catch it.
  const outcomes = includeOutcomes ? await listRunContentOutcomes(db, projectId, runIdText, limit) : [];
  const outcomesByTask = new Map(outcomes.map((o) => [o.task_id, o]));

  const jobs = await q<JsonRec>(
    db,
    `SELECT * FROM caf_core.content_jobs WHERE project_id = $1 AND run_id = $2 ORDER BY task_id ASC LIMIT $3`,
    [projectId, runIdText, limit]
  );
  const taskIds = jobs.map((j) => strVal(j.task_id).trim()).filter(Boolean);

  const [
    assets,
    drafts,
    transitions,
    editorial,
    audits,
    autoVal,
    apiAudit,
    validationEvents,
    placements,
    metrics,
    llmReviews,
  ] = await Promise.all([
    taskIds.length
      ? q<JsonRec>(
          db,
          `SELECT * FROM caf_core.assets WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, position ASC NULLS LAST, created_at ASC`,
          [projectId, taskIds]
        )
      : Promise.resolve([]),
    q<JsonRec>(
      db,
      `SELECT * FROM caf_core.job_drafts WHERE project_id = $1 AND run_id = $2 ORDER BY task_id, created_at ASC`,
      [projectId, runIdText]
    ),
    taskIds.length
      ? q<JsonRec>(
          db,
          `SELECT * FROM caf_core.job_state_transitions WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [projectId, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<JsonRec>(
          db,
          `SELECT * FROM caf_core.editorial_reviews WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [projectId, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<JsonRec>(
          db,
          `SELECT * FROM caf_core.diagnostic_audits WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [projectId, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<JsonRec>(
          db,
          `SELECT * FROM caf_core.auto_validation_results WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [projectId, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<JsonRec>(
          db,
          `SELECT * FROM caf_core.api_call_audit WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [projectId, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<JsonRec>(
          db,
          `SELECT * FROM caf_core.validation_events WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [projectId, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<JsonRec>(
          db,
          `SELECT * FROM caf_core.publication_placements WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [projectId, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<JsonRec>(
          db,
          `SELECT * FROM caf_core.performance_metrics WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [projectId, taskIds]
        )
      : Promise.resolve([]),
    taskIds.length
      ? q<JsonRec>(
          db,
          `SELECT * FROM caf_core.llm_approval_reviews WHERE project_id = $1 AND task_id = ANY($2::text[]) ORDER BY task_id, created_at ASC`,
          [projectId, taskIds]
        )
      : Promise.resolve([]),
  ]);

  const assetsBy = groupByTaskId(assets);
  const draftsBy = groupByTaskId(drafts);
  const transitionsBy = groupByTaskId(transitions);
  const editorialBy = groupByTaskId(editorial);
  const auditsBy = groupByTaskId(audits);
  const autoValBy = groupByTaskId(autoVal);
  const apiAuditBy = groupByTaskId(apiAudit);
  const validationEventsBy = groupByTaskId(validationEvents);
  const placementsBy = groupByTaskId(placements);
  const metricsBy = groupByTaskId(metrics);
  const llmReviewsBy = groupByTaskId(llmReviews);

  const outJobs: RunContentLogExportJob[] = jobs.map((job) => {
    const task_id = strVal(job.task_id).trim();
    const stage = pickStageSnapshots(job);
    const gp = stage.generation_payload;
    const flowForPreview = strVal(job.flow_type).trim() || null;
    const content_preview = (() => {
      try {
        return buildJobContentPreview(flowForPreview, job.generation_payload ?? null);
      } catch {
        return null;
      }
    })();
    const qc_detail = gp ? qcDetailFromGenerationPayload(gp) : null;

    // If we have an outcomes row, merge in its “summary” fields onto the job row for convenience
    // (but keep tables separate in the export).
    const outcome = outcomesByTask.get(task_id);
    void outcome;

    return {
      task_id,
      flow_type: strVal(job.flow_type).trim(),
      platform: strVal(job.platform).trim(),
      status: strVal(job.status).trim(),
      qc_status: strVal(job.qc_status).trim(),
      content_job: job,
      stage,
      content_preview,
      qc_detail,
      assets: assetsBy.get(task_id) ?? [],
      job_drafts: draftsBy.get(task_id) ?? [],
      transitions: transitionsBy.get(task_id) ?? [],
      editorial_reviews: editorialBy.get(task_id) ?? [],
      diagnostic_audits: auditsBy.get(task_id) ?? [],
      auto_validation_results: autoValBy.get(task_id) ?? [],
      api_call_audit: apiAuditBy.get(task_id) ?? [],
      validation_events: validationEventsBy.get(task_id) ?? [],
      publication_placements: placementsBy.get(task_id) ?? [],
      performance_metrics: metricsBy.get(task_id) ?? [],
      llm_approval_reviews: llmReviewsBy.get(task_id) ?? [],
    };
  });

  return {
    project_id: projectId,
    run_id: runIdText,
    exported_at: new Date().toISOString(),
    run,
    signal_pack,
    run_context: {
      context_snapshot_json: (run as unknown as { context_snapshot_json?: unknown }).context_snapshot_json ?? null,
      prompt_versions_snapshot: (run as unknown as { prompt_versions_snapshot?: unknown }).prompt_versions_snapshot ?? null,
      plan_summary_json: (run as unknown as { plan_summary_json?: unknown }).plan_summary_json ?? null,
      candidates_json: (run as unknown as { candidates_json?: unknown }).candidates_json ?? null,
    },
    outcomes,
    jobs: outJobs,
  };
}

