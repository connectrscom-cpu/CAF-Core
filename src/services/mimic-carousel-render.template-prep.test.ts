import { describe, expect, it } from "vitest";
import {
  buildFullBleedConsistencyHint,
  slideIndicesForTemplateBgPrep,
} from "./mimic-carousel-render.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";

describe("slideIndicesForTemplateBgPrep", () => {
  it("requests cover, body, and cta for long decks", () => {
    expect(slideIndicesForTemplateBgPrep(8)).toEqual([1, 2, 8]);
  });

  it("requests cover and body for two-slide decks", () => {
    expect(slideIndicesForTemplateBgPrep(2)).toEqual([1, 2]);
  });
});

describe("buildFullBleedConsistencyHint", () => {
  it("includes deck consistency and previous slide palette", () => {
    const mimic: MimicPayloadV1 = {
      schema_version: 1,
      mode: "carousel_visual",
      classified_at: "",
      source_insights_id: "ins",
      source_evidence_row_id: null,
      analysis_tier: "top_performer_carousel",
      reference_items: [{ index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg" }],
      twist_brief: { visual_only: true, legal_note: "" },
      visual_guideline: {
        visual_consistency: "Warm muted palette across slides",
        deck_visual_system: { overall_aesthetic: "cinematic lifestyle" },
        slides: [
          {
            slide_index: 1,
            color_tokens: { background: "warm brown", primary_text: "#fff", photo_grade: "warm" },
          },
        ],
      },
    };
    const hint = buildFullBleedConsistencyHint(mimic, 2);
    expect(hint).toContain("Warm muted palette");
    expect(hint).toContain("warm brown");
  });

  it("skips palette lock hints at bold-variant similarity (≤25%)", () => {
    const mimic: MimicPayloadV1 = {
      schema_version: 1,
      mode: "carousel_visual",
      classified_at: "",
      source_insights_id: "ins",
      source_evidence_row_id: null,
      analysis_tier: "top_performer_carousel",
      reference_items: [{ index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg" }],
      twist_brief: { visual_only: true, legal_note: "" },
      visual_guideline: {
        visual_consistency: "Warm muted palette across slides",
        deck_visual_system: { overall_aesthetic: "cinematic lifestyle" },
        slides: [
          {
            slide_index: 1,
            color_tokens: { background: "warm brown", primary_text: "#fff", photo_grade: "warm" },
          },
        ],
      },
    };
    expect(buildFullBleedConsistencyHint(mimic, 2, 10)).toBe("");
  });
});
