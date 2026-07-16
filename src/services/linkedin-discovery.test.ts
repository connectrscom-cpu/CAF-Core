import { describe, expect, it } from "vitest";
import {
  buildProfileSearchInputFromNiche,
  buildSimilarProfileSearchInputFromScrapedProfile,
  linkedinPostDedupeKey,
  parseLinkedInAccountPasteLine,
  parseLinkedInNicheLine,
  personProfileUrlsFromAccountSources,
  postSearchQueryFromNiche,
  splitLinkedInTargetUrls,
} from "./linkedin-discovery.js";

describe("parseLinkedInNicheLine", () => {
  it("treats plain text as searchQuery", () => {
    expect(parseLinkedInNicheLine("B2B SaaS founder")).toMatchObject({
      searchQuery: "B2B SaaS founder",
    });
  });

  it("parses prefixed niche filters", () => {
    expect(parseLinkedInNicheLine("title: VP Marketing, CMO")).toMatchObject({
      currentJobTitles: ["VP Marketing", "CMO"],
    });
    expect(parseLinkedInNicheLine("market: United Kingdom")).toMatchObject({
      locations: ["United Kingdom"],
    });
  });

  it("allows location-only and company-only profile search inputs", () => {
    const loc = buildProfileSearchInputFromNiche(parseLinkedInNicheLine("market: Portugal"), undefined);
    expect(loc).not.toBeNull();
    expect(loc!.locations).toEqual(["Portugal"]);

    const company = buildProfileSearchInputFromNiche(parseLinkedInNicheLine("company: vaultlm"), undefined);
    expect(company).not.toBeNull();
    expect(company!.currentCompanies).toEqual(["vaultlm"]);
  });
});

describe("postSearchQueryFromNiche", () => {
  it("prefers searchQuery then titles", () => {
    expect(postSearchQueryFromNiche(parseLinkedInNicheLine("content marketing"))).toBe(
      "content marketing"
    );
    expect(postSearchQueryFromNiche(parseLinkedInNicheLine("title: Growth Lead"))).toBe("Growth Lead");
  });
});

describe("parseLinkedInAccountPasteLine", () => {
  it("detects | similar suffix", () => {
    expect(
      parseLinkedInAccountPasteLine("https://www.linkedin.com/in/alice/ | similar")
    ).toEqual({
      link: "https://www.linkedin.com/in/alice/",
      deriveSimilar: true,
    });
  });
});

describe("personProfileUrlsFromAccountSources", () => {
  it("collects similar seeds from row flag or suffix", () => {
    const out = personProfileUrlsFromAccountSources(
      [
        { Link: "https://www.linkedin.com/in/alice/ | similar" },
        { Link: "https://www.linkedin.com/in/bob/", deriveSimilar: true },
        { Link: "https://www.linkedin.com/company/acme/" },
      ],
      { deriveSimilarProfilesEnabled: false }
    );
    expect(out.allUrls).toEqual([
      "https://www.linkedin.com/in/alice/",
      "https://www.linkedin.com/in/bob/",
      "https://www.linkedin.com/company/acme/",
    ]);
    expect(out.similarSeedUrls).toEqual([
      "https://www.linkedin.com/in/alice/",
      "https://www.linkedin.com/in/bob/",
    ]);
  });
});

describe("splitLinkedInTargetUrls", () => {
  it("routes company vs profile URLs", () => {
    expect(
      splitLinkedInTargetUrls([
        "https://www.linkedin.com/in/alice/",
        "https://www.linkedin.com/company/acme/",
      ])
    ).toEqual({
      profileUrls: ["https://www.linkedin.com/in/alice/"],
      companyUrls: ["https://www.linkedin.com/company/acme/"],
    });
  });
});

describe("buildSimilarProfileSearchInputFromScrapedProfile", () => {
  it("derives title and company slug", () => {
    const input = buildSimilarProfileSearchInputFromScrapedProfile(
      {
        positions: [{ title: "VP Marketing", companyLinkedinUrl: "https://www.linkedin.com/company/hubspot/" }],
      },
      { similarProfilesPerSeed: 5 }
    );
    expect(input).toMatchObject({
      maxItems: 5,
      currentJobTitles: ["VP Marketing"],
      currentCompanies: ["hubspot"],
    });
  });
});

describe("linkedinPostDedupeKey", () => {
  it("uses post_id when present", () => {
    expect(linkedinPostDedupeKey({ post_id: "123", post_url: "https://x" })).toBe("id:123");
  });
});
