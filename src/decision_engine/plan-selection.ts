import type { Pool } from "pg";
import { resolvePromptVersion } from "./prompt_selector.js";
import { selectRoute } from "./route_selector.js";
import { isCarouselFlow, isVideoFlow } from "./flow-kind.js";
import {
  ideaKeyFallbackPass,
  ideaKeyPrimaryPass,
  type IdeaFormatBucket,
} from "./format-routing.js";
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
    usedIdeaKeys: new Set<string>(),
  };
}

function duplicateReason(pass: "primary" | "fallback"): string {
  return pass === "primary" ? "duplicate_idea_primary_format" : "duplicate_idea_flow_bucket";
}

export async function selectJobsFromCandidates(
  ctx: PlanSelectionContext,
  state: PlanSelectionState,
  sorted: ScoredCandidate[],
  opts: {
    pass: "primary" | "fallback";
    ideaKey: (c: ScoredCandidate) => string;
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
    let varsThisCandidate = Math.min(ctx.variationCap, state.remainingSlots);

    const usedFt = state.perFlowPlanned[ft] ?? 0;
    const capFt = ctx.perFlowCaps[ft] ?? 0;
    varsThisCandidate = Math.min(varsThisCandidate, Math.max(0, capFt - usedFt));
    if (isCarouselFlow(ft)) {
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
      if (isCarouselFlow(ft)) state.plannedCarousel += 1;
      if (isVideoFlow(ft)) state.plannedVideo += 1;
      state.perFlowPlanned[ft] = (state.perFlowPlanned[ft] ?? 0) + 1;
    }
  }
}

export { ideaKeyPrimaryPass, ideaKeyFallbackPass };
export type { IdeaFormatBucket };
