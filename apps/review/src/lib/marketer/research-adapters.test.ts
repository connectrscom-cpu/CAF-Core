import { describe, expect, it } from "vitest";
import {
  RESEARCH_SOURCE_GROUPS,
  buildSourceRowPayload,
  handlesToSourceRows,
  parseHandlesInput,
  toResearchSourceGroups,
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
      "websites_blogs",
    ]);
  });

  it("parses pasted handles, hashtags, and subreddits", () => {
    expect(parseHandlesInput("@brand\n#tag\nr/marketing")).toEqual(["brand", "tag", "marketing"]);
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
});
