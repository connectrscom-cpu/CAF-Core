import { describe, expect, it } from "vitest";
import { buildImmediateNeedsEditGenerationGuidance } from "./immediate-needs-edit-guidance.js";

describe("buildImmediateNeedsEditGenerationGuidance", () => {
  it("returns null when there is no signal", () => {
    const r = buildImmediateNeedsEditGenerationGuidance({
      task_id: "T1",
      flow_type: "FLOW_CAROUSEL",
      platform: "Instagram",
      notes: " ",
      rejection_tags: [],
    });
    expect(r).toBeNull();
  });

  it("turns common tags into concrete guidance lines", () => {
    const r = buildImmediateNeedsEditGenerationGuidance({
      task_id: "RUN002__IG__CAROUSEL__r0019__v2",
      flow_type: "FLOW_CAROUSEL",
      platform: "Instagram",
      carousel_template_name: "carousel_horoscope_doodle_collage",
      notes: "Doesn't end with a CTA; double handle issue",
      rejection_tags: ["cta_weak", "bad_structure"],
    });
    expect(r?.rule_id).toMatch(/^immediate_needs_edit_[0-9a-f]{8}$/);
    expect(r?.guidance).toContain("Immediate rework guidance");
    expect(r?.guidance).toContain("final slide is an explicit CTA");
    expect(r?.guidance).toContain("Rebuild the carousel arc");
    expect(r?.guidance).toContain("reviewer notes");
  });
});

