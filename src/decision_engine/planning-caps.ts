import type { AppConfig } from "../config.js";
import type { ConstraintRow } from "../repositories/core.js";
import { normalizePerFlowCaps } from "../repositories/core.js";
import { FLOW_TOP_PERFORMER_MIMIC_VIDEO } from "../domain/top-performer-mimic-flow-types.js";
import { TOP_PERFORMER_MIMIC_VIDEO_HEYGEN_FLOWS } from "../domain/top-performer-video-heygen-routing.js";
import { isTopPerformerMimicFlow } from "../domain/top-performer-mimic-flow-types.js";
import { isCarouselFlow, isVideoFlow } from "./flow-kind.js";
import {
  DEFAULT_CAROUSEL_FLOW_PLAN_CAP,
  DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP,
  DEFAULT_VIDEO_FLOW_PLAN_CAP,
  defaultMaxJobsPerFlowType,
} from "./default-plan-caps.js";

export interface PlanningCapsContext {
  maxCarouselPlan: number;
  maxVideoPlan: number;
  perFlowCaps: Record<string, number>;
}

/** Shared cap resolution for run planning and the decision engine. */
export function resolvePlanningCaps(
  config: AppConfig,
  constraints: ConstraintRow | null,
  flowTypesInScope: Iterable<string> = []
): PlanningCapsContext {
  const perFlowOverrides = normalizePerFlowCaps(constraints?.max_jobs_per_flow_type);
  const perFlowCaps: Record<string, number> = { ...defaultMaxJobsPerFlowType(), ...perFlowOverrides };
  const mimicVideoCap = perFlowOverrides[FLOW_TOP_PERFORMER_MIMIC_VIDEO];
  if (mimicVideoCap != null && mimicVideoCap > 0) {
    for (const ft of TOP_PERFORMER_MIMIC_VIDEO_HEYGEN_FLOWS) {
      perFlowCaps[ft] = Math.max(perFlowCaps[ft] ?? 0, mimicVideoCap);
    }
  }
  for (const ft of flowTypesInScope) {
    if (perFlowCaps[ft] !== undefined) continue;
    if (isTopPerformerMimicFlow(ft)) {
      perFlowCaps[ft] = DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP;
    } else if (isCarouselFlow(ft)) {
      perFlowCaps[ft] = DEFAULT_CAROUSEL_FLOW_PLAN_CAP;
    } else if (isVideoFlow(ft)) {
      perFlowCaps[ft] = DEFAULT_VIDEO_FLOW_PLAN_CAP;
    } else {
      perFlowCaps[ft] = config.DEFAULT_OTHER_FLOW_PLAN_CAP;
    }
  }
  return {
    maxCarouselPlan:
      constraints?.max_carousel_jobs_per_run ?? config.DEFAULT_MAX_CAROUSEL_JOBS_PER_RUN,
    maxVideoPlan: Math.max(
      constraints?.max_video_jobs_per_run ?? config.DEFAULT_MAX_VIDEO_JOBS_PER_RUN,
      mimicVideoCap != null && mimicVideoCap > 0 ? mimicVideoCap : 0
    ),
    perFlowCaps,
  };
}
