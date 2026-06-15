import { describe, expect, it } from "vitest";
import {
  assertRenderNotPaused,
  beginRenderActivity,
  endRenderActivity,
  getRenderControlSnapshot,
  pauseRendering,
  resumeRendering,
} from "./render-control.js";
import { RenderNotReadyError } from "../domain/render-not-ready-error.js";

describe("render-control", () => {
  it("pause blocks new work via RenderNotReadyError", () => {
    resumeRendering();
    pauseRendering();
    expect(() => assertRenderNotPaused()).toThrow(RenderNotReadyError);
    resumeRendering();
    expect(() => assertRenderNotPaused()).not.toThrow();
  });

  it("tracks active render activities", () => {
    resumeRendering();
    beginRenderActivity({
      task_id: "SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1",
      run_id: "SNS_2026W09",
      flow_type: "FLOW_CAROUSEL",
      kind: "carousel",
      phase: "slide 1/5",
      slide_index: 1,
      slide_total: 5,
    });
    const snap = getRenderControlSnapshot();
    expect(snap.active).toHaveLength(1);
    expect(snap.active[0]?.phase).toBe("slide 1/5");
    endRenderActivity("SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1");
    expect(getRenderControlSnapshot().active).toHaveLength(0);
  });
});
