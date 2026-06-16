import { describe, expect, it } from "vitest";
import {
  budgetCreationPackForCarouselFlow,
  budgetCreationPackForMimicFlow,
  budgetSignalPackContextForLlm,
  filterSignalPackIdeasForCandidate,
  slimDerivedGlobalsForLlm,
  slimSignalPackIdeaRowForLlm,
  slimSignalPackIdeaRowForMimicLlm,
  slimVisualGuidelineEntryForLlm,
} from "./llm-creation-pack-budget.js";
import { slimContextForCreationPackJson } from "./llm-generator-helpers.js";

function fakeIdea(id: string): Record<string, unknown> {
  return {
    id,
    title: `Idea ${id}`,
    thesis: "x".repeat(800),
    three_liner: "y".repeat(400),
  };
}

describe("llm-creation-pack-budget", () => {
  it("filters ideas_json to the candidate idea", () => {
    const ideas = [fakeIdea("idea_a"), fakeIdea("idea_b"), fakeIdea("idea_c")];
    const filtered = filterSignalPackIdeasForCandidate(ideas, {
      idea_id: "idea_b",
      candidate_id: "idea_b_FLOW_TOP_PERFORMER_MIMIC_CAROUSEL",
    });
    expect(filtered).toHaveLength(1);
    expect((filtered[0] as Record<string, unknown>).id).toBe("idea_b");
  });

  it("strips inspection_media from visual guideline entries", () => {
    const slim = slimVisualGuidelineEntryForLlm({
      insights_id: "ins_1",
      inspection_media: { items: [{ vision_fetch_url: "https://example.com/huge.jpg" }] },
      deck_as_whole_summary: "Dark celestial carousel",
    });
    expect(slim.inspection_media).toBeUndefined();
    expect(slim.deck_as_whole_summary).toBe("Dark celestial carousel");
  });

  it("budgets idea-list packs that have empty overall_candidates_json", () => {
    const longUrl = `https://example.com/${"a".repeat(2000)}.jpg`;
    const pack = {
      run_id: "SIG_test",
      ideas_json: Array.from({ length: 38 }, (_, i) => fakeIdea(`idea_${i}`)),
      overall_candidates_json: [],
      derived_globals_json: {
        hashtag_leaderboard_v1: Array.from({ length: 100 }, (_, i) => ({ hashtag: `#tag${i}` })),
        visual_guidelines_pack_v1: {
          entries: [
            {
              insights_id: "ins_1",
              analysis_tier: "top_performer_carousel",
              inspection_media: {
                items: [{ vision_fetch_url: longUrl, public_url: longUrl }],
              },
            },
          ],
        },
      },
    };

    const budgeted = budgetSignalPackContextForLlm(
      pack,
      {
        maxTotalJsonChars: 20_000,
        maxCandidateRows: 55,
        maxStringFieldChars: 2000,
      },
      { candidateData: { idea_id: "idea_12" }, mimicFlowOnly: true }
    );

    expect((budgeted.ideas_json as unknown[]).length).toBe(1);
    expect((budgeted.ideas_json as Record<string, unknown>[])[0]?.id).toBe("idea_12");
    const dg = budgeted.derived_globals_json as Record<string, unknown>;
    const vgp = dg.visual_guidelines_pack_v1 as Record<string, unknown>;
    expect((vgp.entries as unknown[]).length).toBe(0);
    expect(JSON.stringify(budgeted).length).toBeLessThanOrEqual(20_000);
  });

  it("filters ideas_json to the candidate for standard flows when idea-list packs are large", () => {
    const pack = {
      ideas_json: [fakeIdea("idea_a"), fakeIdea("idea_b")],
      overall_candidates_json: [],
    };
    const budgeted = budgetSignalPackContextForLlm(
      pack,
      { maxTotalJsonChars: 50_000, maxCandidateRows: 55, maxStringFieldChars: 2000 },
      { candidateData: { idea_id: "idea_b" }, mimicFlowOnly: false }
    );
    expect((budgeted.ideas_json as unknown[]).length).toBe(1);
    expect((budgeted.ideas_json as Record<string, unknown>[])[0]?.id).toBe("idea_b");
  });

  it("strips aesthetic_analysis_json from visual guideline entries", () => {
    const slim = slimVisualGuidelineEntryForLlm({
      insights_id: "ins_1",
      deck_as_whole_summary: "Dark celestial carousel",
      aesthetic_analysis_json: { slides: [{ text_blocks: [{ text: "x".repeat(5000) }] }] },
    });
    expect(slim.aesthetic_analysis_json).toBeUndefined();
    expect(slim.deck_as_whole_summary).toBe("Dark celestial carousel");
  });

  it("slims idea rows for standard LLM copy (drops OCR blobs, keeps editorial fields)", () => {
    const slim = slimSignalPackIdeaRowForLlm({
      id: "idea_1",
      title: "Hook",
      three_liner: "summary",
      aesthetic_analysis_json: { slides: [] },
    });
    expect(slim.title).toBe("Hook");
    expect(slim.aesthetic_analysis_json).toBeUndefined();
  });

  it("budgetCreationPackForCarouselFlow caps oversized idea-list + visual guideline packs", () => {
    const pack = {
      strategy: { thesis: "s".repeat(8_000) },
      brand_constraints: { voice: "warm" },
      product_profile: {
        product_name: "Sign & Sound",
        one_liner: "Daily horoscope + music",
        elevator_pitch: "p".repeat(20_000),
        proof_points: "x".repeat(20_000),
      },
      signal_pack: {
        ideas_json: Array.from({ length: 12 }, (_, i) => fakeIdea(`idea_${i}`)),
        derived_globals_json: {
          visual_guidelines_pack_v1: {
            entries: Array.from({ length: 6 }, (_, i) => ({
              insights_id: `ins_${i}`,
              aesthetic_analysis_json: {
                slides: Array.from({ length: 12 }, () => ({
                  text_blocks: [{ text: "d".repeat(2000), bbox_norm: { x: 0.1, y: 0.2, w: 0.3, h: 0.4 } }],
                })),
              },
            })),
          },
        },
      },
      candidate: { idea_id: "idea_3", title: "Planned" },
    };
    const out = budgetCreationPackForCarouselFlow(pack, 24_000, { candidateData: { idea_id: "idea_3" } });
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(24_000);
    expect((out.signal_pack as Record<string, unknown>).ideas_json).toHaveLength(1);
    const dg = (out.signal_pack as Record<string, unknown>).derived_globals_json as Record<string, unknown>;
    const vgp = dg.visual_guidelines_pack_v1 as Record<string, unknown>;
    for (const entry of (vgp.entries as Record<string, unknown>[]) ?? []) {
      expect(entry.aesthetic_analysis_json).toBeUndefined();
    }
  });

  it("slims derived globals hashtag leaderboard", () => {
    const slim = slimDerivedGlobalsForLlm({
      hashtag_leaderboard_v1: Array.from({ length: 80 }, (_, i) => ({ hashtag: `#t${i}` })),
    });
    expect((slim?.hashtag_leaderboard_v1 as unknown[]).length).toBe(30);
  });

  it("slims mimic idea rows and enforces signal pack char cap with a single idea", () => {
    const longUrl = `https://cdn.example.com/${"z".repeat(4000)}.jpg`;
    const pack = {
      ideas_json: [
        {
          id: "mimic_ins_x",
          title: "Hook",
          aesthetic_analysis_json: {
            slides: Array.from({ length: 12 }, (_, i) => ({
              slide_index: i + 1,
              visual_description: "d".repeat(2000),
              inspection_media: { vision_fetch_url: longUrl },
            })),
          },
        },
      ],
      overall_candidates_json: Array.from({ length: 40 }, (_, i) => ({
        id: `cand_${i}`,
        blob: "x".repeat(3000),
      })),
      derived_globals_json: {
        visual_guidelines_pack_v1: {
          entries: Array.from({ length: 8 }, (_, i) => ({
            insights_id: `ins_${i}`,
            aesthetic_analysis_json: { slides: [{ visual_description: "y".repeat(1500) }] },
          })),
        },
      },
      ig_summary: "summary ".repeat(500),
    };

    const budgeted = budgetSignalPackContextForLlm(
      pack,
      { maxTotalJsonChars: 18_000, maxCandidateRows: 55, maxStringFieldChars: 800 },
      { candidateData: { idea_id: "mimic_ins_x" }, mimicFlowOnly: true }
    );

    expect((budgeted.ideas_json as unknown[]).length).toBe(1);
    const idea = (budgeted.ideas_json as Record<string, unknown>[])[0];
    expect(idea.aesthetic_analysis_json).toBeUndefined();
    expect(idea.title).toBe("Hook");
    expect((budgeted.overall_candidates_json as unknown[]).length).toBe(0);
    const dg = budgeted.derived_globals_json as Record<string, unknown>;
    const vgp = dg.visual_guidelines_pack_v1 as Record<string, unknown>;
    expect((vgp.entries as unknown[]).length).toBe(0);
    expect(JSON.stringify(budgeted).length).toBeLessThanOrEqual(18_000);
  });

  it("budgetCreationPackForMimicFlow caps whole pack JSON", () => {
    const pack = {
      strategy: { thesis: "s".repeat(20_000) },
      brand_constraints: { voice: "b".repeat(20_000) },
      product_profile: { sku: "p".repeat(20_000) },
      signal_pack: { ideas_json: [{ id: "a", title: "A" }] },
      candidate: { idea_id: "a", extra: "c".repeat(10_000) },
      top_performer_mimic_knowledge: { entries: [{ deck: "k".repeat(8000) }] },
    };
    const out = budgetCreationPackForMimicFlow(pack, 12_000);
    expect(JSON.stringify(out).length).toBeLessThanOrEqual(12_000);
    expect(out.top_performer_mimic_knowledge).toBeNull();
  });

  it("slimContextForMimicCopyGeneration keeps only copy-start essentials", async () => {
    const { slimContextForMimicCopyGeneration } = await import("./llm-generator-helpers.js");
    const slim = slimContextForMimicCopyGeneration({
      brand_constraints: { banned_words: ["bad"], voice: "warm", extra_blob: "x".repeat(5000) },
      platform_constraints: { slide_min: 5, slide_max: 12 },
      strategy: { thesis: "test thesis", unused: "y".repeat(4000) },
      product_profile: { sku: "p".repeat(4000) },
      signal_pack: { ideas_json: [{ id: "a", title: "big idea", aesthetic_analysis_json: { slides: [] } }] },
      candidate: { idea_id: "a", title: "Hook", aesthetic_analysis_json: { slides: [] } },
      signal_pack_publication_hints: { signal_pack_filtered_hashtags: ["#tag"] },
      top_performer_mimic_knowledge: {
        visual_guideline_cues: ["cue1", "cue2"],
        content_format_groups: ["listicle"],
        entries: [{ deck: "k".repeat(8000) }],
      },
      mimic_render_context: {
        target_slide_count: 10,
        copy_before_visual_mimic: true,
        operator_note: "long note".repeat(200),
      },
      mimic_job_grounding: { slide_copy_layout: [{ slide_index: 1, text_blocks: [{ x: 0.1 }] }] },
    });
    expect(slim.brand_constraints).toEqual({ banned_words: ["bad"], voice: "warm" });
    expect(slim.candidate).toEqual({ idea_id: "a", title: "Hook" });
    expect(slim.signal_pack).toBeUndefined();
    expect(slim.product_profile).toBeUndefined();
    expect(slim.mimic_copy_job_brief).toEqual({
      copy_before_visual_mimic: true,
      target_slide_count: 10,
    });
    expect(JSON.stringify(slim).length).toBeLessThan(4_000);
  });

  it("slimContextForCreationPackJson omits duplicate mimic carousel fields", () => {
    const slim = slimContextForCreationPackJson({
      strategy: { thesis: "ok" },
      top_performer_mimic_knowledge: { entries: [{ x: 1 }] },
      publication_output_contract: "do not duplicate",
      mimic_visual_guideline_for_copy: { slides: [{ slide_index: 1 }] },
      mimic_render_context: { target_slide_count: 8 },
      mimic_job_grounding: { slide_copy_layout: [{ slide_index: 1, text_blocks: [{ x: 0.1 }] }] },
      global_learning_context: "learn",
    });
    expect(slim.strategy).toEqual({ thesis: "ok" });
    expect(slim.top_performer_mimic_knowledge).toBeUndefined();
    expect(slim.publication_output_contract).toBeUndefined();
    expect(slim.mimic_visual_guideline_for_copy).toBeUndefined();
    expect(slim.mimic_job_grounding).toBeUndefined();
    expect(slim.global_learning_context).toBeUndefined();
  });

  it("slimSignalPackIdeaRowForMimicLlm drops inspection blobs", () => {
    const slim = slimSignalPackIdeaRowForMimicLlm({
      id: "ins_1",
      title: "T",
      inspection_media: { items: [] },
      aesthetic_analysis_json: { slides: [] },
    });
    expect(slim.id).toBe("ins_1");
    expect(slim.inspection_media).toBeUndefined();
    expect(slim.aesthetic_analysis_json).toBeUndefined();
  });
});
