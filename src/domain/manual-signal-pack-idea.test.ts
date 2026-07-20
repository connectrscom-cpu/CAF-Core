import { describe, expect, it } from "vitest";
import {
  buildManualSignalPackIdea,
  formatAndProfileForFlow,
  isManualIdeaDestinationAllowed,
} from "./manual-signal-pack-idea.js";
import { signalPackIdeaSchema } from "./signal-pack-ideas-v2.js";

describe("manual-signal-pack-idea", () => {
  it("rejects mimic destinations", () => {
    expect(isManualIdeaDestinationAllowed("FLOW_TOP_PERFORMER_MIMIC_CAROUSEL")).toBe(false);
    expect(isManualIdeaDestinationAllowed("FLOW_WHY_MIMIC_CAROUSEL")).toBe(false);
    expect(isManualIdeaDestinationAllowed("FLOW_CAROUSEL")).toBe(true);
  });

  it("maps visual-first and video flows", () => {
    expect(formatAndProfileForFlow("FLOW_VISUAL_FIRST_CAROUSEL").carousel_style).toBe("visual_first");
    expect(formatAndProfileForFlow("FLOW_VID_HOOK_FIRST").video_style).toBe("hook_first");
    expect(formatAndProfileForFlow("FLOW_LINKEDIN_TEXT_POST").defaultPlatform).toBe("LinkedIn");
  });

  it("builds a schema-valid idea with target_flow_type", () => {
    const idea = buildManualSignalPackIdea({
      title: "Why sleep scores lie",
      concept: "A carousel that reframes wearable sleep scores as directional, not absolute.",
      target_flow_type: "FLOW_VISUAL_FIRST_CAROUSEL",
      platform: "Instagram",
      content_lens: "niche",
    });
    const parsed = signalPackIdeaSchema.safeParse(idea);
    expect(parsed.success).toBe(true);
    expect(idea.target_flow_type).toBe("FLOW_VISUAL_FIRST_CAROUSEL");
    expect(idea.source).toBe("manual");
    expect(idea.id.startsWith("manual_")).toBe(true);
    expect(idea.grounding_insight_ids[0]).toContain("manual_");
  });

  it("requires title and destination", () => {
    expect(() =>
      buildManualSignalPackIdea({ title: "", target_flow_type: "FLOW_CAROUSEL" })
    ).toThrow(/title_required/);
    expect(() =>
      buildManualSignalPackIdea({
        title: "X",
        target_flow_type: "FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
      })
    ).toThrow(/invalid_destination/);
  });
});
