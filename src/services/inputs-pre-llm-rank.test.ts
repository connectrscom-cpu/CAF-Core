import { describe, expect, it } from "vitest";
import { buildRegistryFollowerLookup } from "../domain/evidence-relative-performance.js";
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

  it("mergePreLlmConfig respects relative_page_performance flag", () => {
    expect(mergePreLlmConfig({ pre_llm: { enabled: true, relative_page_performance: true } }).relative_page_performance).toBe(
      true
    );
  });

  it("relative scoring ranks small-account viral post above large-account mediocre post", () => {
    const criteria = {
      pre_llm: {
        enabled: true,
        relative_page_performance: true,
        kinds: {
          instagram_post: {
            min_score: 0,
            weights: { page_relative_engagement: 1 },
          },
        },
      },
    };
    const viralSmall = evaluatePreLlmRow(
      "instagram_post",
      { like_count: 5000, comment_count: 200, followers_count: 10_000, caption: "enough text here for gate" },
      criteria
    );
    const bigMediocre = evaluatePreLlmRow(
      "instagram_post",
      { like_count: 50_000, comment_count: 500, followers_count: 5_000_000, caption: "enough text here for gate" },
      criteria
    );
    expect(viralSmall.pre_llm_score).toBeGreaterThan(bigMediocre.pre_llm_score);
  });

  it("relative mode falls back to raw weights when followers missing", () => {
    const criteria = {
      pre_llm: {
        enabled: true,
        relative_page_performance: true,
        kinds: {
          instagram_post: {
            min_score: 0,
            weights: { page_relative_engagement: 1 },
          },
        },
      },
    };
    const ev = evaluatePreLlmRow(
      "instagram_post",
      { like_count: 1_000_000, comment_count: 10_000, caption: "enough text here for gate" },
      criteria
    );
    expect(ev.pre_llm_breakdown.has_follower_baseline).toBe(0);
    expect(ev.pre_llm_score).toBeGreaterThan(0);
  });

  it("registry follower lookup enables relative scoring without per-post follower fields", () => {
    const lookup = buildRegistryFollowerLookup([
      { Link: "https://www.instagram.com/astrobrand/", Followers: "50,000" },
    ]);
    const criteria = {
      pre_llm: {
        enabled: true,
        relative_page_performance: true,
        kinds: {
          instagram_post: {
            min_score: 0,
            weights: { page_relative_engagement: 1 },
          },
        },
      },
    };
    const ev = evaluatePreLlmRow(
      "instagram_post",
      {
        account_handle: "astrobrand",
        like_count: 10_000,
        comment_count: 200,
        caption: "enough text here for gate",
      },
      criteria,
      { registryFollowerLookup: lookup }
    );
    expect(ev.pre_llm_breakdown.has_follower_baseline).toBe(1);
    expect(ev.pre_llm_breakdown.page_relative_engagement).toBeGreaterThan(0);
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
