import { describe, expect, it } from "vitest";
import { buildVisualGuidelineEntriesFromInsights } from "./visual-guidelines-pack.js";
import type { EvidenceRowInsightEnrichedRow } from "../repositories/inputs-evidence-insights.js";

function row(p: Partial<EvidenceRowInsightEnrichedRow>): EvidenceRowInsightEnrichedRow {
  return {
    id: "1",
    project_id: "p",
    inputs_import_id: "imp",
    source_evidence_row_id: "99",
    insights_id: "ins_test",
    analysis_tier: "top_performer_carousel",
    pre_llm_score: "0.9",
    llm_model: "gpt",
    why_it_worked: "Clear listicle pacing",
    primary_emotion: null,
    secondary_emotion: null,
    hook_type: null,
    custom_label_1: null,
    custom_label_2: null,
    custom_label_3: null,
    cta_type: null,
    hashtags: null,
    caption_style: null,
    hook_text: null,
    risk_flags_json: [],
    aesthetic_analysis_json: null,
    raw_llm_json: null,
    stored_inspection_media_json: null,
    evidence_performance_review_json: null,
    created_at: "t",
    updated_at: "t",
    evidence_kind: "instagram_post",
    evidence_rating_score: "0.91",
    ...p,
  };
}

describe("buildVisualGuidelineEntriesFromInsights", () => {
  it("extracts replication steps and cues from carousel aesthetic JSON", () => {
    const { entries, cue_strings, cues_by_format } = buildVisualGuidelineEntriesFromInsights(
      [
        row({
          insights_id: "ins_a",
          aesthetic_analysis_json: {
            format_pattern: "listicle",
            visual_consistency: "Muted palette, grid cards",
            replication_blueprint: {
              steps_to_remake: ["Pick 5 tips", "Use 4:5 canvas", "Bold headline"],
              tooling_notes: "Canva",
            },
            deck_visual_system: {
              overall_aesthetic: "editorial minimal",
              repeated_template: "title + bullets",
            },
          },
          evidence_performance_review_json: { version: 1, rating_score: 0.9 },
        }),
      ],
      { max_entries: 5 }
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      insights_id: "ins_a",
      format_pattern: "listicle",
    });
    const rb = entries[0]!.replication_blueprint as { steps_to_remake: string[] };
    expect(rb.steps_to_remake.length).toBeGreaterThanOrEqual(1);
    expect(cue_strings.length).toBeGreaterThan(0);
    expect(cues_by_format.length).toBeGreaterThan(0);
    expect(cues_by_format[0]?.format_key).toBe("listicle");
  });

  it("includes inspection_media from stored_inspection_media_json", () => {
    const { entries } = buildVisualGuidelineEntriesFromInsights([
      row({
        stored_inspection_media_json: {
          tier: "top_performer_carousel",
          items: [
            {
              role: "carousel_slide",
              bucket: "assets",
              object_path: "assets/top_performer_inspection/SNS/imp/row_1/slide_01.jpg",
              public_url: "https://example.com/slide.jpg",
            },
          ],
        },
        aesthetic_analysis_json: { format_pattern: "listicle", why_it_worked: "works" },
      }),
    ]);
    const media = entries[0]?.inspection_media as { folder_prefix?: string; items?: unknown[] };
    expect(media?.items?.length).toBe(1);
    expect(String(media?.folder_prefix ?? "")).toContain("top_performer_inspection");
  });

  it("skips rows with no aesthetic and no why_it_worked", () => {
    const { entries } = buildVisualGuidelineEntriesFromInsights([
      row({ why_it_worked: null, aesthetic_analysis_json: null }),
    ]);
    expect(entries).toHaveLength(0);
  });

  it("propagates mimic_evaluation and slide slice into pack entries", () => {
    const { entries } = buildVisualGuidelineEntriesFromInsights([
      row({
        insights_id: "ins_tarot",
        aesthetic_analysis_json: {
          format_pattern: "mixed",
          visual_consistency: "Uniform blue backdrop; medieval palette across slides",
          deck_visual_system: {
            repeated_template: "centered serif text on shared celestial plate",
          },
          mimic_evaluation: {
            recommended_mode: "text_on_template",
            mode_reason: "Slides share one frame; only overlaid copy changes",
            template_consistency: "uniform",
            background_replicability: "high",
          },
          slides: [
            {
              slide_index: 1,
              text_density: "high",
              image_or_photo_role: "none",
              on_screen_text_transcript: "Card one copy",
            },
            {
              slide_index: 2,
              text_density: "high",
              image_or_photo_role: "none",
              on_screen_text_transcript: "Card two copy",
            },
          ],
        },
      }),
    ]);
    expect(entries).toHaveLength(1);
    const e = entries[0]!;
    const me = e.mimic_evaluation as Record<string, unknown>;
    expect(me?.recommended_mode).toBe("text_on_template");
    const aes = e.aesthetic_analysis_json as Record<string, unknown>;
    expect(aes?.mimic_evaluation).toEqual(me);
    expect(Array.isArray(aes?.slides)).toBe(true);
    expect((aes.slides as unknown[]).length).toBe(2);
  });
});
