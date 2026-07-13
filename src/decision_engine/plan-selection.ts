import type { Pool } from "pg";
import { resolvePromptVersion } from "./prompt_selector.js";
import { selectRoute } from "./route_selector.js";
import { isVideoFlow } from "./flow-kind.js";
import { isTopPerformerMimicRenderableFlow } from "../domain/top-performer-mimic-flow-types.js";
import {
  countsTowardCarouselRunCap,
  ideaKeyFallbackPass,
  ideaKeyPrimaryPass,
  isStandardTemplatedCarouselFlow,
  type IdeaFormatBucket,
} from "./format-routing.js";
import {
  carouselLaneCapKey,
  normalizeContentLens,
  PLAN_LANE_NICHE_CAROUSEL,
  PLAN_LANE_PRODUCT_CAROUSEL,
} from "../domain/idea-structure.js";
import { CANONICAL_FLOW_TYPES } from "../domain/canonical-flow-types.js";
import type { GenerationPlanResult, PlannedJob, ScoredCandidate } from "./types.js";

export interface PlanSelectionContext {
  db: Pool;
  projectId: string;
  cafGlobalProjectId: string;
  minScore: number;
  variationCap: number;
  maxDaily: number | null;
  jobsToday: number;
  maxPrompts: number | null;
  maxCarouselPlan: number;
  maxVideoPlan: number;
  perFlowCaps: Record<string, number>;
  autoValThreshold: number | null;
  promptOverride: Parameters<typeof resolvePromptVersion>[1]["override"];
}

export interface PlanSelectionState {
  selected: PlannedJob[];
  dropped: GenerationPlanResult["dropped_candidates"];
  remainingSlots: number;
  plannedCarousel: number;
  plannedVideo: number;
  perFlowPlanned: Record<string, number>;
  perLanePlanned: Record<string, number>;
  usedIdeaKeys: Set<string>;
}

export function createPlanSelectionState(ctx: PlanSelectionContext): PlanSelectionState {
  const remainingSlots =
    ctx.maxDaily === null ? Number.POSITIVE_INFINITY : Math.max(0, ctx.maxDaily - ctx.jobsToday);
  return {
    selected: [],
    dropped: [],
    remainingSlots,
    plannedCarousel: 0,
    plannedVideo: 0,
    perFlowPlanned: {},
    perLanePlanned: {},
    usedIdeaKeys: new Set<string>(),
  };
}

function carouselLaneCapForCandidate(
  c: ScoredCandidate,
  perFlowCaps: Record<string, number>
): { laneKey: string; cap: number } | null {
  if (!countsTowardCarouselRunCap(c.flow_type)) return null;
  const payload = (c.payload ?? {}) as Record<string, unknown>;
  const lens = normalizeContentLens(payload.content_lens);
  const laneKey = carouselLaneCapKey(lens);
  const laneCap = perFlowCaps[laneKey];
  const flowCap = perFlowCaps[c.flow_type] ?? perFlowCaps[CANONICAL_FLOW_TYPES.CAROUSEL] ?? 0;
  const cap =
    laneCap !== undefined
      ? laneCap
      : lens === "product"
        ? perFlowCaps[PLAN_LANE_PRODUCT_CAROUSEL] ?? flowCap
        : perFlowCaps[PLAN_LANE_NICHE_CAROUSEL] ?? flowCap;
  return { laneKey, cap };
}

function duplicateReason(pass: "primary" | "fallback"): string {
  return pass === "primary" ? "duplicate_idea_primary_format" : "duplicate_idea_flow_bucket";
}

export async function selectExactCartJobsFromCandidates(
  ctx: PlanSelectionContext,
  state: PlanSelectionState,
  sorted: ScoredCandidate[]
): Promise<void> {
  const ordered = [...sorted].sort((a, b) => {
    const ai = a.source_row_index_1_based ?? Number.MAX_SAFE_INTEGER;
    const bi = b.source_row_index_1_based ?? Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    return b.pre_gen_score - a.pre_gen_score;
  });

  for (const c of ordered) {
    if (state.remainingSlots <= 0) break;

    const resolvedPrompt = await resolvePromptVersion(ctx.db, {
      projectId: ctx.projectId,
      cafGlobalProjectId: ctx.cafGlobalProjectId,
      flowType: c.flow_type,
      maxActive: ctx.maxPrompts,
      override: ctx.promptOverride,
    });
    const route = selectRoute(c, { autoValidationThreshold: ctx.autoValThreshold });

    state.selected.push({
      candidate_id: c.candidate_id,
      flow_type: c.flow_type,
      platform: c.target_platform ?? c.platform,
      source_row_index_1_based: c.source_row_index_1_based,
      variation_index: 0,
      variation_name: "v1",
      prompt_version_id: resolvedPrompt.selected?.prompt_version_id ?? null,
      prompt_id: resolvedPrompt.selected?.prompt_id ?? null,
      prompt_version_label: resolvedPrompt.selected?.version ?? null,
      prompt_source: resolvedPrompt.source,
      recommended_route: route,
      pre_gen_score: c.pre_gen_score,
    });
    state.remainingSlots -= 1;
    const ft = c.flow_type;
    if (countsTowardCarouselRunCap(ft)) state.plannedCarousel += 1;
    if (isVideoFlow(ft)) state.plannedVideo += 1;
    state.perFlowPlanned[ft] = (state.perFlowPlanned[ft] ?? 0) + 1;
  }
}

export async function selectJobsFromCandidates(
  ctx: PlanSelectionContext,
  state: PlanSelectionState,
  sorted: ScoredCandidate[],
  opts: {
    pass: "primary" | "fallback";
    ideaKey: (c: ScoredCandidate) => string;
    /** Cap variations for this pass (e.g. 1 to spread v1 across ideas before v2). */
    maxVariationsPerCandidate?: number;
  }
): Promise<void> {
  for (const c of sorted) {
    if (state.remainingSlots <= 0) break;

    const ideaKey = opts.ideaKey(c);
    if (state.usedIdeaKeys.has(ideaKey)) {
      state.dropped.push({
        candidate_id: c.candidate_id,
        reason: duplicateReason(opts.pass),
        pre_gen_score: c.pre_gen_score,
      });
      continue;
    }

    const resolvedPrompt = await resolvePromptVersion(ctx.db, {
      projectId: ctx.projectId,
      cafGlobalProjectId: ctx.cafGlobalProjectId,
      flowType: c.flow_type,
      maxActive: ctx.maxPrompts,
      override: ctx.promptOverride,
    });
    const route = selectRoute(c, { autoValidationThreshold: ctx.autoValThreshold });
    const ft = c.flow_type;
    const perCandidateCap = opts.maxVariationsPerCandidate ?? ctx.variationCap;
    let varsThisCandidate = Math.min(ctx.variationCap, perCandidateCap, state.remainingSlots);
    // One mimic job per reference post — v2 duplicates the same evidence deck and wastes render cost.
    if (isTopPerformerMimicRenderableFlow(ft)) {
      varsThisCandidate = Math.min(varsThisCandidate, 1);
    }

    const usedFt = state.perFlowPlanned[ft] ?? 0;
    const capFt = ctx.perFlowCaps[ft] ?? 0;
    varsThisCandidate = Math.min(varsThisCandidate, Math.max(0, capFt - usedFt));
    const laneInfo = carouselLaneCapForCandidate(c, ctx.perFlowCaps);
    if (laneInfo) {
      const laneUsed = state.perLanePlanned[laneInfo.laneKey] ?? 0;
      varsThisCandidate = Math.min(varsThisCandidate, Math.max(0, laneInfo.cap - laneUsed));
    }
    if (countsTowardCarouselRunCap(ft)) {
      varsThisCandidate = Math.min(
        varsThisCandidate,
        Math.max(0, ctx.maxCarouselPlan - state.plannedCarousel)
      );
    }
    if (isVideoFlow(ft)) {
      varsThisCandidate = Math.min(
        varsThisCandidate,
        Math.max(0, ctx.maxVideoPlan - state.plannedVideo)
      );
    }

    if (varsThisCandidate <= 0) {
      state.dropped.push({
        candidate_id: c.candidate_id,
        reason: "plan_cap",
        pre_gen_score: c.pre_gen_score,
      });
      continue;
    }

    state.usedIdeaKeys.add(ideaKey);
    for (let v = 0; v < varsThisCandidate; v++) {
      state.selected.push({
        candidate_id: c.candidate_id,
        flow_type: c.flow_type,
        platform: c.target_platform ?? c.platform,
        source_row_index_1_based: c.source_row_index_1_based,
        variation_index: v,
        variation_name: v === 0 ? "v1" : `v${v + 1}`,
        prompt_version_id: resolvedPrompt.selected?.prompt_version_id ?? null,
        prompt_id: resolvedPrompt.selected?.prompt_id ?? null,
        prompt_version_label: resolvedPrompt.selected?.version ?? null,
        prompt_source: resolvedPrompt.source,
        recommended_route: route,
        pre_gen_score: c.pre_gen_score,
      });
      state.remainingSlots -= 1;
      if (countsTowardCarouselRunCap(ft)) state.plannedCarousel += 1;
      if (isVideoFlow(ft)) state.plannedVideo += 1;
      state.perFlowPlanned[ft] = (state.perFlowPlanned[ft] ?? 0) + 1;
      if (laneInfo) {
        state.perLanePlanned[laneInfo.laneKey] = (state.perLanePlanned[laneInfo.laneKey] ?? 0) + 1;
      }
    }
  }
}

/** After v1 spread, add v2+ for templated carousel jobs that already have variation_index 0. */
export async function selectTemplatedCarouselExtraVariations(
  ctx: PlanSelectionContext,
  state: PlanSelectionState,
  variationCap: number
): Promise<void> {
  if (variationCap <= 1) return;

  const v1Jobs = state.selected.filter(
    (j) => isStandardTemplatedCarouselFlow(j.flow_type) && j.variation_index === 0
  );

  for (const base of v1Jobs) {
    for (let v = 1; v < variationCap; v++) {
      if (state.remainingSlots <= 0) break;

      const ft = base.flow_type;
      const usedFt = state.perFlowPlanned[ft] ?? 0;
      const capFt = ctx.perFlowCaps[ft] ?? 0;
      if (usedFt >= capFt) break;
      if (state.plannedCarousel >= ctx.maxCarouselPlan) break;

      state.selected.push({
        candidate_id: base.candidate_id,
        flow_type: base.flow_type,
        platform: base.platform,
        source_row_index_1_based: base.source_row_index_1_based,
        variation_index: v,
        variation_name: `v${v + 1}`,
        prompt_version_id: base.prompt_version_id,
        prompt_id: base.prompt_id,
        prompt_version_label: base.prompt_version_label,
        prompt_source: base.prompt_source,
        recommended_route: base.recommended_route,
        pre_gen_score: base.pre_gen_score,
      });
      state.remainingSlots -= 1;
      state.plannedCarousel += 1;
      state.perFlowPlanned[ft] = (state.perFlowPlanned[ft] ?? 0) + 1;
    }
  }
}

export { ideaKeyPrimaryPass, ideaKeyFallbackPass };
export type { IdeaFormatBucket };
