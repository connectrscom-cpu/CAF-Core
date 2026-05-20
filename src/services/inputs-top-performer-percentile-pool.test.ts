import { describe, expect, it } from "vitest";
import {
  applyTopPerformerPercentileSelection,
  resolveTopPerformerPercentileConfig,
  scoreRowForTopPerformer,
} from "./inputs-top-performer-percentile-pool.js";

describe("inputs-top-performer-percentile-pool", () => {
  it("scoreRowForTopPerformer prefers rating_score when present", () => {
    const map = new Map([["a", 0.9]]);
    expect(scoreRowForTopPerformer("a", 0.2, map)).toEqual({
      id: "a",
      score: 0.9,
      score_source: "rating_score",
    });
    expect(scoreRowForTopPerformer("b", 0.5, map)).toEqual({
      id: "b",
      score: 0.5,
      score_source: "pre_llm_score",
    });
  });

  it("applyTopPerformerPercentileSelection keeps top fraction by score", () => {
    const config = resolveTopPerformerPercentileConfig({
      top_performer: { rating_top_fraction: 0.1 },
    });
    const eligible = [
      { id: "1", score: 0.1, score_source: "pre_llm_score" as const },
      { id: "2", score: 0.9, score_source: "pre_llm_score" as const },
      { id: "3", score: 0.8, score_source: "pre_llm_score" as const },
      { id: "4", score: 0.7, score_source: "pre_llm_score" as const },
      { id: "5", score: 0.6, score_source: "pre_llm_score" as const },
      { id: "6", score: 0.5, score_source: "pre_llm_score" as const },
      { id: "7", score: 0.4, score_source: "pre_llm_score" as const },
      { id: "8", score: 0.3, score_source: "pre_llm_score" as const },
      { id: "9", score: 0.2, score_source: "pre_llm_score" as const },
      { id: "10", score: 0.15, score_source: "pre_llm_score" as const },
    ];
    const { selected, stats } = applyTopPerformerPercentileSelection(eligible, config, { maxRows: 40 });
    expect(stats.universe_count).toBe(10);
    expect(stats.percentile_cap).toBe(1);
    expect(selected.map((r) => r.id)).toEqual(["2"]);
  });

  it("legacy path uses min score when percentile gate disabled", () => {
    const config = resolveTopPerformerPercentileConfig(
      { top_performer: { disable_rating_percentile_gate: true, pre_llm_min_score: 0.5 } },
      null,
      0.5
    );
    expect(config.active).toBe(false);
    const eligible = [
      { id: "low", score: 0.3, score_source: "pre_llm_score" as const },
      { id: "high", score: 0.8, score_source: "pre_llm_score" as const },
    ];
    const { selected } = applyTopPerformerPercentileSelection(eligible, config);
    expect(selected.map((r) => r.id)).toEqual(["high"]);
  });

  it("applyTopPerformerPercentileSelection applies top fraction independently per format family", () => {
    const config = resolveTopPerformerPercentileConfig({
      top_performer: { rating_top_fraction: 0.5 },
    });
    const eligible = [
      { id: "c1", score: 0.2, score_source: "pre_llm_score" as const, family: "carousel" as const },
      { id: "c2", score: 0.9, score_source: "pre_llm_score" as const, family: "carousel" as const },
      { id: "v1", score: 0.1, score_source: "pre_llm_score" as const, family: "video" as const },
      { id: "v2", score: 0.8, score_source: "pre_llm_score" as const, family: "video" as const },
    ];
    const { selected, stats } = applyTopPerformerPercentileSelection(eligible, config, {
      groupByFormatFamily: (r) => r.family,
    });
    expect(selected.map((r) => r.id).sort()).toEqual(["c2", "v2"]);
    expect(stats.grouped_by_format_family).toBe(true);
    expect(stats.format_groups).toEqual([
      { format_family: "carousel", universe_count: 2, percentile_cap: 1, selected_count: 1 },
      { format_family: "video", universe_count: 2, percentile_cap: 1, selected_count: 1 },
    ]);
  });
});
