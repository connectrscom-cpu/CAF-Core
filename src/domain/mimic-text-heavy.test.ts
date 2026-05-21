import { describe, expect, it } from "vitest";
import {
  MIMIC_ON_SCREEN_TEXT_CHAR_THRESHOLD,
  referenceHasHeavyOnScreenText,
  requiresCopyBeforeVisualMimic,
} from "./mimic-text-heavy.js";
import { buildMimicRenderContextForLlm } from "./mimic-render-context.js";
import type { MimicPayloadV1 } from "./mimic-payload.js";

describe("mimic-text-heavy", () => {
  it("flags listicle format", () => {
    expect(
      requiresCopyBeforeVisualMimic({
        aesthetic_analysis_json: { format_pattern: "listicle", slides: [] },
      })
    ).toBe(true);
  });

  it("flags long on-screen transcripts", () => {
    const longText = "x".repeat(MIMIC_ON_SCREEN_TEXT_CHAR_THRESHOLD);
    expect(
      requiresCopyBeforeVisualMimic({
        aesthetic_analysis_json: {
          format_pattern: "mixed",
          slides: [{ on_screen_text_transcript: longText, text_density: "medium" }],
        },
      })
    ).toBe(true);
    expect(referenceHasHeavyOnScreenText([{ on_screen_text_transcript: longText }])).toBe(true);
  });
});

describe("buildMimicRenderContextForLlm", () => {
  it("marks copy-before-mimic for template_bg", () => {
    const mimic: MimicPayloadV1 = {
      schema_version: 1,
      mode: "template_bg",
      classified_at: "2026-01-01T00:00:00.000Z",
      source_insights_id: "ins_a",
      analysis_tier: "top_performer_carousel",
      reference_items: [
        { index: 1, role: "carousel_slide", vision_fetch_url: "https://x/1.jpg" },
        { index: 2, role: "carousel_slide", vision_fetch_url: "https://x/2.jpg" },
      ],
      twist_brief: { visual_only: true, legal_note: "pattern only" },
    };
    const ctx = buildMimicRenderContextForLlm(mimic, {
      aesthetic_analysis_json: { format_pattern: "listicle", slides: [{}, {}] },
    });
    expect(ctx.copy_before_visual_mimic).toBe(true);
    expect(ctx.target_slide_count).toBe(2);
    expect(ctx.render_sequence).toBe("copy_then_template_overlay");
  });
});
