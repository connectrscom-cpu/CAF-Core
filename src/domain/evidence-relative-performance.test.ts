import { describe, expect, it } from "vitest";
import {
  augmentPreLlmFeaturesWithRelative,
  buildRegistryFollowerLookup,
  enrichPayloadFollowerBaseline,
  extractFollowerCount,
  extractSocialAccountHandle,
  normPageRelativeEngagementRate,
  parseFollowerCountValue,
} from "./evidence-relative-performance.js";

describe("evidence-relative-performance", () => {
  it("parseFollowerCountValue handles k/M suffixes", () => {
    expect(parseFollowerCountValue("12.5k")).toBe(12500);
    expect(parseFollowerCountValue("1.2M")).toBe(1_200_000);
  });

  it("extractFollowerCount reads instagram followers_count", () => {
    expect(extractFollowerCount("instagram_post", { followers_count: 10_000 })).toBe(10_000);
    expect(extractFollowerCount("instagram_post", {})).toBeNull();
  });

  it("extractFollowerCount reads nested Apify owner.followersCount from raw_json", () => {
    const payload = {
      like_count: 100,
      raw_json: JSON.stringify({ owner: { username: "moonomens", followersCount: 250_000 } }),
    };
    expect(extractFollowerCount("instagram_post", payload)).toBe(250_000);
  });

  it("enrichPayloadFollowerBaseline joins IG Accounts registry by handle", () => {
    const lookup = buildRegistryFollowerLookup([
      { Name: "@moonomens", Link: "https://www.instagram.com/moonomens/", Followers: "120k" },
    ]);
    const enriched = enrichPayloadFollowerBaseline(
      "instagram_post",
      { owner_username: "moonomens", like_count: 5000 },
      lookup
    );
    expect(extractFollowerCount("instagram_post", enriched)).toBe(120_000);
    const f = augmentPreLlmFeaturesWithRelative(
      "instagram_post",
      enriched,
      { ig_likes: 0.5, ig_comments: 0.3, text_signal: 0.4 }
    );
    expect(f.has_follower_baseline).toBe(1);
    expect(f.page_relative_engagement).toBeGreaterThan(0);
  });

  it("extractSocialAccountHandle reads owner_username", () => {
    expect(extractSocialAccountHandle("instagram_post", { owner_username: "MoonOmens" })).toBe("moonomens");
  });

  it("normPageRelativeEngagementRate caps at PAGE_RELATIVE_ER_CAP", () => {
    expect(normPageRelativeEngagementRate(0.06)).toBeCloseTo(0.5);
    expect(normPageRelativeEngagementRate(0.24)).toBe(1);
  });

  it("augmentPreLlmFeaturesWithRelative computes IG relative engagement", () => {
    const base = { ig_likes: 0.9, ig_comments: 0.5, text_signal: 0.4 };
    const f = augmentPreLlmFeaturesWithRelative(
      "instagram_post",
      { like_count: 12_000, comment_count: 400, followers_count: 100_000 },
      base
    );
    expect(f.has_follower_baseline).toBe(1);
    // (12000 + 800) / 100000 = 12.8% → capped at 1.0
    expect(f.page_relative_engagement).toBe(1);
    expect(f.ig_likes).toBe(0.9);
  });

  it("marks missing followers with has_follower_baseline 0", () => {
    const f = augmentPreLlmFeaturesWithRelative("instagram_post", { like_count: 5000 }, { text_signal: 0.2 });
    expect(f.has_follower_baseline).toBe(0);
    expect(f.page_relative_engagement).toBeUndefined();
  });

  it("computes tiktok relative reach from plays per follower", () => {
    const f = augmentPreLlmFeaturesWithRelative(
      "tiktok_video",
      { likes: 1000, comments: 50, plays: 500_000, authorFollowers: 50_000 },
      { text_signal: 0.3 }
    );
    expect(f.has_follower_baseline).toBe(1);
    expect(f.page_relative_reach).toBeGreaterThan(0.5);
  });
});
