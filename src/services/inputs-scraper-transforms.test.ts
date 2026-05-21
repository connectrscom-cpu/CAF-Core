import { describe, expect, it } from "vitest";
import {
  normalizeInstagramProfileUrl,
  prepareInstagramSources,
  transformInstagramApifyPost,
  transformTiktokApifyItem,
  tiktokProfilesFromSources,
  buildRedditApifyInput,
  enabledWebsiteSources,
} from "./inputs-scraper-transforms.js";

describe("normalizeInstagramProfileUrl", () => {
  it("normalizes @handle", () => {
    expect(normalizeInstagramProfileUrl({ Link: "@moon.omens" })).toBe(
      "https://www.instagram.com/moon.omens/"
    );
  });

  it("normalizes bare handle", () => {
    expect(normalizeInstagramProfileUrl({ Link: "costarastrology" })).toBe(
      "https://www.instagram.com/costarastrology/"
    );
  });
});

describe("prepareInstagramSources", () => {
  it("filters skip rows", () => {
    const out = prepareInstagramSources([
      { Link: "@foo", skip: true },
      { Link: "@bar" },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.instagramUrl).toContain("bar");
  });
});

describe("transformInstagramApifyPost", () => {
  it("maps carousel childPosts", () => {
    const row = transformInstagramApifyPost(
      {
        caption: "Aries season #astrology",
        shortCode: "abc123",
        childPosts: [{ displayUrl: "https://cdn.example/1.jpg" }, { displayUrl: "https://cdn.example/2.jpg" }],
        likesCount: 10,
        commentsCount: 2,
      },
      { account_handle_src: "testacct" }
    );
    expect(row.media_type).toBe("carousel");
    expect(row.account_handle).toBe("testacct");
    expect(String(row.hashtags)).toContain("astrology");
    expect(row.post_id).toBe("abc123");
  });
});

describe("transformTiktokApifyItem", () => {
  it("maps video row", () => {
    const row = transformTiktokApifyItem({
      id: "v1",
      webVideoUrl: "https://tiktok.com/@x/video/1",
      text: "hello",
      playCount: 100,
      diggCount: 5,
      commentCount: 1,
      authorMeta: { name: "handle", fans: 999 },
      hashtags: [{ name: "astro" }],
    });
    expect(row?.videoId).toBe("v1");
    expect(row?.hashtags).toBe("astro");
  });

  it("skips errors", () => {
    expect(transformTiktokApifyItem({ error: "fail" })).toBeNull();
  });
});

describe("tiktokProfilesFromSources", () => {
  it("extracts handles from Link column", () => {
    expect(
      tiktokProfilesFromSources([{ Link: "https://www.tiktok.com/@moon.omens" }])
    ).toEqual(["moon.omens"]);
  });
});

describe("buildRedditApifyInput", () => {
  it("appends /top/?t=week", () => {
    const input = buildRedditApifyInput(["https://reddit.com/r/astrology"]);
    expect(input.startUrls).toEqual([{ url: "https://reddit.com/r/astrology/top/?t=week" }]);
  });
});

describe("enabledWebsiteSources", () => {
  it("respects Enabled column", () => {
    const sites = enabledWebsiteSources([
      { Name: "A", Link: "https://a.com", Enabled: true },
      { Name: "B", Link: "https://b.com", Enabled: false },
    ]);
    expect(sites).toHaveLength(1);
    expect(sites[0]!.url).toBe("https://a.com");
  });
});
