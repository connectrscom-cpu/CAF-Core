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
      mimicCarouselCopyBranch(mimic("carousel_visual"), { render_sequence: "per_slide_visual_mimic" })
    ).toBe("full_bleed");
  });

  it("full_bleed addendum skips long body length targets", () => {
    expect(mimicCarouselUsesFullBodyLengthTargets("full_bleed")).toBe(false);
    expect(mimicCarouselUsesFullBodyLengthTargets("template_bg")).toBe(true);
  });

  it("includes caption-first guidance for full_bleed", () => {
    const text = mimicCarouselCopySystemAddendum("full_bleed");
    expect(text).toContain("caption");
    expect(text).toContain("≤120");
  });
});
