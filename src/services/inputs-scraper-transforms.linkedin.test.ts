import { describe, expect, it } from "vitest";
import {
  extractLinkedInProfileUrl,
  linkedinUrlsFromSources,
  normalizeLinkedInTargetUrl,
  transformLinkedInApifyPost,
} from "./inputs-scraper-transforms.js";

describe("normalizeLinkedInTargetUrl", () => {
  it("normalizes profile handles to canonical URLs", () => {
    expect(normalizeLinkedInTargetUrl({ Link: "satyanadella" })).toBe(
      "https://www.linkedin.com/in/satyanadella/"
    );
  });

  it("normalizes company pages", () => {
    expect(normalizeLinkedInTargetUrl({ Link: "https://www.linkedin.com/company/google/" })).toBe(
      "https://www.linkedin.com/company/google/"
    );
  });
});

describe("linkedinUrlsFromSources", () => {
  it("dedupes account sources", () => {
    const out = linkedinUrlsFromSources([
      { Link: "https://www.linkedin.com/in/alice/" },
      { Link: "alice" },
    ]);
    expect(out).toEqual(["https://www.linkedin.com/in/alice/"]);
  });
});

describe("extractLinkedInProfileUrl", () => {
  it("reads linkedinUrl from search actor rows", () => {
    expect(
      extractLinkedInProfileUrl({
        publicIdentifier: "towhid-rahman",
        linkedinUrl: "https://www.linkedin.com/in/towhid-rahman",
      })
    ).toBe("https://www.linkedin.com/in/towhid-rahman");
  });
});

describe("transformLinkedInApifyPost", () => {
  it("maps harvestapi post payload into CAF evidence shape", () => {
    const row = transformLinkedInApifyPost(
      {
      type: "post",
      id: "7329207003942125568",
      linkedinUrl:
        "https://www.linkedin.com/posts/williamhgates_how-better-data-helped-us-cut-child-mortality-activity-7329207003942125568-_gfJ",
      content: "The leading causes of childhood death reveal a stark truth.",
      author: {
        publicIdentifier: "williamhgates",
        name: "Bill Gates",
        linkedinUrl: "https://www.linkedin.com/in/williamhgates",
        info: "Chair, Gates Foundation",
        type: "profile",
      },
      postedAt: { date: "2025-05-16T18:11:59.821Z" },
      postImages: [
        {
          url: "https://media.licdn.com/dms/image/example.jpg",
        },
      ],
      engagement: { likes: 2916, comments: 328, shares: 153 },
    },
      { discovery_source: "post_search", discovery_query: "child mortality" }
    );

    expect(row).toMatchObject({
      platform: "LinkedIn",
      source_platform: "linkedin",
      post_id: "7329207003942125568",
      media_type: "image",
      author_name: "Bill Gates",
      author_handle: "williamhgates",
      likes: 2916,
      comments: 328,
      shares: 153,
      caption: "The leading causes of childhood death reveal a stark truth.",
      discovery_source: "post_search",
      discovery_query: "child mortality",
    });
    expect(row?.image_url).toContain("licdn.com");
  });

  it("classifies document posts", () => {
    const row = transformLinkedInApifyPost({
      type: "post",
      id: "1",
      linkedinUrl: "https://www.linkedin.com/posts/example",
      content: "Read this deck",
      document: { title: "Deck title", totalPageCount: 3, coverPages: [{ imageUrls: ["https://media.licdn.com/a.jpg"] }] },
      engagement: { likes: 10, comments: 1, shares: 0 },
    });
    expect(row?.media_type).toBe("document");
    expect(row?.document_title).toBe("Deck title");
  });
});
