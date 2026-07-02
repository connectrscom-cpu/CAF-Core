import { describe, expect, it } from "vitest";
import { buildCartCreationPayload, normalizeCartItemFlow, resolveCartFlowForIdea } from "./cart-flow-resolve";
import type { ContentCartItem } from "./types";

describe("resolveCartFlowForIdea", () => {
  it("maps CAF recommended carousel text_heavy to FLOW_CAROUSEL", () => {
    const r = resolveCartFlowForIdea(
      { format: "carousel", targetFlowType: "text_heavy", platform: "Instagram" },
      "caf_recommended"
    );
    expect(r.flowTypeRaw).toBe("FLOW_CAROUSEL");
    expect(r.flowDestination).toBe("Carousel");
  });

  it("maps explicit generation strategy to canonical flow", () => {
    const r = resolveCartFlowForIdea(
      { format: "carousel", targetFlowType: "text_heavy", platform: "Instagram" },
      "visual_mimic"
    );
    expect(r.flowTypeRaw).toBe("FLOW_TOP_PERFORMER_MIMIC_CAROUSEL");
  });

  it("preserves explicit FLOW_* on idea row", () => {
    const r = resolveCartFlowForIdea(
      { format: "video", targetFlowType: "FLOW_VID_SCRIPT", platform: "TikTok" },
      "caf_recommended"
    );
    expect(r.flowTypeRaw).toBe("FLOW_VID_SCRIPT");
  });
});

describe("normalizeCartItemFlow", () => {
  it("fixes legacy cart rows that stored execution_profile as flow", () => {
    const item: ContentCartItem = {
      id: "idea_x",
      kind: "idea",
      title: "Test",
      flowDestination: "text heavy",
      flowTypeRaw: "text_heavy",
      format: "carousel",
      generationStrategy: "caf_recommended",
      ideaTargetFlowType: "text_heavy",
    };
    const next = normalizeCartItemFlow(item);
    expect(next.flowTypeRaw).toBe("FLOW_CAROUSEL");
    expect(next.flowDestination).toBe("Carousel");
  });
});

describe("buildCartCreationPayload", () => {
  it("exports normalized creation lines", () => {
    const payload = buildCartCreationPayload("sns", [
      {
        id: "tp_1",
        kind: "top_performer",
        title: "TP",
        flowDestination: "Why mimic",
        flowTypeRaw: "FLOW_WHY_MIMIC_CAROUSEL",
        mimicMode: "why_carousel",
        renderMode: "full_bleed",
      },
    ]);
    expect(payload.items[0]?.flow_type).toBe("FLOW_WHY_MIMIC_CAROUSEL");
    expect(payload.items[0]?.mimic_mode).toBe("why_carousel");
  });
});
