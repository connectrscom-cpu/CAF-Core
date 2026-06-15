import { describe, expect, it } from "vitest";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  mimicCarouselCopyBranch,
  mimicCarouselCopySystemAddendum,
  mimicCarouselUsesFullBodyLengthTargets,
} from "./carousel-mimic-copy-policy.js";

function mimic(mode: MimicPayloadV1["mode"]): MimicPayloadV1 {
  return {
    schema_version: 1,
    mode,
    classified_at: "",
    source_insights_id: "ins",
    source_evidence_row_id: null,
    analysis_tier: "top_performer_carousel",
    reference_items: [{ index: 1, role: "carousel_slide", vision_fetch_url: "https://x/a.jpg" }],
    twist_brief: { visual_only: true, legal_note: "" },
  };
}

describe("mimicCarouselCopyBranch", () => {
  it("returns template_bg for template mode", () => {
    expect(mimicCarouselCopyBranch(mimic("template_bg"), null)).toBe("template_bg");
  });

  it("returns full_bleed for carousel_visual", () => {
    expect(
      mimicCarouselCopyBranch(mimic("carousel_visual"), {
        render_sequence: "visual_plate_then_hbs_overlay",
      })
    ).toBe("full_bleed");
  });

  it("mimic branches do not use long body length targets", () => {
    expect(mimicCarouselUsesFullBodyLengthTargets("full_bleed")).toBe(false);
    expect(mimicCarouselUsesFullBodyLengthTargets("template_bg")).toBe(false);
  });

  it("includes visual plate + overlay guidance for full_bleed", () => {
    const text = mimicCarouselCopySystemAddendum("full_bleed");
    expect(text).toContain("visual plate");
    expect(text).toContain("slide_copy_layout");
    expect(text).toContain("Semantic fidelity");
    expect(text).toContain("taurus as food");
    expect(text).not.toContain("≤120");
  });

  it("template_bg addendum requires per-slide semantic fidelity", () => {
    const text = mimicCarouselCopySystemAddendum("template_bg");
    expect(text).toContain("reference_on_screen_text");
    expect(text).toContain("same idea, subject, and list item");
  });
});
