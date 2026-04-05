import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  countJobsCreatedToday,
  ensureProject,
  getConstraints,
  insertDecisionTrace,
  listActiveAppliedLearningRules,
  listActiveSuppressionRules,
} from "../repositories/core.js";
import { evaluateKillSwitches } from "./kill_switches.js";
import { selectPromptVersion } from "./prompt_selector.js";
import { applyLearningBoosts, dedupeByKey, sortByScoreDesc } from "./ranking_rules.js";
import { defaultWeights, scoreCandidate } from "./scoring.js";
import { selectRoute } from "./route_selector.js";
import type { GenerationPlanRequest, GenerationPlanResult, PlannedJob, ScoredCandidate } from "./types.js";

export type { GenerationPlanRequest, GenerationPlanResult } from "./types.js";
export { generationPlanRequestSchema } from "./types.js";

export async function decideGenerationPlan(
  db: Pool,
  config: AppConfig,
  req: GenerationPlanRequest
): Promise<GenerationPlanResult> {
  const traceId = randomUUID();
  const project = await ensureProject(db, req.project_slug);

  const constraints = await getConstraints(db, project.id);
  const minScore =
    req.min_score ??
    (constraints?.min_score_to_generate != null
      ? parseFloat(constraints.min_score_to_generate)
      : config.DEFAULT_MIN_SCORE_TO_GENERATE);
  const variationCap = Math.max(
    1,
    req.max_variations_per_candidate ??
      constraints?.default_variation_cap ??
      config.DEFAULT_MAX_VARIATIONS
  );
  const maxDaily = constraints?.max_daily_jobs ?? config.DEFAULT_MAX_DAILY_JOBS ?? null;
  const autoValThreshold =
    constraints?.auto_validation_pass_threshold != null
      ? parseFloat(constraints.auto_validation_pass_threshold)
      : null;

  const jobsToday = await countJobsCreatedToday(db, project.id);
  const suppressionReasons: GenerationPlanResult["suppression_reasons"] = [];

  if (maxDaily !== null && jobsToday >= maxDaily) {
    const result: GenerationPlanResult = {
      trace_id: traceId,
      project_slug: req.project_slug,
      run_id: req.run_id ?? null,
      suppressed: true,
      suppression_reasons: [
        { code: "DAILY_CAP", message: `Daily job cap reached (${jobsToday}/${maxDaily})` },
      ],
      dropped_candidates: req.candidates.map((c) => ({
        candidate_id: c.candidate_id,
        reason: "daily_cap",
      })),
      selected: [],
      meta: {
        engine_version: config.DECISION_ENGINE_VERSION,
        jobs_created_today: jobsToday,
        max_daily_jobs: maxDaily,
        min_score_used: minScore,
        variation_cap: variationCap,
      },
    };
    if (!req.dry_run) {
      await insertDecisionTrace(db, {
        traceId,
        projectId: project.id,
        runId: req.run_id ?? null,
        engineVersion: config.DECISION_ENGINE_VERSION,
        inputSnapshot: req,
        outputSnapshot: result,
      });
    }
    return result;
  }

  const rules = await listActiveSuppressionRules(db, project.id);
  const kill = await evaluateKillSwitches(db, project.id, rules, req.candidates);
  suppressionReasons.push(...kill.reasons);

  if (kill.hardStop) {
    const result: GenerationPlanResult = {
      trace_id: traceId,
      project_slug: req.project_slug,
      run_id: req.run_id ?? null,
      suppressed: true,
      suppression_reasons: suppressionReasons,
      dropped_candidates: req.candidates.map((c) => ({ candidate_id: c.candidate_id, reason: "hard_stop" })),
      selected: [],
      meta: {
        engine_version: config.DECISION_ENGINE_VERSION,
        jobs_created_today: jobsToday,
        max_daily_jobs: maxDaily,
        min_score_used: minScore,
        variation_cap: variationCap,
      },
    };
    if (!req.dry_run) {
      await insertDecisionTrace(db, {
        traceId,
        projectId: project.id,
        runId: req.run_id ?? null,
        engineVersion: config.DECISION_ENGINE_VERSION,
        inputSnapshot: req,
        outputSnapshot: result,
      });
    }
    return result;
  }

  const learningRules = await listActiveAppliedLearningRules(db, project.id);
  const weights = defaultWeights(config);

  let scored: ScoredCandidate[] = req.candidates.map((c) => scoreCandidate(c, weights));
  scored = applyLearningBoosts(scored, learningRules);
  scored = dedupeByKey(scored);

  const dropped: GenerationPlanResult["dropped_candidates"] = [];
  const flowOk = (flow: string) => !kill.blockedFlowTypes.has(flow);

  scored = scored.filter((c) => {
    if (!flowOk(c.flow_type)) {
      dropped.push({ candidate_id: c.candidate_id, reason: "flow_blocked", pre_gen_score: c.pre_gen_score });
      return false;
    }
    if (c.pre_gen_score < minScore) {
      dropped.push({ candidate_id: c.candidate_id, reason: "below_min_score", pre_gen_score: c.pre_gen_score });
      return false;
    }
    return true;
  });

  let sorted = sortByScoreDesc(scored);
  const maxCand = req.max_candidates ?? sorted.length;
  sorted = sorted.slice(0, maxCand);

  const maxPrompts = constraints?.max_active_prompt_versions ?? null;
  const selected: PlannedJob[] = [];
  let remainingSlots =
    maxDaily === null ? Number.POSITIVE_INFINITY : Math.max(0, maxDaily - jobsToday);

  for (const c of sorted) {
    if (remainingSlots <= 0) break;
    const prompt = await selectPromptVersion(db, project.id, c.flow_type, maxPrompts);
    const route = selectRoute(c, { autoValidationThreshold: autoValThreshold });
    const varsThisCandidate = Math.min(variationCap, remainingSlots);

    for (let v = 0; v < varsThisCandidate; v++) {
      selected.push({
        candidate_id: c.candidate_id,
        flow_type: c.flow_type,
        platform: c.target_platform ?? c.platform,
        variation_index: v,
        variation_name: v === 0 ? "v1" : `v${v + 1}`,
        prompt_version_id: prompt?.prompt_version_id ?? null,
        prompt_id: prompt?.prompt_id ?? null,
        prompt_version_label: prompt?.version ?? null,
        recommended_route: route,
        pre_gen_score: c.pre_gen_score,
      });
      remainingSlots -= 1;
    }
  }

  const result: GenerationPlanResult = {
    trace_id: traceId,
    project_slug: req.project_slug,
    run_id: req.run_id ?? null,
    suppressed: selected.length === 0 && req.candidates.length > 0,
    suppression_reasons: suppressionReasons,
    dropped_candidates: dropped,
    selected,
    meta: {
      engine_version: config.DECISION_ENGINE_VERSION,
      jobs_created_today: jobsToday,
      max_daily_jobs: maxDaily,
      min_score_used: minScore,
      variation_cap: variationCap,
    },
  };

  if (!req.dry_run) {
    await insertDecisionTrace(db, {
      traceId,
      projectId: project.id,
      runId: req.run_id ?? null,
      engineVersion: config.DECISION_ENGINE_VERSION,
      inputSnapshot: req,
      outputSnapshot: result,
    });
  }

  return result;
}
