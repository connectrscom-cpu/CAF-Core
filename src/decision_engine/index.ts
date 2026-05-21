import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  countJobsCreatedToday,
  ensureProject,
  getConstraints,
  normalizePerFlowCaps,
  insertDecisionTrace,
  listActiveSuppressionRules,
} from "../repositories/core.js";
import { getLearningRulesForPlanning } from "../services/learning-rule-selection.js";
import { evaluateKillSwitches } from "./kill_switches.js";
import { applyLearningBoosts, dedupeByKey, sortByScoreDesc } from "./ranking_rules.js";
import { defaultWeights, scoreCandidate } from "./scoring.js";
import { resolvePlanningCaps } from "./planning-caps.js";
import {
  partitionCandidatesForPlanningPhases,
  partitionPrimaryForCarouselSpread,
} from "./format-routing.js";
import {
  createPlanSelectionState,
  ideaKeyFallbackPass,
  ideaKeyPrimaryPass,
  selectJobsFromCandidates,
  selectTemplatedCarouselExtraVariations,
} from "./plan-selection.js";
import type { GenerationPlanRequest, GenerationPlanResult, ScoredCandidate } from "./types.js";
import { isCarouselFlow, isVideoFlow } from "./flow-kind.js";

export type { GenerationPlanRequest, GenerationPlanResult } from "./types.js";

export { isCarouselFlow, isVideoFlow } from "./flow-kind.js";
export { generationPlanRequestSchema } from "./types.js";
export {
  bucketForIdeaFormat,
  bucketForFlowType,
  isPrimaryFormatMatch,
  partitionCandidatesForPlanningPhases,
} from "./format-routing.js";

export async function decideGenerationPlan(
  db: Pool,
  config: AppConfig,
  req: GenerationPlanRequest
): Promise<GenerationPlanResult> {
  const traceId = randomUUID();
  const project = await ensureProject(db, req.project_slug);
  const cafGlobal = await ensureProject(db, "caf-global", "CAF Global");

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

  const learningRules = await getLearningRulesForPlanning(db, project.id);
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
  const planningCaps = resolvePlanningCaps(
    config,
    constraints,
    sorted.map((c) => c.flow_type)
  );
  const maxCarouselPlan = planningCaps.maxCarouselPlan;
  const maxVideoPlan = planningCaps.maxVideoPlan;
  const perFlowCaps = planningCaps.perFlowCaps;
  const { primary, fallback } = partitionCandidatesForPlanningPhases(sorted);

  const selectionCtx = {
    db,
    projectId: project.id,
    cafGlobalProjectId: cafGlobal.id,
    minScore,
    variationCap,
    maxDaily,
    jobsToday,
    maxPrompts,
    maxCarouselPlan,
    maxVideoPlan,
    perFlowCaps,
    autoValThreshold,
    promptOverride: req.prompt_override,
  };
  const selectionState = createPlanSelectionState(selectionCtx);

  // Pass 1: format-matched. Templated carousels spread v1 across distinct ideas first; mimic may overlap.
  const { templatedCarousel, other: otherPrimary } = partitionPrimaryForCarouselSpread(primary);
  await selectJobsFromCandidates(selectionCtx, selectionState, templatedCarousel, {
    pass: "primary",
    ideaKey: ideaKeyPrimaryPass,
    maxVariationsPerCandidate: 1,
  });
  await selectTemplatedCarouselExtraVariations(selectionCtx, selectionState, variationCap);
  await selectJobsFromCandidates(selectionCtx, selectionState, otherPrimary, {
    pass: "primary",
    ideaKey: ideaKeyPrimaryPass,
  });
  // Pass 2: ideas without `format` (and post/thread/other); no carousel↔video cross-format.
  await selectJobsFromCandidates(selectionCtx, selectionState, fallback, {
    pass: "fallback",
    ideaKey: ideaKeyFallbackPass,
  });

  const selected = selectionState.selected;
  const plannedCarousel = selectionState.plannedCarousel;
  const plannedVideo = selectionState.plannedVideo;
  dropped.push(...selectionState.dropped);

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
      prompt_override_used: req.prompt_override ?? null,
      max_carousel_jobs_per_run: maxCarouselPlan,
      max_video_jobs_per_run: maxVideoPlan,
      default_other_flow_plan_cap: config.DEFAULT_OTHER_FLOW_PLAN_CAP,
      max_jobs_per_flow_type: Object.keys(normalizePerFlowCaps(constraints?.max_jobs_per_flow_type)).length
        ? normalizePerFlowCaps(constraints?.max_jobs_per_flow_type)
        : undefined,
      planned_carousel_jobs: plannedCarousel,
      planned_video_jobs: plannedVideo,
      planning_primary_candidates: primary.length,
      planning_fallback_candidates: fallback.length,
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
