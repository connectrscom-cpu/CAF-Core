import { describe, expect, it } from "vitest";
import { buildMarketIntelligenceV1 } from "../domain/market-intelligence-synthesis.js";
import type { SynthesisInsightRowInput } from "../domain/market-intelligence-synthesis.js";
import { applyResearchBriefLlmOutput, compactInsightsForBrief, stratifiedSampleByPlatform } from "./market-intelligence-brief-llm.js";

function row(partial: Partial<SynthesisInsightRowInput> & Pick<SynthesisInsightRowInput, "id" | "insights_id">): SynthesisInsightRowInput {
  return {
    project_slug: "sns",
    inputs_import_id: "imp-1",
    signal_pack_id: "pack-1",
    run_id: null,
    evidence_post_format: "carousel",
    analysis_tier: "broad_llm",
    source_evidence_row_id: partial.id,
    evidence_kind: "instagram_post",
    pre_llm_score: "0.8",
    why_it_worked: "Strong hook.",
    primary_emotion: "curiosity",
    secondary_emotion: null,
    hook_type: "question",
    hook_text: "Which sign?",
    hashtags: null,
    caption_style: null,
    cta_type: null,
    custom_label_1: null,
    custom_label_2: null,
    custom_label_3: null,
    aesthetic_analysis_json: null,
    risk_flags_json: [],
    created_at: "2026-06-01T00:00:00Z",
    ...partial,
  };
}

describe("applyResearchBriefLlmOutput", () => {
  it("merges LLM copy while preserving evidence metadata", () => {
    const draft = buildMarketIntelligenceV1({
      insightRows: [
        row({ id: "1", insights_id: "ins_1", hook_type: "question" }),
        row({ id: "2", insights_id: "ins_2", hook_type: "question" }),
      ],
    });
    const hook = draft.hooks[0];
    expect(hook).toBeTruthy();

    const merged = applyResearchBriefLlmOutput(draft, {
      research_brief_title: "Instagram · question hooks · Jun 2026",
      market_overview: "Astrology creators on Instagram compete for saves with curiosity-led carousel hooks.",
      what_worked: "Question hooks on cover slides consistently outperformed statement hooks.",
      executive_summary: [
        "Lead with curiosity hooks on carousel cover slides.",
        "Numbered list formats drive the most saves in this niche.",
        "Humor plus zodiac specificity beats generic horoscope copy.",
      ],
      action_playbook: ["Test a ranking carousel with a question cover hook."],
      patterns: [
        {
          id: hook!.id,
          title: "Question hooks on cover slides",
          summary: "What: Direct zodiac questions on slide 1. Why it works: sparks debate in comments. Apply: use on your next carousel cover.",
        },
      ],
      top_performer_highlights: [
        {
          insights_id: "ins_tp_1",
          title: "Zodiac ranking carousel",
          platform: "Instagram",
          format: "carousel",
          summary: "Uses bold cover question and numbered slides to drive shares.",
          apply_this: "Mirror the numbered arc with your brand voice.",
        },
      ],
    });

    expect(merged.llm_polished).toBe(true);
    expect(merged.research_brief_title).toContain("Instagram");
    expect(merged.market_overview).toContain("Astrology");
    expect(merged.what_worked).toContain("Question hooks");
    expect(merged.executive_summary).toHaveLength(3);
    expect(merged.action_playbook?.[0]).toContain("ranking carousel");
    const patched = merged.hooks.find((h) => h.id === hook!.id);
    expect(patched?.title).toBe("Question hooks on cover slides");
    expect(patched?.evidence_count).toBe(hook!.evidence_count);
    expect(merged.top_performer_highlights?.[0]?.apply_this).toContain("numbered arc");
  });

  it("merges competitive landscape when handles match rollup", () => {
    const draft = buildMarketIntelligenceV1({
      insightRows: [
        row({ id: "1", insights_id: "ins_1", creator: "astroqueen", hook_text: "Which sign lies?" }),
        row({ id: "2", insights_id: "ins_2", creator: "astroqueen", hook_text: "Rank these signs" }),
      ],
    });

    const merged = applyResearchBriefLlmOutput(
      draft,
      {
        executive_summary: ["One", "Two", "Three"],
        patterns: [],
        competitive_landscape: {
          overview: "Two astrology accounts dominate with question-led carousels.",
          brands: [
            {
              handle_or_name: "@astroqueen",
              platform: "Instagram",
              post_count: 2,
              signature_moves: ["Question hooks on cover slides", "Numbered ranking carousels"],
              standout_example: "Which sign is the biggest liar?",
            },
          ],
        },
      },
      {
        competitorRollup: [
          {
            handle_or_name: "@astroqueen",
            platform: "Instagram",
            post_count: 2,
            avg_score: 0.8,
            top_hooks: ["Which sign lies?"],
            formats: ["carousel"],
            why_snippets: ["Strong hook."],
            top_tier_posts: 0,
          },
        ],
      }
    );

    expect(merged.competitive_landscape?.brands).toHaveLength(1);
    expect(merged.competitive_landscape?.brands[0]?.handle_or_name).toBe("@astroqueen");
  });

  it("includes insights from every platform in the brief input sample", () => {
    const rows = [
      row({ id: "1", insights_id: "ig_1", evidence_kind: "instagram_post", pre_llm_score: "0.9" }),
      row({ id: "2", insights_id: "ig_2", evidence_kind: "instagram_post", pre_llm_score: "0.85" }),
      row({ id: "3", insights_id: "tt_1", evidence_kind: "tiktok_post", pre_llm_score: "0.95" }),
      row({ id: "4", insights_id: "rd_1", evidence_kind: "reddit_post", pre_llm_score: "0.7" }),
    ];
    const sample = compactInsightsForBrief(rows);
    const platforms = new Set(sample.map((s) => s.platform));
    expect(platforms.has("Instagram")).toBe(true);
    expect(platforms.has("TikTok")).toBe(true);
    expect(platforms.has("Reddit")).toBe(true);
  });

  it("stratifiedSampleByPlatform round-robins across platforms", () => {
    const picked = stratifiedSampleByPlatform(
      [
        { platform: "Instagram", score: 1 },
        { platform: "Instagram", score: 0.9 },
        { platform: "TikTok", score: 0.95 },
        { platform: "Reddit", score: 0.8 },
      ],
      (x) => x.score,
      { perPlatform: 2, maxTotal: 4 }
    );
    expect(picked.map((p) => p.platform)).toEqual(["Instagram", "Reddit", "TikTok", "Instagram"]);
  });
});
