import { describe, expect, it } from "vitest";
import type { EvidenceRowInsightEnrichedRow } from "../repositories/inputs-evidence-insights.js";
import {
  budgetInsightContextForIdeasLlm,
  compactTopPerformerStylesForIdeasLlm,
  extractNemotronAnalysisForIdeasLlm,
  type IdeasLlmInsightContextRow,
} from "./ideas-from-insights-llm.js";

function tpRow(overrides: Partial<EvidenceRowInsightEnrichedRow> = {}): EvidenceRowInsightEnrichedRow {
  return {
    id: "1",
    project_id: "p",
    inputs_import_id: "imp",
    source_evidence_row_id: "42",
    insights_id: "ins_42",
    analysis_tier: "top_performer_carousel",
    pre_llm_score: "0.9",
    llm_model: "gpt-4o-mini",
    why_it_worked: "Strong hook",
    primary_emotion: "curiosity",
    secondary_emotion: null,
    hook_type: "question",
    custom_label_1: null,
    custom_label_2: null,
    custom_label_3: null,
    cta_type: "comment",
    hashtags: "#astrology #zodiac",
    caption_style: "short",
    hook_text: "Did you know?",
    risk_flags_json: ["policy_risk"],
    aesthetic_analysis_json: null,
    raw_llm_json: null,
    stored_inspection_media_json: null,
    evidence_performance_review_json: null,
    created_at: "",
    updated_at: "",
    evidence_kind: "instagram_carousel",
    evidence_rating_score: "0.88",
    ...overrides,
  };
}

describe("extractNemotronAnalysisForIdeasLlm", () => {
  it("keeps Nemotron deck cues and compact slides; drops Document AI and mimic blobs", () => {
    const slim = extractNemotronAnalysisForIdeasLlm(
      {
        format_pattern: "listicle",
        slide_arc: "Hook → list → CTA",
        deck_as_whole_summary: "Clean educational deck",
        mimic_evaluation: { recommended_mode: "text_on_template", mode_reason: "x".repeat(5000) },
        deck_visual_system: { overall_aesthetic: "y".repeat(5000) },
        replication_blueprint: { steps_to_remake: ["a".repeat(3000)] },
        document_ai_deck_v1: { slides: [{ full_text: "huge".repeat(3000) }] },
        slides: [
          {
            slide_index: 1,
            slide_purpose: "hook",
            visual_description: "Bold headline on gradient",
            on_screen_text_transcript: "5 signs you're a Leo",
            composition_blueprint: { elements: [{ description: "z".repeat(8000) }] },
            document_ai_ocr_v1: { full_text: "ocr".repeat(2000) },
          },
        ],
      },
      "top_performer_carousel"
    );
    expect(slim.format_pattern).toBe("listicle");
    expect(slim.deck_as_whole_summary).toBe("Clean educational deck");
    expect(slim.mimic_evaluation).toBeUndefined();
    expect(slim.deck_visual_system).toBeUndefined();
    expect(slim.document_ai_deck_v1).toBeUndefined();
    expect(Array.isArray(slim.slides)).toBe(true);
    expect((slim.slides as Record<string, unknown>[])[0]?.composition_blueprint).toBeUndefined();
    expect((slim.slides as Record<string, unknown>[])[0]?.document_ai_ocr_v1).toBeUndefined();
    expect(JSON.stringify(slim).length).toBeLessThan(1500);
  });

  it("keeps Nemotron video fields without render systems", () => {
    const slim = extractNemotronAnalysisForIdeasLlm(
      {
        format_pattern: "story",
        video_arc: "Open loop then payoff",
        style_summary: "Fast cuts, warm palette",
        video_visual_system: { overall_aesthetic: "x".repeat(4000) },
        frames: [{ frame_index: 1, visual_description: "Close-up face", spoken_text: "Wait for it" }],
      },
      "top_performer_video"
    );
    expect(slim.video_arc).toBe("Open loop then payoff");
    expect(slim.video_visual_system).toBeUndefined();
    expect(Array.isArray(slim.frames)).toBe(true);
  });
});

describe("compactTopPerformerStylesForIdeasLlm", () => {
  it("sends insight row fields plus nemotron_analysis only", () => {
    const styles = compactTopPerformerStylesForIdeasLlm([
      tpRow({
        aesthetic_analysis_json: {
          format_pattern: "educational",
          slides: [{ slide_index: 1, slide_purpose: "hook", visual_description: "z".repeat(20_000) }],
          document_ai_deck_v1: { slides: [] },
        },
        evidence_performance_review_json: {
          rating_score: 0.91,
          rating_components_json: { hook_strength: 0.9, retention: 0.85 },
          rating_rationale: "r".repeat(2000),
        },
      }),
    ]);
    expect(styles).not.toBeNull();
    expect(styles!.insights_id).toBe("ins_42");
    expect(styles!.why_it_worked).toBe("Strong hook");
    expect(styles!.hashtags).toBe("#astrology #zodiac");
    expect(styles!.risk_flags).toEqual(["policy_risk"]);
    expect(styles!.aesthetic_analysis_json).toBeUndefined();
    expect(styles!.visual_cues).toBeUndefined();
    expect(styles!.nemotron_analysis).toMatchObject({ format_pattern: "educational" });
    expect((styles!.nemotron_analysis as { slides?: unknown[] }).slides?.[0]).toMatchObject({
      slide_index: 1,
      slide_purpose: "hook",
    });
    expect(String(styles!.evidence_performance_review?.rating_rationale ?? "").length).toBeLessThanOrEqual(401);
  });
});

describe("budgetInsightContextForIdeasLlm", () => {
  it("drops lowest-priority rows when JSON exceeds the char budget", () => {
    const heavyRow = (id: string): IdeasLlmInsightContextRow => ({
      source_evidence_row_id: id,
      evidence_kind: "instagram_carousel",
      evidence_rating: 0.5,
      grounding_insight_ids: [`ins_${id}`],
      broad: { why_it_worked: "w".repeat(4000) },
      top_performer_styles: null,
    });
    const context = Array.from({ length: 80 }, (_, i) => heavyRow(String(i + 1)));
    const budgeted = budgetInsightContextForIdeasLlm(context, {
      maxJsonChars: 12_000,
      minRows: 5,
      maxStringFieldChars: 800,
    });
    expect(budgeted.length).toBeLessThan(80);
    expect(budgeted.length).toBeGreaterThanOrEqual(5);
    expect(JSON.stringify(budgeted).length).toBeLessThanOrEqual(12_000);
    expect(budgeted[0]?.source_evidence_row_id).toBe("1");
  });
});
