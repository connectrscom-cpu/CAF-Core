import { describe, expect, it } from "vitest";
import { buildMarketIntelligenceV1 } from "./market-intelligence-synthesis.js";
import type { SynthesisInsightRowInput } from "./market-intelligence-synthesis.js";

function row(partial: Partial<SynthesisInsightRowInput> & Pick<SynthesisInsightRowInput, "id" | "insights_id">): SynthesisInsightRowInput {
  return {
    project_slug: "sns",
    inputs_import_id: "imp-1",
    signal_pack_id: "pack-1",
    run_id: null,
    evidence_post_format: "video",
    analysis_tier: "broad_llm",
    source_evidence_row_id: partial.id,
    evidence_kind: "instagram_post",
    pre_llm_score: "0.72",
    why_it_worked: partial.why_it_worked ?? "Strong hook drives comments.",
    primary_emotion: partial.primary_emotion ?? "curiosity",
    secondary_emotion: null,
    hook_type: partial.hook_type ?? "question",
    hook_text: partial.hook_text ?? "Which sign is lying?",
    hashtags: null,
    caption_style: null,
    cta_type: null,
    custom_label_1: null,
    custom_label_2: null,
    custom_label_3: null,
    aesthetic_analysis_json: null,
    risk_flags_json: partial.risk_flags_json ?? [],
    created_at: "2026-06-01T00:00:00Z",
    ...partial,
  };
}

describe("market-intelligence-synthesis", () => {
  it("clusters hook rows into patterns with evidence_count > 1", () => {
    const v1 = buildMarketIntelligenceV1({
      insightRows: [
        row({ id: "1", insights_id: "ins_1", hook_type: "question", hook_text: "Which sign cheats?" }),
        row({ id: "2", insights_id: "ins_2", hook_type: "question", hook_text: "Which sign is toxic?" }),
        row({ id: "3", insights_id: "ins_3", hook_type: "bold_claim", hook_text: "Gemini always wins" }),
      ],
    });
    expect(v1.hooks.length).toBeGreaterThanOrEqual(1);
    const clustered = v1.hooks.find((h) => h.evidence_count >= 2);
    expect(clustered).toBeTruthy();
    expect(clustered!.summary.toLowerCase()).toContain("seen across");
  });

  it("uses risk flag text for avoid patterns, not why_it_worked", () => {
    const v1 = buildMarketIntelligenceV1({
      insightRows: [
        row({
          id: "9",
          insights_id: "ins_9",
          why_it_worked: "Excellent viral video with stunning visuals.",
          risk_flags_json: ["oversaturated zodiac listicle angle"],
        }),
      ],
    });
    expect(v1.avoid.length).toBe(1);
    expect(v1.avoid[0]!.summary.toLowerCase()).toContain("oversaturated");
    expect(v1.avoid[0]!.summary.toLowerCase()).not.toContain("excellent");
  });

  it("top performer rows are not classified as avoid even with risk flags", () => {
    const v1 = buildMarketIntelligenceV1({
      insightRows: [
        row({
          id: "tp1",
          insights_id: "ins_tp1",
          analysis_tier: "top_performer_video",
          why_it_worked: "Meme-style hook with fast payoff.",
          risk_flags_json: ["minor brand safety note"],
        }),
      ],
    });
    expect(v1.avoid.length).toBe(0);
    expect(v1.winning_patterns.length).toBeGreaterThanOrEqual(1);
  });

  it("builds executive summary from aggregated patterns", () => {
    const v1 = buildMarketIntelligenceV1({
      insightRows: [
        row({ id: "1", insights_id: "ins_1", primary_emotion: "curiosity" }),
        row({ id: "2", insights_id: "ins_2", primary_emotion: "curiosity" }),
        row({ id: "3", insights_id: "ins_3", primary_emotion: "nostalgia" }),
      ],
    });
    expect(v1.executive_summary.length).toBeGreaterThan(0);
    expect(v1.total_patterns).toBeGreaterThan(0);
  });
});
