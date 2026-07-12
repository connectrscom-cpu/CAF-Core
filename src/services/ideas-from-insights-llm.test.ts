import { describe, expect, it } from "vitest";
import type { EvidenceRowInsightEnrichedRow } from "../repositories/inputs-evidence-insights.js";
import {
  budgetInsightContextForIdeasLlm,
  buildIdeasBucketSystemPrompt,
  buildIdeasFromInsightsPromptLabsEntries,
  buildIdeasGroupSystemPrompt,
  buildLlmIdeaSchema,
  compactTopPerformerStylesForIdeasLlm,
  extractNemotronAnalysisForIdeasLlm,
  groupIdeaGenerationBuckets,
  parseLlmIdeasFromResponse,
  type IdeasLlmInsightContextRow,
} from "./ideas-from-insights-llm.js";
import { defaultIdeaGenerationQuotas, resolveBucketCounts } from "../domain/idea-structure.js";

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

describe("ideas prompt labs registry", () => {
  it("builds grouped + bucket entries from shared prompt builders", () => {
    const entries = buildIdeasFromInsightsPromptLabsEntries();
    expect(entries.some((e) => e.prompt_name === "IDEAS__From_Insights__Overview_v1")).toBe(true);
    expect(entries.some((e) => e.labs_prompt_subgroup === "group" && e.prompt_name === "IDEAS__Group__niche_carousel_v1")).toBe(
      true
    );
    expect(entries.some((e) => e.labs_prompt_subgroup === "bucket" && e.prompt_name === "IDEAS__Bucket__niche_carousel_text_v1")).toBe(
      true
    );

    const quotas = defaultIdeaGenerationQuotas(12, false);
    const plan = resolveBucketCounts(quotas);
    const grouped = groupIdeaGenerationBuckets(plan);
    const group = grouped.find((g) => g.key === "niche|carousel");
    expect(group).toBeTruthy();
    const system = buildIdeasGroupSystemPrompt({
      total: group!.total,
      format: group!.format,
      content_lens: group!.content_lens,
      buckets: group!.buckets.map((b) => ({
        execution_profile: b.execution_profile,
        count: b.count,
        label: b.label,
      })),
    });
    expect(system).toContain('content_lens MUST be "niche"');
    expect(system).toContain("execution_profile=");

    const bucket = plan.find((b) => b.id === "niche_carousel_text");
    expect(bucket).toBeTruthy();
    const bucketSystem = buildIdeasBucketSystemPrompt(bucket!);
    expect(bucketSystem).toContain('execution_profile MUST be "text_heavy"');
  });

  it("coerces partial LLM idea rows before schema validation", () => {
    const context: IdeasLlmInsightContextRow[] = [
      {
        source_evidence_row_id: "42",
        evidence_kind: "instagram_carousel",
        evidence_rating: 0.8,
        grounding_insight_ids: ["ins_42"],
        broad: { why_it_worked: "hook" },
        top_performer_styles: null,
      },
    ];
    const schema = buildLlmIdeaSchema();
    const { ideas, errors } = parseLlmIdeasFromResponse(
      [
        {
          title: "Mercury retrograde myths",
          thesis: "Debunk the top 3 myths with receipts",
          key_points: "Myth one",
          grounding_insight_ids: ["42"],
          cta_class: "Product Awareness",
        },
      ],
      context,
      schema,
      {
        id: "niche_carousel_text",
        label: "Niche carousel — text-heavy",
        format: "carousel",
        content_lens: "niche",
        execution_profile: "text_heavy",
        section: "niche",
        count: 1,
      }
    );
    expect(errors).toEqual([]);
    expect(ideas).toHaveLength(1);
    expect(ideas[0]?.grounding_insight_ids).toEqual(["ins_42"]);
    expect(ideas[0]?.carousel_style).toBe("text_heavy");
    expect(ideas[0]?.cta_class).toBe("product_awareness");
    expect((ideas[0]?.key_points ?? []).length).toBeGreaterThanOrEqual(3);
  });

  it("includes visual-first carousel addendum in grouped system prompt", () => {
    const system = buildIdeasGroupSystemPrompt({
      total: 2,
      format: "carousel",
      content_lens: "niche",
      buckets: [{ execution_profile: "visual_first", count: 2 }],
    });
    expect(system).toContain("FLOW_VISUAL_FIRST_CAROUSEL");
    expect(system).toContain("visual_first");
    expect(system).toContain("Instagram or Facebook");
  });

  it("remaps non-IG/FB carousel platforms to Instagram or Facebook", () => {
    const context: IdeasLlmInsightContextRow[] = [
      {
        source_evidence_row_id: "1",
        evidence_kind: "youtube_video",
        grounding_insight_ids: ["ins_1"],
        broad: { why_it_worked: "hook" },
        top_performer_styles: null,
      },
    ];
    const schema = buildLlmIdeaSchema();
    const { ideas, errors } = parseLlmIdeasFromResponse(
      [
        {
          title: "Zodiac home decor",
          thesis: "Room-by-room sign styling",
          platform: "Pinterest",
          grounding_insight_ids: ["ins_1"],
        },
        {
          title: "Mercury wellness",
          thesis: "Mindful rituals by sign",
          platform: "YouTube",
          grounding_insight_ids: ["ins_1"],
        },
      ],
      context,
      schema,
      {
        id: "niche_carousel_visual",
        label: "Niche carousel — visual-first",
        format: "carousel",
        content_lens: "niche",
        execution_profile: "visual_first",
        section: "niche",
        count: 2,
      }
    );
    expect(errors).toEqual([]);
    expect(ideas.map((i) => i.platform)).toEqual(["Instagram", "Facebook"]);
  });
});
