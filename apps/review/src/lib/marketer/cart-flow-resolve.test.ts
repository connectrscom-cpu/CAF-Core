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

  it("maps linkedin_text format to FLOW_LINKEDIN_TEXT_POST", () => {
    const r = resolveCartFlowForIdea(
      { format: "linkedin_text", targetFlowType: "", platform: "LinkedIn" },
      "caf_recommended"
    );
    expect(r.flowTypeRaw).toBe("FLOW_LINKEDIN_TEXT_POST");
  });

  it("maps linkedin_document format to FLOW_LINKEDIN_DOCUMENT_POST", () => {
    const r = resolveCartFlowForIdea(
      { format: "linkedin_document", targetFlowType: "", platform: "LinkedIn" },
      "caf_recommended"
    );
    expect(r.flowTypeRaw).toBe("FLOW_LINKEDIN_DOCUMENT_POST");
  });

  it("maps reddit_post format to FLOW_REDDIT_POST", () => {
    const r = resolveCartFlowForIdea(
      { format: "reddit_post", targetFlowType: "", platform: "Reddit" },
      "caf_recommended"
    );
    expect(r.flowTypeRaw).toBe("FLOW_REDDIT_POST");
  });

  it("maps instagram_thread format to FLOW_INSTAGRAM_THREAD", () => {
    const r = resolveCartFlowForIdea(
      { format: "instagram_thread", targetFlowType: "", platform: "Instagram" },
      "caf_recommended"
    );
    expect(r.flowTypeRaw).toBe("FLOW_INSTAGRAM_THREAD");
  });

  it("maps generic post and thread to FLOW_TEXT", () => {
    expect(
      resolveCartFlowForIdea({ format: "post", targetFlowType: "", platform: "LinkedIn" }, "caf_recommended")
        .flowTypeRaw
    ).toBe("FLOW_TEXT");
    expect(
      resolveCartFlowForIdea({ format: "thread", targetFlowType: "", platform: "Instagram" }, "caf_recommended")
        .flowTypeRaw
    ).toBe("FLOW_TEXT");
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
