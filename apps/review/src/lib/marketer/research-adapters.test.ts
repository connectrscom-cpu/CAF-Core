import { describe, expect, it } from "vitest";
import {
  RESEARCH_SOURCE_GROUPS,
  buildSourceRowPayload,
  handlesToSourceRows,
  parseHandlesInput,
  parseResearchPaste,
  toResearchSourceGroups,
  filterResearchBriefsByPlatform,
  normalizeResearchBriefPlatforms,
  normalizeResearchPlatformId,
} from "./research-adapters.js";

describe("research-adapters", () => {
  it("exposes all marketer watchlist tabs mapped to Core source_tab names", () => {
    const tabs = RESEARCH_SOURCE_GROUPS.map((g) => g.tab);
    expect(tabs).toEqual([
      "igaccounts",
      "tiktokaccounts",
      "hashtags",
      "subreddits",
      "facebook",
      "linkedinaccounts",
      "linkedinsearches",
      "linkedinkeywords",
      "websites_blogs",
    ]);
  });

  it("parses pasted handles, hashtags, and subreddits", () => {
    expect(parseHandlesInput("@brand\n#tag\nr/marketing")).toEqual(["brand", "tag", "marketing"]);
  });

  it("preserves LinkedIn niche and keyword lines verbatim", () => {
    const paste = "title: VP Marketing\n#SecureAI\nexclude: noise";
    expect(parseResearchPaste(paste, "linkedinsearches")).toEqual(["title: VP Marketing", "#SecureAI", "exclude: noise"]);
    expect(parseResearchPaste(paste, "linkedinkeywords")).toEqual(["title: VP Marketing", "#SecureAI", "exclude: noise"]);
  });

  it("builds scraper-ready rows for each watchlist tab", () => {
    expect(buildSourceRowPayload("@acme", "igaccounts", "Instagram")).toMatchObject({
      Name: "acme",
      Link: "https://www.instagram.com/acme/",
    });
    expect(buildSourceRowPayload("@creator", "tiktokaccounts", "TikTok")).toMatchObject({
      Name: "creator",
      Link: "https://www.tiktok.com/@creator",
    });
    expect(buildSourceRowPayload("#saas", "hashtags", "Multi-platform")).toMatchObject({
      Name: "saas",
      Link: "#saas",
    });
    expect(buildSourceRowPayload("r/marketing", "subreddits", "Reddit")).toMatchObject({
      Name: "marketing",
      Link: "https://www.reddit.com/r/marketing/",
    });
    expect(buildSourceRowPayload("blog.example.com", "websites_blogs", "Web")).toMatchObject({
      Link: "https://blog.example.com",
    });
  });

  it("builds Core source rows with platform metadata", () => {
    const rows = handlesToSourceRows(["acme"], "igaccounts", "Instagram");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.payload_json).toMatchObject({
      Name: "acme",
      Link: "https://www.instagram.com/acme/",
      Platform: "Instagram",
      source_tab: "igaccounts",
    });
  });

  it("round-trips subreddit and hashtag display labels", () => {
    const groups = toResearchSourceGroups({
      subreddits: [{ payload_json: { Name: "marketing", Link: "https://www.reddit.com/r/marketing/" } }],
      hashtags: [{ payload_json: { Name: "saas", Link: "#saas" } }],
    });
    expect(groups.find((g) => g.id === "reddit")?.handles).toEqual(["r/marketing"]);
    expect(groups.find((g) => g.id === "hashtags")?.handles).toEqual(["#saas"]);
  });

  it("round-trips LinkedIn accounts, niches, and keywords for textarea preview", () => {
    const groups = toResearchSourceGroups({
      linkedinaccounts: [
        {
          payload_json: {
            Name: "gleanwork",
            Link: "https://www.linkedin.com/company/gleanwork/",
            deriveSimilar: true,
          },
        },
      ],
      linkedinsearches: [
        {
          payload_json: {
            searchQuery: "title: VP Marketing",
            Name: "title: VP Marketing",
            Link: "title: VP Marketing",
          },
        },
      ],
      linkedinkeywords: [
        {
          payload_json: {
            Name: "#SecureAI",
            keyword: "SecureAI",
            role: "include",
          },
        },
        {
          payload_json: {
            Name: "exclude: unrelated topic",
            keyword: "unrelated topic",
            role: "exclude",
          },
        },
      ],
    });
    expect(groups.find((g) => g.id === "linkedin")?.handles).toEqual([
      "https://www.linkedin.com/company/gleanwork | similar",
    ]);
    expect(groups.find((g) => g.id === "linkedin_searches")?.handles).toEqual(["title: VP Marketing"]);
    expect(groups.find((g) => g.id === "linkedin_keywords")?.handles).toEqual([
      "#SecureAI",
      "exclude: unrelated topic",
    ]);
  });

  it("builds LinkedIn keyword rows with include/exclude roles", () => {
    expect(buildSourceRowPayload("#SecureAI", "linkedinkeywords", "LinkedIn")).toMatchObject({
      Name: "#SecureAI",
      keyword: "#SecureAI",
      role: "include",
    });
    expect(buildSourceRowPayload("exclude: noise", "linkedinkeywords", "LinkedIn")).toMatchObject({
      Name: "exclude: noise",
      keyword: "noise",
      role: "exclude",
    });
  });

  it("derives display handles from Link when Name is empty (workbook import)", () => {
    const groups = toResearchSourceGroups({
      igaccounts: [{ payload_json: { Link: "https://www.instagram.com/acme/" } }],
    });
    expect(groups.find((g) => g.id === "instagram")?.handles).toEqual(["acme"]);
  });

  it("returns every watchlist group even when a project has no saved rows yet", () => {
    const groups = toResearchSourceGroups({});
    expect(groups).toHaveLength(RESEARCH_SOURCE_GROUPS.length);
    expect(groups.every((g) => g.handles.length === 0)).toBe(true);
    expect(groups.map((g) => g.id)).toEqual(RESEARCH_SOURCE_GROUPS.map((g) => g.id));
  });

  it("normalizes platform labels and filters research briefs by platform", () => {
    expect(normalizeResearchPlatformId("Instagram")).toBe("instagram");
    expect(normalizeResearchPlatformId("linkedin_post")).toBe("linkedin");
    expect(normalizeResearchPlatformId("Websites & blogs")).toBe("websites & blogs");

    const briefs = [
      { id: "a", platforms: ["instagram", "tiktok"] },
      { id: "b", platforms: ["LinkedIn"] },
      { id: "c", platforms: [] },
    ];

    expect(normalizeResearchBriefPlatforms(["Instagram", "linkedin_post"])).toEqual(["instagram", "linkedin"]);
    expect(filterResearchBriefsByPlatform(briefs, "all").map((b) => b.id)).toEqual(["a", "b", "c"]);
    expect(filterResearchBriefsByPlatform(briefs, "instagram").map((b) => b.id)).toEqual(["a", "c"]);
    expect(filterResearchBriefsByPlatform(briefs, "linkedin").map((b) => b.id)).toEqual(["b", "c"]);
    expect(filterResearchBriefsByPlatform(briefs, "reddit").map((b) => b.id)).toEqual(["c"]);
  });
});
