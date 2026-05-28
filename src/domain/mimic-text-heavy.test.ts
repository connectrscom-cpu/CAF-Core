import { describe, expect, it } from "vitest";
import {
  deckUsesUnifiedBackgroundPlate,
  isTextOverlayDeckFromGuideline,
  isVisualLedShortCopyDeck,
  nemotronSuggestsTextOnTemplate,
  referenceHasHeavyOnScreenText,
  requiresCopyBeforeVisualMimic,
} from "./mimic-text-heavy.js";
import { classifyMimicMode } from "../services/mimic-mode-classifier.js";
import { FLOW_TOP_PERFORMER_MIMIC_CAROUSEL } from "./top-performer-mimic-flow-types.js";
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

  it("routes visual-led short-copy decks to whole-slide mimic", () => {
    const entry = {
      aesthetic_analysis_json: {
        format_pattern: "mixed",
        deck_visual_system: { overall_aesthetic: "cinematic photo carousel" },
        slides: [
          {
            text_density: "low",
            image_or_photo_role: "photo",
            on_screen_text_transcript: "Hook line",
          },
        ],
      },
    };
    expect(isVisualLedShortCopyDeck(entry)).toBe(true);
    expect(requiresCopyBeforeVisualMimic(entry)).toBe(false);
  });

  it("unifies background plate for listicles and text-overlay decks", () => {
    expect(deckUsesUnifiedBackgroundPlate({ aesthetic_analysis_json: { format_pattern: "listicle" } })).toBe(
      true
    );
    const entry = {
      format_pattern: "mixed",
      deck_visual_system: {
        repeated_template: "centered text over celestial backgrounds; similar layout across slides",
      },
    };
    expect(deckUsesUnifiedBackgroundPlate(entry)).toBe(true);
  });

  it("flags long on-screen transcripts", () => {
    const longText = "x".repeat(201);
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

  it("honors Nemotron text_on_template without per-slide transcripts", () => {
    const entry = {
      format_pattern: "mixed",
      visual_consistency: "Uniform blue backdrop and medieval palette",
      mimic_evaluation: {
        recommended_mode: "text_on_template",
        template_consistency: "uniform",
        background_replicability: "high",
      },
    };
    expect(nemotronSuggestsTextOnTemplate(entry)).toBe(true);
    expect(requiresCopyBeforeVisualMimic(entry)).toBe(true);
    const { mode } = classifyMimicMode(FLOW_TOP_PERFORMER_MIMIC_CAROUSEL, entry);
    expect(mode).toBe("template_bg");
  });

  it("flags text-on-background decks from deck_visual_system when slide transcripts are missing", () => {
    const entry = {
      format_pattern: "mixed (reflective messaging with visual storytelling)",
      deck_visual_system: {
        repeated_template: "centered text over celestial backgrounds; similar layout across slides",
        overall_aesthetic: "dark, celestial, reflective",
      },
      replication_blueprint: {
        steps_to_remake: ["Layer text centrally over the imagery, using white or light colors for contrast."],
      },
    };
    expect(isTextOverlayDeckFromGuideline(entry)).toBe(true);
    expect(requiresCopyBeforeVisualMimic(entry)).toBe(true);
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
