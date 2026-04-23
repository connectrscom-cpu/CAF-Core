import { describe, expect, it } from "vitest";
import { evaluatePreLlmRow, extractPreLlmFeatures, mergePreLlmConfig } from "./inputs-pre-llm-rank.js";

describe("inputs-pre-llm-rank", () => {
  it("mergePreLlmConfig defaults to disabled", () => {
    expect(mergePreLlmConfig({}).enabled).toBe(false);
  });

  it("mergePreLlmConfig respects enabled flag", () => {
    expect(mergePreLlmConfig({ pre_llm: { enabled: true } }).enabled).toBe(true);
  });

  it("extractPreLlmFeatures reddit uses score, comments, ratio", () => {
    const f = extractPreLlmFeatures("reddit_post", {
      score: "200",
      comment_count: "40",
      upvote_ratio: "0.92",
      title: "hello world",
    });
    expect(f.reddit_upvote_ratio).toBeCloseTo(0.92);
    expect(f.reddit_score).toBeGreaterThan(0);
    expect(f.text_signal).toBeGreaterThan(0);
  });

  it("evaluatePreLlmRow marks sparse TikTok as dropped", () => {
    const ev = evaluatePreLlmRow("tiktok_video", { caption: "x" }, { pre_llm: { enabled: true, min_primary_text_chars: 20 } });
    expect(ev.dropped_reason).toBe("sparse_primary_text");
  });

  it("extractPreLlmFeatures tiktok uses plays and engagement", () => {
    const f = extractPreLlmFeatures("tiktok_video", {
      plays: "100000",
      likes: "5000",
      comments: "200",
      authorFollowers: "500000",
      caption: "test caption here",
    });
    expect(f.tt_plays).toBeGreaterThan(0);
    expect(f.tt_likes).toBeGreaterThan(0);
  });
});
