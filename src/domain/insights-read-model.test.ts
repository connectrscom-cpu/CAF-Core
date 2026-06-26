import { describe, expect, it } from "vitest";
import { buildInsightReadModelItem, deriveInsightReadType } from "./insights-read-model.js";

describe("insights-read-model", () => {
  it("classifies top_performer tier", () => {
    expect(
      deriveInsightReadType({
        analysis_tier: "top_performer_deep",
        hook_type: null,
        hook_text: null,
        primary_emotion: null,
        aesthetic_analysis_json: null,
        risk_flags_json: [],
        hashtags: null,
        cta_type: null,
      })
    ).toBe("top_performer");
  });

  it("prefers risk when flags present on broad tier", () => {
    expect(
      deriveInsightReadType({
        analysis_tier: "broad_llm",
        hook_type: "question",
        hook_text: "Hi",
        primary_emotion: "joy",
        aesthetic_analysis_json: null,
        risk_flags_json: ["weak_cta"],
        hashtags: null,
        cta_type: null,
      })
    ).toBe("risk_or_warning");
  });

  it("keeps top_performer tier even when risk flags present", () => {
    expect(
      deriveInsightReadType({
        analysis_tier: "top_performer_video",
        hook_type: null,
        hook_text: null,
        primary_emotion: null,
        aesthetic_analysis_json: null,
        risk_flags_json: ["minor_issue"],
        hashtags: null,
        cta_type: null,
      })
    ).toBe("top_performer");
  });

  it("risk summary uses risk flags not why_it_worked", () => {
    const item = buildInsightReadModelItem({
      project_slug: "sns",
      inputs_import_id: "imp",
      signal_pack_id: null,
      run_id: null,
      evidence_post_format: "video",
      id: "2",
      insights_id: "ins_r",
      analysis_tier: "broad_llm",
      source_evidence_row_id: "99",
      evidence_kind: "instagram_post",
      pre_llm_score: "0.5",
      why_it_worked: "Great engagement and visuals.",
      primary_emotion: "joy",
      secondary_emotion: null,
      hook_type: "question",
      hook_text: "Why?",
      hashtags: null,
      caption_style: null,
      cta_type: null,
      custom_label_1: null,
      custom_label_2: null,
      custom_label_3: null,
      aesthetic_analysis_json: null,
      risk_flags_json: ["oversaturated topic"],
      created_at: "2026-01-02T00:00:00Z",
    });
    expect(item.type).toBe("risk_or_warning");
    expect(item.summary).toContain("oversaturated");
    expect(item.summary).not.toContain("Great engagement");
  });

  it("builds strategic object from broad row", () => {
    const item = buildInsightReadModelItem({
      project_slug: "sns",
      inputs_import_id: "imp",
      signal_pack_id: null,
      run_id: null,
      evidence_post_format: "carousel",
      id: "1",
      insights_id: "ins_x",
      analysis_tier: "broad_llm",
      source_evidence_row_id: "42",
      evidence_kind: "instagram_post",
      pre_llm_score: "0.8",
      why_it_worked: "Strong pattern interrupt in the first line.",
      primary_emotion: "curiosity",
      secondary_emotion: null,
      hook_type: "confession",
      hook_text: "I almost quit…",
      hashtags: "#growth",
      caption_style: "short",
      cta_type: "comment",
      custom_label_1: null,
      custom_label_2: null,
      custom_label_3: null,
      aesthetic_analysis_json: null,
      risk_flags_json: [],
      created_at: "2026-01-02T00:00:00Z",
    });
    expect(item.supporting_evidence_ids).toEqual(["42"]);
    expect(item.formats).toEqual(["carousel"]);
    expect(item.confidence).toBeCloseTo(0.8);
    expect(item.title.length).toBeGreaterThan(3);
  });
});
