import { describe, expect, it } from "vitest";
import { cartTargetFlowTypesFromPlannerRows } from "./project-config.js";

describe("cartTargetFlowTypesFromPlannerRows", () => {
  it("collects unique target_flow_type values from planner rows", () => {
    expect(
      cartTargetFlowTypesFromPlannerRows([
        { target_flow_type: "FLOW_VID_HOOK_FIRST" },
        { target_flow_type: "FLOW_CAROUSEL" },
        { target_flow_type: "FLOW_VID_HOOK_FIRST" },
        { manual_mimic_pick: true, target_flow_type: "FLOW_VID_PROMPT" },
        { format: "carousel" },
      ]).sort()
    ).toEqual(
      ["FLOW_CAROUSEL", "FLOW_VID_HOOK_FIRST", "FLOW_VID_PROMPT"].sort()
    );
  });
});
