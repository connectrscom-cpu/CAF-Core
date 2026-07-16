import { describe, expect, it } from "vitest";
import {
  candidateRowMatchesResearchPlatform,
  ideaJsonMatchesResearchPlatform,
  insightRowMatchesResearchPlatform,
  normalizeResearchBriefPlatformId,
  researchPlatformIdFromEvidenceKind,
  serializeMarketerResearchBriefNotes,
} from "./research-brief-platform.js";

describe("research-brief-platform", () => {
  it("maps evidence kinds to research platform ids", () => {
    expect(researchPlatformIdFromEvidenceKind("linkedin_post")).toBe("linkedin");
    expect(researchPlatformIdFromEvidenceKind("instagram_post")).toBe("instagram");
    expect(researchPlatformIdFromEvidenceKind("scraped_page")).toBe("html");
  });

  it("matches insight rows and ideas to platform scope", () => {
    expect(insightRowMatchesResearchPlatform("linkedin_post", "linkedin")).toBe(true);
    expect(insightRowMatchesResearchPlatform("instagram_post", "linkedin")).toBe(false);
    expect(ideaJsonMatchesResearchPlatform({ platform: "LinkedIn" }, "linkedin")).toBe(true);
    expect(ideaJsonMatchesResearchPlatform({ platform: "Multi" }, "linkedin")).toBe(false);
    expect(candidateRowMatchesResearchPlatform({ platform: "TikTok" }, "tiktok")).toBe(true);
  });

  it("serializes marketer notes with brief scope", () => {
    const notes = serializeMarketerResearchBriefNotes({
      marketerTitle: "LinkedIn · hooks",
      briefScope: "platform",
      platforms: ["linkedin"],
      parentSignalPackId: "parent-uuid",
      postMaxAgeDays: 30,
    });
    const parsed = JSON.parse(notes) as { marketer: Record<string, unknown> };
    expect(parsed.marketer.brief_scope).toBe("platform");
    expect(parsed.marketer.platforms).toEqual(["linkedin"]);
    expect(parsed.marketer.parent_signal_pack_id).toBe("parent-uuid");
  });

  it("normalizes display labels to platform ids", () => {
    expect(normalizeResearchBriefPlatformId("LinkedIn")).toBe("linkedin");
    expect(normalizeResearchBriefPlatformId("websites_blogs")).toBe("html");
  });
});
