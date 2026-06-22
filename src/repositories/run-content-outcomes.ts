import type { Pool } from "pg";
import { isCarouselFlow, isImageFlow, isVideoFlow } from "../decision_engine/flow-kind.js";
import { pickStoredQcResult } from "../domain/generation-payload-qc.js";
import { pickRenderState } from "../domain/content-job-render-state.js";
import { resolveJobFlowDisplayLabel } from "../domain/job-flow-display-label.js";
import { buildJobContentPreview } from "../services/content-transparency-preview.js";
import { q } from "../db/queries.js";

export function flowKindForContentLog(flowType: string): string {
  if (isCarouselFlow(flowType)) return "carousel";
  if (isVideoFlow(flowType)) return "video";
  if (isImageFlow(flowType)) return "image";
  return "other";
}

export interface RunContentOutcomeInsert {
  project_id: string;
  run_id: string;
  task_id: string;
  flow_type: string;
  flow_kind: string;
  outcome: string;
  job_status: string;
  slide_count: number | null;
  asset_count: number;
  summary: Record<string, unknown>;
  error_message: string | null;
}

export interface RunContentOutcomeRow {
  created_at: string;
  task_id: string;
  flow_kind: string;
  flow_type: string;
  outcome: string;
  slide_count: number | null;
  asset_count: number;
  job_status: string;
  error_message: string | null;
  summary: Record<string, unknown>;
  /** All LLM draft attempts for this job (newest last). */
  job_drafts?: ContentLogDraftEntry[];
}

/** One row from caf_core.job_drafts, shaped for content-log export. */
export interface ContentLogDraftEntry {
  draft_id: string;
  attempt_no: number | null;
  revision_round: number | null;
  prompt_name: string | null;
  prompt_version: string | null;
  created_at: string;
  model: string | null;
  tokens: number | null;
  generation_reason: string | null;
  rework_mode: string | null;
  package_type: string | null;
  /** Parsed DraftPackage JSON from the LLM attempt. */
  draft_package: Record<string, unknown> | null;
}

export async function insertPlannedRunContentOutcomeSafe(
  db: Pool,
  row: {
    project_id: string;
    run_id: string;
    task_id: string;
    flow_type: string;
    summary: Record<string, unknown>;
  }
): Promise<void> {
  try {
    await insertRunContentOutcome(db, {
      ...row,
      flow_kind: flowKindForContentLog(row.flow_type),
      outcome: "planned",
      job_status: "PLANNED",
      slide_count: null,
      asset_count: 0,
      error_message: null,
    });
  } catch (e) {
    console.warn("[run-orchestrator] run_content_outcomes planned insert failed", e);
  }
}

export async function insertRunContentOutcome(db: Pool, row: RunContentOutcomeInsert): Promise<void> {
  await q(
    db,
    `INSERT INTO caf_core.run_content_outcomes (
       project_id, run_id, task_id, flow_type, flow_kind, outcome, job_status,
       slide_count, asset_count, summary_json, error_message
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)`,
    [
      row.project_id,
      row.run_id,
      row.task_id,
      row.flow_type,
      row.flow_kind,
      row.outcome,
      row.job_status,
      row.slide_count,
      row.asset_count,
      JSON.stringify(row.summary ?? {}),
      row.error_message,
    ]
  );
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

async function countAssetsByTask(
  db: Pool,
  projectId: string,
  taskIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (taskIds.length === 0) return counts;
  const rows = await q<{ task_id: string; n: string }>(
    db,
    `SELECT task_id, count(*)::text AS n
     FROM caf_core.assets
     WHERE project_id = $1 AND task_id = ANY($2::text[])
     GROUP BY task_id`,
    [projectId, taskIds]
  );
  for (const row of rows) {
    counts.set(row.task_id, parseInt(row.n, 10) || 0);
  }
  return counts;
}

export function outcomeLabelFromJobStatus(status: string): string {
  const s = String(status ?? "")
    .trim()
    .toUpperCase();
  switch (s) {
    case "PLANNED":
      return "planned";
    case "GENERATING":
      return "generating";
    case "GENERATED":
      return "generated";
    case "RENDERING":
      return "rendering";
    case "IN_REVIEW":
      return "in_review";
    case "NEEDS_EDIT":
      return "needs_edit";
    case "APPROVED":
      return "approved";
    case "REJECTED":
      return "rejected";
    case "BLOCKED":
      return "blocked";
    case "FAILED":
      return "failed";
    default:
      return s ? s.toLowerCase() : "unknown";
  }
}

function jobSummaryFromPayload(
  job: { flow_type: string; generation_payload: unknown },
  extra: Record<string, unknown> = {}
): Record<string, unknown> {
  const gp = asRecord(job.generation_payload);
  const candidateData = asRecord(gp.candidate_data);
  return {
    platform: candidateData.platform ?? null,
    candidate_id: candidateData.candidate_id ?? candidateData.idea_id ?? null,
    format: candidateData.format ?? null,
    idea_id: candidateData.idea_id ?? candidateData.id ?? null,
    content_idea: String(
      candidateData.content_idea ?? candidateData.title ?? candidateData.summary ?? ""
    ).slice(0, 280),
    ...extra,
  };
}

type TransitionTrailEvent = {
  at: string;
  from_state: string | null;
  to_state: string;
  actor: string | null;
  error?: string | null;
};

async function fetchTransitionTrailsByTask(
  db: Pool,
  projectId: string,
  runId: string
): Promise<Map<string, { status_history: string[]; events: TransitionTrailEvent[] }>> {
  const rows = await q<{
    task_id: string;
    created_at: Date;
    from_state: string | null;
    to_state: string;
    actor: string | null;
    metadata_json: unknown;
  }>(
    db,
    `SELECT t.task_id, t.created_at, t.from_state, t.to_state, t.actor, t.metadata_json
     FROM caf_core.job_state_transitions t
     JOIN caf_core.content_jobs j
       ON j.project_id = t.project_id AND j.task_id = t.task_id
     WHERE j.project_id = $1 AND j.run_id = $2
     ORDER BY t.created_at ASC`,
    [projectId, runId]
  );

  const byTask = new Map<string, { status_history: string[]; events: TransitionTrailEvent[] }>();
  for (const row of rows) {
    const bucket = byTask.get(row.task_id) ?? { status_history: [], events: [] };
    bucket.status_history.push(row.to_state);
    const meta = asRecord(row.metadata_json);
    const err = meta?.error;
    bucket.events.push({
      at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      from_state: row.from_state,
      to_state: row.to_state,
      actor: row.actor,
      error: typeof err === "string" && err.trim() ? err.trim().slice(0, 500) : null,
    });
    byTask.set(row.task_id, bucket);
  }
  return byTask;
}

async function fetchDraftsByTask(
  db: Pool,
  projectId: string,
  runId: string
): Promise<Map<string, ContentLogDraftEntry[]>> {
  const rows = await q<{
    draft_id: string;
    task_id: string;
    attempt_no: number | null;
    revision_round: number | null;
    prompt_name: string | null;
    prompt_version: string | null;
    generated_payload: unknown;
    created_at: Date;
  }>(
    db,
    `SELECT draft_id, task_id, attempt_no, revision_round, prompt_name, prompt_version,
            generated_payload, created_at
     FROM caf_core.job_drafts
     WHERE project_id = $1 AND run_id = $2
     ORDER BY task_id, created_at ASC`,
    [projectId, runId]
  );

  const byTask = new Map<string, ContentLogDraftEntry[]>();
  for (const row of rows) {
    const entry = mapJobDraftRow(row);
    const list = byTask.get(row.task_id) ?? [];
    list.push(entry);
    byTask.set(row.task_id, list);
  }
  return byTask;
}

function mapJobDraftRow(row: {
  draft_id: string;
  attempt_no: number | null;
  revision_round: number | null;
  prompt_name: string | null;
  prompt_version: string | null;
  generated_payload: unknown;
  created_at: Date;
}): ContentLogDraftEntry {
  const gp = asRecord(row.generated_payload);
  const parsedRaw = gp.parsed;
  const draftPackage =
    parsedRaw && typeof parsedRaw === "object" && !Array.isArray(parsedRaw)
      ? (parsedRaw as Record<string, unknown>)
      : null;
  const tokensRaw = gp.tokens;
  const tokens =
    typeof tokensRaw === "number"
      ? tokensRaw
      : typeof tokensRaw === "string"
        ? parseInt(tokensRaw, 10) || null
        : null;

  return {
    draft_id: row.draft_id,
    attempt_no: row.attempt_no,
    revision_round: row.revision_round,
    prompt_name: row.prompt_name,
    prompt_version: row.prompt_version,
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    model: typeof gp.model === "string" ? gp.model : null,
    tokens,
    generation_reason: typeof gp.generation_reason === "string" ? gp.generation_reason : null,
    rework_mode: typeof gp.rework_mode === "string" ? gp.rework_mode : null,
    package_type:
      typeof draftPackage?.package_type === "string"
        ? draftPackage.package_type
        : typeof gp.package_type === "string"
          ? gp.package_type
          : null,
    draft_package: draftPackage,
  };
}

function activeDraftFromGenerationPayload(
  gp: Record<string, unknown>
): Record<string, unknown> | null {
  const snapshot = gp.draft_package_snapshot ?? gp.generated_output;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) return null;
  return {
    draft_id: gp.draft_id ?? null,
    package_type: gp.draft_package_type ?? null,
    warnings: gp.draft_package_warnings ?? [],
    errors: gp.draft_package_errors ?? [],
    prompt_template_name: gp.prompt_template_name ?? null,
    prompt_template_flow_type: gp.prompt_template_flow_type ?? null,
    draft_package: snapshot as Record<string, unknown>,
  };
}

async function fetchLatestPersistedOutcomesByTask(
  db: Pool,
  projectId: string,
  runId: string
): Promise<Map<string, RunContentOutcomeRow>> {
  try {
    const rows = await listRunContentOutcomes(db, projectId, runId, 2000);
    const latest = new Map<string, RunContentOutcomeRow>();
    for (const row of rows) {
      if (!latest.has(row.task_id)) latest.set(row.task_id, row);
    }
    return latest;
  } catch (err) {
    if (String((err as { code?: unknown })?.code ?? "") === "42P01") return new Map();
    throw err;
  }
}

function resolveJobErrorMessage(
  job: { generation_payload: unknown; render_state: unknown },
  persisted?: RunContentOutcomeRow | null,
  trail?: { events: TransitionTrailEvent[] } | null
): string | null {
  if (persisted?.error_message) return persisted.error_message;
  const rs = pickRenderState(job.render_state);
  const err = rs.raw.error ?? rs.raw.reason ?? rs.raw.message;
  if (typeof err === "string" && err.trim()) return err.trim().slice(0, 500);
  const gp = asRecord(job.generation_payload);
  const genErr = gp.generation_error ?? gp.last_error;
  if (typeof genErr === "string" && genErr.trim()) return genErr.trim().slice(0, 500);
  const events = trail?.events ?? [];
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.to_state === "FAILED" && e.error) return e.error;
  }
  return null;
}

export { resolveJobErrorMessage };

/** One row per job: live status + QC/render/preview + compact lifecycle trail. */
export async function buildEnrichedRunContentLogRows(
  db: Pool,
  projectId: string,
  runId: string,
  limit: number
): Promise<RunContentOutcomeRow[]> {
  const jobs = await q<{
    task_id: string;
    flow_type: string;
    status: string;
    platform: string | null;
    qc_status: string | null;
    recommended_route: string | null;
    updated_at: Date;
    generation_payload: unknown;
    render_state: unknown;
  }>(
    db,
    `SELECT task_id, flow_type, status, platform, qc_status, recommended_route,
            updated_at, generation_payload, render_state
     FROM caf_core.content_jobs
     WHERE project_id = $1 AND run_id = $2
     ORDER BY updated_at DESC
     LIMIT $3`,
    [projectId, runId, limit]
  );

  if (jobs.length === 0) return [];

  const taskIds = jobs.map((j) => j.task_id);
  const [assetCounts, draftsByTask, trails, persistedByTask] = await Promise.all([
    countAssetsByTask(db, projectId, taskIds),
    fetchDraftsByTask(db, projectId, runId),
    fetchTransitionTrailsByTask(db, projectId, runId),
    fetchLatestPersistedOutcomesByTask(db, projectId, runId),
  ]);

  return jobs.map((job) => {
    const persisted = persistedByTask.get(job.task_id) ?? null;
    const trail = trails.get(job.task_id);
    const gp = asRecord(job.generation_payload);
    const jobDrafts = draftsByTask.get(job.task_id) ?? [];
    const qc = pickStoredQcResult(gp);
    const render = pickRenderState(job.render_state);
    const preview = buildJobContentPreview(job.flow_type, job.generation_payload);
    const flowDisplay = resolveJobFlowDisplayLabel(job.flow_type, job.generation_payload);
    const slideCount =
      persisted?.slide_count ??
      preview.carousel?.slide_count ??
      null;
    const errorMessage = resolveJobErrorMessage(job, persisted, trail);
    const activeDraft = activeDraftFromGenerationPayload(gp);
    const mimic = gp.mimic_v1 && typeof gp.mimic_v1 === "object" ? gp.mimic_v1 : null;

    const summary: Record<string, unknown> = {
      source: "jobs_enriched",
      flow_label: flowDisplay.flow_label,
      is_mimic_replication: flowDisplay.is_mimic_replication,
      mimic_kind: flowDisplay.mimic_kind,
      ...jobSummaryFromPayload(job),
      qc_status: job.qc_status,
      recommended_route: job.recommended_route ?? qc?.recommended_route ?? null,
      qc_passed: qc?.passed ?? null,
      qc_score: qc?.score ?? null,
      status_history: trail?.status_history ?? [job.status],
      lifecycle_events: trail?.events ?? [],
      draft_count: jobDrafts.length,
      active_draft_package: activeDraft,
      pipeline_error: errorMessage,
      mimic_v1: mimic,
      render: {
        provider: render.raw.provider ?? null,
        status: render.raw.status ?? null,
        phase: render.phase || null,
        video_id: render.video_id || null,
      },
      content_preview: preview,
    };

    if (persisted && persisted.outcome === "completed") {
      summary.pipeline_outcome = {
        outcome: persisted.outcome,
        at: persisted.created_at,
        slide_count: persisted.slide_count,
        asset_count: persisted.asset_count,
      };
    }

    return {
      created_at:
        job.updated_at instanceof Date ? job.updated_at.toISOString() : String(job.updated_at ?? ""),
      task_id: job.task_id,
      flow_kind: flowKindForContentLog(job.flow_type),
      flow_type: job.flow_type,
      flow_label: flowDisplay.flow_label,
      is_mimic_replication: flowDisplay.is_mimic_replication,
      outcome: outcomeLabelFromJobStatus(job.status),
      slide_count: slideCount,
      asset_count: Math.max(assetCounts.get(job.task_id) ?? 0, persisted?.asset_count ?? 0),
      job_status: job.status,
      error_message: errorMessage,
      job_drafts: jobDrafts,
      summary,
    };
  });
}

/** When `run_content_outcomes` is empty, build a timeline from job_state_transitions. */
export async function synthesizeOutcomesFromJobTransitions(
  db: Pool,
  projectId: string,
  runId: string,
  limit: number
): Promise<RunContentOutcomeRow[]> {
  const rows = await q<{
    created_at: Date;
    task_id: string;
    from_state: string | null;
    to_state: string;
    actor: string | null;
    flow_type: string;
    generation_payload: unknown;
  }>(
    db,
    `SELECT t.created_at, t.task_id, t.from_state, t.to_state, t.actor,
            j.flow_type, j.generation_payload
     FROM caf_core.job_state_transitions t
     JOIN caf_core.content_jobs j
       ON j.project_id = t.project_id AND j.task_id = t.task_id
     WHERE j.project_id = $1 AND j.run_id = $2
     ORDER BY t.created_at DESC
     LIMIT $3`,
    [projectId, runId, limit]
  );

  const assetCounts = await countAssetsByTask(
    db,
    projectId,
    [...new Set(rows.map((r) => r.task_id))]
  );

  return rows.map((row) => ({
    created_at:
      row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at ?? ""),
    task_id: row.task_id,
    flow_kind: flowKindForContentLog(row.flow_type),
    flow_type: row.flow_type,
    outcome: outcomeLabelFromJobStatus(row.to_state),
    slide_count: null,
    asset_count: assetCounts.get(row.task_id) ?? 0,
    job_status: row.to_state,
    error_message: null,
    summary: {
      source: "transitions_fallback",
      from_state: row.from_state,
      to_state: row.to_state,
      actor: row.actor,
      ...jobSummaryFromPayload(row),
    },
  }));
}

/** When outcomes table is empty, synthesize one current-state row per job from content_jobs. */
export async function synthesizeCurrentOutcomesFromJobs(
  db: Pool,
  projectId: string,
  runId: string,
  limit: number
): Promise<RunContentOutcomeRow[]> {
  const jobs = await q<{
    task_id: string;
    flow_type: string;
    status: string;
    updated_at: Date;
    generation_payload: unknown;
  }>(
    db,
    `SELECT task_id, flow_type, status, updated_at, generation_payload
     FROM caf_core.content_jobs
     WHERE project_id = $1 AND run_id = $2
     ORDER BY updated_at DESC
     LIMIT $3`,
    [projectId, runId, limit]
  );

  const assetCounts = await countAssetsByTask(
    db,
    projectId,
    jobs.map((j) => j.task_id)
  );

  return jobs.map((job) => ({
    created_at:
      job.updated_at instanceof Date ? job.updated_at.toISOString() : String(job.updated_at ?? ""),
    task_id: job.task_id,
    flow_kind: flowKindForContentLog(job.flow_type),
    flow_type: job.flow_type,
    outcome: outcomeLabelFromJobStatus(job.status),
    slide_count: null,
    asset_count: assetCounts.get(job.task_id) ?? 0,
    job_status: job.status,
    error_message: null,
    summary: {
      source: "jobs_fallback",
      ...jobSummaryFromPayload(job),
    },
  }));
}

/** @deprecated Use synthesizeCurrentOutcomesFromJobs */
export async function synthesizePlannedOutcomesFromJobs(
  db: Pool,
  projectId: string,
  runId: string,
  limit: number
): Promise<RunContentOutcomeRow[]> {
  return synthesizeCurrentOutcomesFromJobs(db, projectId, runId, limit);
}

export type RunContentOutcomesListResult = {
  outcomes: RunContentOutcomeRow[];
  table_missing: boolean;
  source: "outcomes" | "jobs_enriched" | "transitions_fallback" | "jobs_fallback";
};

/** Admin / export content log: one enriched row per job (current state + QC/render/preview). */
export async function listRunContentOutcomesForAdmin(
  db: Pool,
  projectId: string,
  runId: string,
  limit: number
): Promise<RunContentOutcomesListResult> {
  try {
    const outcomes = await buildEnrichedRunContentLogRows(db, projectId, runId, limit);
    return {
      outcomes,
      table_missing: false,
      source: outcomes.length > 0 ? "jobs_enriched" : "outcomes",
    };
  } catch (err) {
    const code = String((err as { code?: unknown })?.code ?? "");
    if (code === "42P01") {
      const fallback = await synthesizeCurrentOutcomesFromJobs(db, projectId, runId, limit);
      return {
        outcomes: fallback,
        table_missing: true,
        source: fallback.length > 0 ? "jobs_fallback" : "outcomes",
      };
    }
    try {
      const fallback = await synthesizeCurrentOutcomesFromJobs(db, projectId, runId, limit);
      return {
        outcomes: fallback,
        table_missing: false,
        source: fallback.length > 0 ? "jobs_fallback" : "outcomes",
      };
    } catch {
      throw err;
    }
  }
}

export async function listRunContentOutcomes(
  db: Pool,
  projectId: string,
  runId: string,
  limit: number
): Promise<RunContentOutcomeRow[]> {
  const rows = await q<{
    created_at: Date;
    task_id: string;
    flow_kind: string;
    flow_type: string;
    outcome: string;
    slide_count: string | null;
    asset_count: string;
    job_status: string;
    error_message: string | null;
    summary_json: unknown;
  }>(
    db,
    `SELECT created_at, task_id, flow_kind, flow_type, outcome, slide_count::text, asset_count::text,
            job_status, error_message, summary_json
     FROM caf_core.run_content_outcomes
     WHERE project_id = $1 AND run_id = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [projectId, runId, limit]
  );
  return rows.map((r) => ({
    created_at: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    task_id: r.task_id,
    flow_kind: r.flow_kind,
    flow_type: r.flow_type,
    outcome: r.outcome,
    slide_count: r.slide_count == null ? null : parseInt(r.slide_count, 10),
    asset_count: parseInt(r.asset_count, 10),
    job_status: r.job_status,
    error_message: r.error_message,
    summary:
      r.summary_json && typeof r.summary_json === "object" && !Array.isArray(r.summary_json)
        ? (r.summary_json as Record<string, unknown>)
        : {},
  }));
}
