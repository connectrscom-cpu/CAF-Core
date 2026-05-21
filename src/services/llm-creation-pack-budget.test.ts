import { describe, expect, it } from "vitest";
import {
  budgetSignalPackContextForLlm,
  filterSignalPackIdeasForCandidate,
  slimDerivedGlobalsForLlm,
  slimVisualGuidelineEntryForLlm,
} from "./llm-creation-pack-budget.js";

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
    const entry = (vgp.entries as Record<string, unknown>[])[0];
    expect(entry.inspection_media).toBeUndefined();
    expect(JSON.stringify(budgeted).length).toBeLessThanOrEqual(20_000);
  });

  it("does not filter ideas_json when mimicFlowOnly is false", () => {
    const pack = {
      ideas_json: [fakeIdea("idea_a"), fakeIdea("idea_b")],
      overall_candidates_json: [],
    };
    const budgeted = budgetSignalPackContextForLlm(
      pack,
      { maxTotalJsonChars: 50_000, maxCandidateRows: 55, maxStringFieldChars: 2000 },
      { candidateData: { idea_id: "idea_b" }, mimicFlowOnly: false }
    );
    expect((budgeted.ideas_json as unknown[]).length).toBe(2);
  });

  it("slims derived globals hashtag leaderboard", () => {
    const slim = slimDerivedGlobalsForLlm({
      hashtag_leaderboard_v1: Array.from({ length: 80 }, (_, i) => ({ hashtag: `#t${i}` })),
    });
    expect((slim?.hashtag_leaderboard_v1 as unknown[]).length).toBe(30);
  });
});
