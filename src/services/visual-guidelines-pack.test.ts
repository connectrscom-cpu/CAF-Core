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
    const { entries, cue_strings } = buildVisualGuidelineEntriesFromInsights(
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
  });

  it("skips rows with no aesthetic and no why_it_worked", () => {
    const { entries } = buildVisualGuidelineEntriesFromInsights([
      row({ why_it_worked: null, aesthetic_analysis_json: null }),
    ]);
    expect(entries).toHaveLength(0);
  });
});
