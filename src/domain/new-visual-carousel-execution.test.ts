import { describe, expect, it } from "vitest";
import {
  buildNewVisualSlidePlans,
  inferNewVisualTargetSlideCount,
  isNewVisualCarouselExecution,
  isNewVisualMimicPayload,
  staleNewVisualCarouselPayload,
} from "./new-visual-carousel-execution.js";

describe("new-visual-carousel-execution", () => {
  it("infers slide count from key_points", () => {
    expect(
      inferNewVisualTargetSlideCount({
        key_points: ["a", "b", "c"],
      })
    ).toBe(5);
  });

  it("detects new visual execution from flow type", () => {
    expect(isNewVisualCarouselExecution("FLOW_VISUAL_FIRST_CAROUSEL", null)).toBe(true);
    expect(
      isNewVisualCarouselExecution("FLOW_TOP_PERFORMER_MIMIC_CAROUSEL", {
        execution_mode: "new_visual",
      } as never)
    ).toBe(true);
    expect(isNewVisualCarouselExecution("FLOW_TOP_PERFORMER_MIMIC_CAROUSEL", null)).toBe(false);
  });

  it("flags legacy TP mimic payloads as stale for new visual lane", () => {
    expect(staleNewVisualCarouselPayload(null)).toBe(true);
    expect(
      staleNewVisualCarouselPayload({
        execution_mode: "new_visual",
        mode: "carousel_visual",
        reference_items: [],
      } as never)
    ).toBe(false);
    expect(
      staleNewVisualCarouselPayload({
        execution_mode: "classic",
        mode: "template_bg",
        reference_items: [{ index: 1, role: "ref", vision_fetch_url: "https://x" }],
      } as never)
    ).toBe(true);
  });

  it("builds full_bleed slide plans", () => {
    const plans = buildNewVisualSlidePlans(3);
    expect(plans).toHaveLength(3);
    expect(plans.every((p) => p.render_mode === "full_bleed")).toBe(true);
  });

  it("detects new visual mimic payload without execution_mode", () => {
    expect(
      isNewVisualMimicPayload({
        mode: "carousel_visual",
        reference_items: [],
      } as never)
    ).toBe(true);
  });
});
