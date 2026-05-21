import { describe, expect, it } from "vitest";
import {
  buildInstagramApifyInput,
  buildRedditApifyInputFromConfig,
  buildTiktokApifyInput,
  defaultScraperConfig,
  hashtagsFromSourceRows,
  mergeScraperConfig,
  parseHashtagList,
} from "./inputs-scraper-apify-config.js";

describe("buildInstagramApifyInput", () => {
  it("matches n8n instagram-scraper payload shape", () => {
    const cfg = defaultScraperConfig();
    const input = buildInstagramApifyInput(cfg, ["https://www.instagram.com/foo/"]);
    expect(input.directUrls).toEqual(["https://www.instagram.com/foo/"]);
    expect(input.resultsType).toBe("posts");
    expect(input.resultsLimit).toBe(10);
    expect(input.scrapePosts).toBe(true);
    expect(input.scrapeReels).toBe(true);
    expect(input.scrapeStories).toBe(false);
    expect(input.proxyConfiguration).toEqual({ useApifyProxy: true });
  });
});

describe("buildTiktokApifyInput", () => {
  it("merges hashtags from sources and extras", () => {
    const cfg = defaultScraperConfig();
    cfg.scrapers!.tiktok!.extraHashtags = ["mercuryretrograde"];
    const input = buildTiktokApifyInput(
      cfg,
      ["moon.omens"],
      [{ Hashtag: "astrology" }, { name: "zodiac" }]
    );
    expect(input.profiles).toContain("moon.omens");
    expect(input.hashtags).toEqual(expect.arrayContaining(["astrology", "zodiac", "mercuryretrograde"]));
    expect(input.oldestPostDateUnified).toBe("7 days");
    expect(input.downloadSubtitlesOptions).toContain("TRANSCRIBE");
  });
});

describe("buildRedditApifyInputFromConfig", () => {
  it("builds /top/?t=week startUrls like n8n", () => {
    const cfg = defaultScraperConfig();
    const input = buildRedditApifyInputFromConfig(cfg, ["https://reddit.com/r/astrology"]);
    expect(input.startUrls).toEqual([{ url: "https://reddit.com/r/astrology/top/?t=week" }]);
    expect(input.maxPostCount).toBe(30);
    expect(input.maxComments).toBe(3);
    expect(input.commentSort).toBe("top");
  });
});

describe("parseHashtagList", () => {
  it("splits comma and newline lists", () => {
    expect(parseHashtagList("a, b\nc")).toEqual(["a", "b", "c"]);
  });
});

describe("hashtagsFromSourceRows", () => {
  it("reads Hashtag column", () => {
    expect(hashtagsFromSourceRows([{ Hashtag: "#aries" }])).toEqual(["aries"]);
  });
});

describe("mergeScraperConfig", () => {
  it("preserves defaults for missing keys", () => {
    const merged = mergeScraperConfig({ scrapers: { instagram: { resultsLimit: 25 } } });
    expect(merged.scrapers?.instagram?.resultsLimit).toBe(25);
    expect(merged.scrapers?.instagram?.scrapeReels).toBe(true);
  });
});
