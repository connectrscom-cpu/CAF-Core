import { describe, expect, it } from "vitest";
import { CANONICAL_FLOW_TYPES } from "../domain/canonical-flow-types.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_VIDEO,
} from "../domain/top-performer-mimic-flow-types.js";
import { resolvePlanningCaps } from "./planning-caps.js";
import {
  DEFAULT_CAROUSEL_FLOW_PLAN_CAP,
  DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP,
} from "./default-plan-caps.js";

describe("resolvePlanningCaps", () => {
  it("assigns mimic default cap to mimic carousel, not regular carousel default", () => {
    const caps = resolvePlanningCaps(
      { DEFAULT_OTHER_FLOW_PLAN_CAP: 1, DEFAULT_MAX_VIDEO_JOBS_PER_RUN: 4 } as never,
      null,
      [FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, "FLOW_CAROUSEL"]
    );
    expect(caps.perFlowCaps[FLOW_TOP_PERFORMER_MIMIC_CAROUSEL]).toBe(
      DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP
    );
    expect(caps.perFlowCaps.FLOW_CAROUSEL).toBe(DEFAULT_CAROUSEL_FLOW_PLAN_CAP);
  });

  it("propagates mimic video cap to HeyGen flow types and aggregate video plan", () => {
    const caps = resolvePlanningCaps(
      { DEFAULT_OTHER_FLOW_PLAN_CAP: 1, DEFAULT_MAX_VIDEO_JOBS_PER_RUN: 0 } as never,
      {
        max_jobs_per_flow_type: { [FLOW_TOP_PERFORMER_MIMIC_VIDEO]: 3 },
        max_video_jobs_per_run: 0,
      } as never,
      [CANONICAL_FLOW_TYPES.VID_PROMPT]
    );
    expect(caps.perFlowCaps[CANONICAL_FLOW_TYPES.VID_PROMPT]).toBe(3);
    expect(caps.perFlowCaps[CANONICAL_FLOW_TYPES.VID_SCRIPT]).toBe(3);
    expect(caps.perFlowCaps[CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR]).toBe(3);
    expect(caps.maxVideoPlan).toBe(3);
  });
});
