import { describe, expect, it } from "vitest";
import { FLOW_TOP_PERFORMER_MIMIC_CAROUSEL } from "../domain/top-performer-mimic-flow-types.js";
import { resolvePlanningCaps } from "./planning-caps.js";
import {
  DEFAULT_CAROUSEL_FLOW_PLAN_CAP,
  DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP,
} from "./default-plan-caps.js";

describe("resolvePlanningCaps", () => {
  it("assigns mimic default cap to mimic carousel, not regular carousel default", () => {
    const caps = resolvePlanningCaps(
      { DEFAULT_OTHER_FLOW_PLAN_CAP: 1 } as never,
      null,
      [FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, "FLOW_CAROUSEL"]
    );
    expect(caps.perFlowCaps[FLOW_TOP_PERFORMER_MIMIC_CAROUSEL]).toBe(
      DEFAULT_TOP_PERFORMER_MIMIC_FLOW_PLAN_CAP
    );
    expect(caps.perFlowCaps.FLOW_CAROUSEL).toBe(DEFAULT_CAROUSEL_FLOW_PLAN_CAP);
  });
});
