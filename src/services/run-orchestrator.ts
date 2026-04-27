/**
 * Run Orchestrator — the core pipeline driver.
 *
 * When a run is started, the orchestrator:
 * 1. Loads the signal pack attached to the run
 * 2. Loads the project config (allowed flows, constraints, prompt versions)
 * 3. Optionally expands planner source rows via LLM (scene-assembly candidate router)
 * 4. Expands `runs.candidates_json` (materialized from pack ideas — manual or LLM) × enabled flows
 * 5. Calls the decision engine to score/filter/plan
 * 6. Bulk-creates content_jobs from the planned output
 * 7. Updates run status through the lifecycle
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { decideGenerationPlan } from "../decision_engine/index.js";
import { getSignalPackById, type SignalPackRow } from "../repositories/signal-packs.js";
import {
  getRunById,
  resetRunForReplan,
  setRunContextSnapshot,
  setRunPlanSummary,
  setRunPromptVersionsSnapshot,
  updateRunStatus,
  type RunRow,
} from "../repositories/runs.js";
import {
  ensureDefaultAllowedFlowsIfNone,
  getBrandConstraints,
  getStrategyDefaults,
  listAllowedFlowTypes,
} from "../repositories/project-config.js";
import { deleteAllJobsForRun, upsertContentJob } from "../repositories/jobs.js";
import { insertJobStateTransition } from "../repositories/transitions.js";
import type { CandidateInput } from "../decision_engine/types.js";
import { qOne } from "../db/queries.js";
import { isOfflinePipelineFlow } from "./offline-flow-types.js";
import { expandOverallCandidatesWithSceneAssemblyRouter } from "./scene-assembly-candidate-router.js";
import { buildSnapshotFromPlannedJobs } from "./run-prompt-versions-snapshot.js";
import { getLearningContextForGeneration } from "./learning-rule-selection.js";
import {
  buildRunContextSnapshot,
  pickBrandSliceForSnapshot,
  pickStrategySliceForSnapshot,
  type LearningSliceInput,
} from "./run-context-snapshot.js";
import { logPipelineEvent } from "./pipeline-logger.js";
import { buildContentTaskId, shouldSkipCandidateForFlow } from "./task-id.js";

/** Planner source rows written to the run before Start (`POST .../candidates`). */
function plannerSourceRowsFromRun(run: RunRow): Record<string, unknown>[] {
  const raw = run.candidates_json as unknown;
  if (Array.isArray(raw)) return raw as Record<string, unknown>[];
  if (typeof raw === "string") {
    try {
      const p = JSON.parse(raw) as unknown;
      return Array.isArray(p) ? (p as Record<string, unknown>[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

export interface StartRunResult {
  run_id: string;
  status: string;
  total_candidates: number;
  planned_jobs: number;
  suppressed: boolean;
  suppression_reasons: Array<{ code: string; message: string }>;
  created_job_ids: string[];
}

export async function startRun(
  db: Pool,
  config: AppConfig,
  runUuid: string
): Promise<StartRunResult> {
  const run = await getRunById(db, runUuid);
  if (!run) throw new Error(`Run not found: ${runUuid}`);
  if (run.status !== "CREATED") {
    throw new Error(`Run ${run.run_id} is in status ${run.status}, expected CREATED`);
  }

  /** CREATED runs must not carry jobs; wipe orphans (e.g. legacy reset without delete, or external sync). */
  await deleteAllJobsForRun(db, run.project_id, run.run_id);

  try {
    if (!run.signal_pack_id) {
      throw new Error(`Run ${run.run_id} has no signal pack attached`);
    }

    const pack = await getSignalPackById(db, run.signal_pack_id);
    if (!pack) {
      throw new Error(`Signal pack ${run.signal_pack_id} not found`);
    }

    let overallCandidates = plannerSourceRowsFromRun(run);
    if (overallCandidates.length === 0) {
      throw new Error(
        `Run ${run.run_id} has empty candidates_json. Materialize from the signal pack first: POST /v1/runs/:project_slug/<slug>/${run.run_id}/candidates with body {"mode":"from_pack_ideas_all"} or {"mode":"manual","idea_ids":["idea_…"]} or {"mode":"llm"}. Packs without ideas_json may use {"mode":"from_pack_overall"}.`
      );
    }

    await ensureDefaultAllowedFlowsIfNone(db, run.project_id);
    const allowedFlows = await listAllowedFlowTypes(db, run.project_id);
    const enabledFlows = allowedFlows.filter((f) => f.enabled && !isOfflinePipelineFlow(f.flow_type));

    if (enabledFlows.length === 0) {
      throw new Error(`No enabled flow types for project ${run.project_id}`);
    }

    // Only mark the run as PLANNING once the request is actually actionable.
    await updateRunStatus(db, runUuid, "PLANNING", { started_at: new Date().toISOString() });

    overallCandidates = await expandOverallCandidatesWithSceneAssemblyRouter(db, config, {
      projectId: run.project_id,
      runId: run.run_id,
      signalPackId: run.signal_pack_id,
      overallCandidates,
      enabledFlows,
    });
    const candidates = buildCandidatesFromSignalPack(overallCandidates, enabledFlows, run.run_id);

    if (candidates.length === 0) {
      await updateRunStatus(db, runUuid, "COMPLETED", {
        completed_at: new Date().toISOString(),
        total_jobs: 0,
      });
      return {
        run_id: run.run_id,
        status: "COMPLETED",
        total_candidates: overallCandidates.length,
        planned_jobs: 0,
        suppressed: false,
        suppression_reasons: [],
        created_job_ids: [],
      };
    }

    const projectRow = await qOne<{ slug: string }>(db,
      `SELECT slug FROM caf_core.projects WHERE id = $1`, [run.project_id]);
    if (!projectRow) throw new Error(`Project ${run.project_id} not found`);

    const plan = await decideGenerationPlan(db, config, {
      project_slug: projectRow.slug,
      run_id: run.run_id,
      candidates,
    });

    try {
      await setRunPlanSummary(db, runUuid, {
        trace_id: plan.trace_id,
        suppressed: plan.suppressed,
        suppression_reasons: plan.suppression_reasons,
        selected_count: plan.selected.length,
        dropped_count: plan.dropped_candidates.length,
        planned_candidate_ids: plan.selected.map((j) => j.candidate_id),
        meta: plan.meta,
      });
    } catch {
      /* plan_summary_json column may be missing on older DBs */
    }

    if (plan.selected.length === 0) {
      await updateRunStatus(db, runUuid, "COMPLETED", {
        completed_at: new Date().toISOString(),
        total_jobs: 0,
      });
      return {
        run_id: run.run_id,
        status: "COMPLETED",
        total_candidates: candidates.length,
        planned_jobs: 0,
        suppressed: plan.suppressed,
        suppression_reasons: plan.suppression_reasons,
        created_job_ids: [],
      };
    }

    await updateRunStatus(db, runUuid, "PLANNED", { total_jobs: plan.selected.length });

    const promptVersionsSnapshot = buildSnapshotFromPlannedJobs(
      plan.selected,
      plan.trace_id,
      config.DECISION_ENGINE_VERSION
    );
    await setRunPromptVersionsSnapshot(db, runUuid, promptVersionsSnapshot);

    // Freeze the generation context that shaped this run. Writing a snapshot
    // failure MUST NOT fail the run — the snapshot is forensic, not transactional.
    try {
      const brand = await getBrandConstraints(db, run.project_id);
      const strategy = await getStrategyDefaults(db, run.project_id);
      const learningSlices: LearningSliceInput[] = [];
      const seen = new Set<string>();
      for (const j of plan.selected) {
        const key = `${j.flow_type ?? ""}|${j.platform ?? ""}`;
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          const compiled = await getLearningContextForGeneration(
            db,
            run.project_id,
            j.flow_type ?? null,
            j.platform ?? null
          );
          learningSlices.push({
            flow_type: j.flow_type ?? null,
            platform: j.platform ?? null,
            compiled,
          });
        } catch {
          // single-slice failure must not skip the whole snapshot.
        }
      }
      const snapshot = buildRunContextSnapshot({
        run_id: run.run_id,
        project_slug: projectRow.slug,
        engine_version: config.DECISION_ENGINE_VERSION,
        trace_id: plan.trace_id,
        prompt_versions: promptVersionsSnapshot,
        project_config: {
          enabled_flow_types: enabledFlows.map((f) => f.flow_type),
          strategy_slice: pickStrategySliceForSnapshot(
            (strategy as Record<string, unknown> | null) ?? null
          ),
          brand_slice: pickBrandSliceForSnapshot(
            (brand as Record<string, unknown> | null) ?? null
          ),
        },
        learning: learningSlices,
      });
      await setRunContextSnapshot(db, runUuid, snapshot as unknown as Record<string, unknown>);
      logPipelineEvent("info", "plan", "run_context_snapshot_written", {
        run_id: run.run_id,
        project_id: run.project_id,
        project_slug: projectRow.slug,
        data: {
          flow_type_lanes: learningSlices.length,
          enabled_flows: enabledFlows.length,
        },
      });
    } catch (err) {
      logPipelineEvent(
        "warn",
        "plan",
        "run_context_snapshot_failed",
        {
          run_id: run.run_id,
          project_id: run.project_id,
          project_slug: projectRow.slug,
          data: { error: err instanceof Error ? err.message : String(err) },
        }
      );
    }

    const createdJobIds: string[] = [];
    for (const job of plan.selected) {
      const taskId = buildContentTaskId({
        runId: run.run_id,
        platform: job.platform ?? "Instagram",
        flowType: job.flow_type,
        sourceRowIndex1Based: job.source_row_index_1_based ?? 1,
        variationName: job.variation_name,
        variationIndex: job.variation_index,
      });

      const candidateData = resolveCandidateDataForPlannedJob(overallCandidates, job.candidate_id);

      const result = await upsertContentJob(db, {
        task_id: taskId,
        project_id: run.project_id,
        run_id: run.run_id,
        candidate_id: job.candidate_id,
        variation_name: job.variation_name,
        flow_type: job.flow_type,
        platform: job.platform ?? null,
        status: "PLANNED",
        recommended_route: job.recommended_route,
        pre_gen_score: job.pre_gen_score,
        generation_payload: {
          signal_pack_id: run.signal_pack_id,
          candidate_data: candidateData ?? {},
          prompt_version_id: job.prompt_version_id,
          prompt_id: job.prompt_id,
          prompt_version_label: job.prompt_version_label,
          variation_index: job.variation_index,
        },
      });

      createdJobIds.push(result.id);

      await insertJobStateTransition(db, {
        task_id: taskId,
        project_id: run.project_id,
        from_state: null,
        to_state: "PLANNED",
        triggered_by: "system",
        actor: "run-orchestrator",
        metadata: { run_uuid: runUuid, trace_id: plan.trace_id },
      });
    }

    await updateRunStatus(db, runUuid, "GENERATING");

    return {
      run_id: run.run_id,
      status: "GENERATING",
      total_candidates: candidates.length,
      planned_jobs: plan.selected.length,
      suppressed: plan.suppressed,
      suppression_reasons: plan.suppression_reasons,
      created_job_ids: createdJobIds,
    };
  } catch (err) {
    // These are "fix inputs then retry" errors; don't poison the run status.
    const msg = err instanceof Error ? err.message : String(err);
    const recoverable =
      msg.includes("empty candidates_json") ||
      msg.includes("has no signal pack") ||
      (msg.includes("Signal pack") && msg.includes("not found")) ||
      msg.includes("No enabled flow types");
    if (recoverable) {
      await resetRunForReplan(db, runUuid);
    } else {
      await updateRunStatus(db, runUuid, "FAILED", {
        completed_at: new Date().toISOString(),
      });
    }
    throw err;
  }
}

export interface ReplanRunResult extends StartRunResult {
  deleted_jobs: number;
}

/**
 * Delete all jobs for the run, reset to CREATED, and run the decision engine again (respects current caps).
 */
export async function replanRun(db: Pool, config: AppConfig, runUuid: string): Promise<ReplanRunResult> {
  const run = await getRunById(db, runUuid);
  if (!run) throw new Error(`Run not found: ${runUuid}`);
  if (!run.signal_pack_id) {
    throw new Error(`Run ${run.run_id} has no signal pack; attach one before re-planning`);
  }
  if (run.status === "PLANNING") {
    throw new Error(`Run ${run.run_id} is still planning; wait or cancel first`);
  }
  if (run.status === "CREATED" && run.total_jobs === 0) {
    throw new Error(`Run ${run.run_id} has no jobs yet — use Start instead of Re-plan`);
  }

  const deleted = await deleteAllJobsForRun(db, run.project_id, run.run_id);
  await resetRunForReplan(db, runUuid);
  const start = await startRun(db, config, runUuid);
  return { ...start, deleted_jobs: deleted };
}

/**
 * Planned job candidate_id is `{base}_{flow_type}` (see buildCandidatesFromSignalPack).
 * Match the signal-pack row by longest base id prefix so candidate_data is populated.
 */
function resolveCandidateDataForPlannedJob(
  overallCandidates: Record<string, unknown>[],
  plannedCandidateId: string
): Record<string, unknown> {
  const matches: { row: Record<string, unknown>; len: number }[] = [];
  for (const c of overallCandidates) {
    const base = String(c.candidate_id ?? c.sign ?? c.topic ?? "").trim();
    if (!base) continue;
    if (plannedCandidateId === base || plannedCandidateId.startsWith(`${base}_`)) {
      matches.push({ row: c, len: base.length });
    }
  }
  if (matches.length === 0) return {};
  matches.sort((a, b) => b.len - a.len);
  return matches[0].row;
}

/**
 * Build CandidateInput[] from the overall_candidates_json and allowed flows.
 *
 * Each planner source row becomes one candidate per enabled flow type.
 * The "sign" or "topic" field becomes the candidate_id.
 */
function buildCandidatesFromSignalPack(
  overallCandidates: Record<string, unknown>[],
  enabledFlows: Array<{ flow_type: string; priority_weight: number | null; allowed_platforms: string | null }>,
  runId: string
): CandidateInput[] {
  const candidates: CandidateInput[] = [];

  for (let rowIdx = 0; rowIdx < overallCandidates.length; rowIdx++) {
    const row = overallCandidates[rowIdx]!;
    const candidateId = String(row.candidate_id ?? row.sign ?? row.topic ?? randomUUID());
    const confidence = parseFloat(String(row.confidence ?? row.confidence_score ?? 0.8));
    const platform = String(row.platform ?? row.target_platform ?? "Instagram");
    const sourceRowIndex1Based = rowIdx + 1;

    for (const flow of enabledFlows) {
      if (shouldSkipCandidateForFlow(platform, flow.flow_type)) {
        continue;
      }

      const flowPlatforms = flow.allowed_platforms
        ? flow.allowed_platforms.split(",").map((p) => p.trim())
        : null;

      if (flowPlatforms && !flowPlatforms.some((p) => p.toLowerCase() === platform.toLowerCase())) {
        continue;
      }

      candidates.push({
        candidate_id: `${candidateId}_${flow.flow_type}`,
        content_idea: String(row.summary ?? row.content_idea ?? row.dominant_themes ?? ""),
        run_id: runId,
        platform,
        target_platform: platform,
        flow_type: flow.flow_type,
        confidence_score: confidence,
        platform_fit: parseFloat(String(row.platform_fit ?? 0.7)),
        novelty_score: parseFloat(String(row.novelty_score ?? 0.5)),
        past_performance_similarity: parseFloat(String(row.past_performance ?? 0.5)),
        recommended_route: String(row.recommended_route ?? "HUMAN_REVIEW"),
        dedupe_key: `${candidateId}_${flow.flow_type}_${platform}`,
        payload: row,
        source_row_index_1_based: sourceRowIndex1Based,
      });
    }
  }

  return candidates;
}

