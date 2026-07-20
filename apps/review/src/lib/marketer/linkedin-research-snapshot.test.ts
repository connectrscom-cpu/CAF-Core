import { describe, expect, it } from "vitest";
import { resolveLinkedInResearchSnapshot } from "./linkedin-research-snapshot";
import type { LinkedInIntelligenceView } from "./market-intelligence-adapters";

describe("linkedin-research-snapshot", () => {
  const linkedin: LinkedInIntelligenceView = {
    weeklyTopics: [
      {
        id: "t1",
        title: "Agentic AI architecture",
        summary: "2 posts",
        evidenceCount: 2,
        sourceInsightIds: ["ins_1", "ins_2"],
        quotes: [
          {
            personName: "Ajay S.",
            roleOrHeadline: "CTO, AI, Neuro Symbolic AI",
            company: "Acme Labs",
            quote: "Architecture problem",
            insightsId: "ins_1",
          },
          {
            personName: "Ada",
            roleOrHeadline: "CISO",
            company: "SecureCo",
            quote: "Risk framing",
            insightsId: "ins_2",
          },
        ],
      },
    ],
    relevantVoices: [
      {
        personName: "Ajay S.",
        roleOrHeadline: "CTO, AI",
        company: "Acme Labs",
        postCount: 2,
        avgPriority: 0.8,
        sourceInsightIds: ["ins_1"],
        sampleTopics: ["Agentic AI architecture"],
      },
    ],
    distinctPeople: 2,
    distinctCompanies: 2,
    geoSignals: [],
  };

  it("derives job roles, topics, and companies from LinkedIn intelligence", () => {
    const snap = resolveLinkedInResearchSnapshot({ linkedin });
    expect(snap).not.toBeNull();
    expect(snap!.jobRoles.some((r) => r.key === "CTO")).toBe(true);
    expect(snap!.jobRoles.some((r) => r.key === "CISO")).toBe(true);
    expect(snap!.topics[0]!.key).toBe("Agentic AI architecture");
    expect(snap!.companies.some((c) => c.key === "Acme Labs")).toBe(true);
  });

  it("prefers stored LinkedIn lens stats when present", () => {
    const snap = resolveLinkedInResearchSnapshot({
      linkedin,
      researchStats: {
        formats: [{ key: "single_image", count: 99 }],
        hookTypes: [],
        emotions: [{ key: "Concern", count: 32 }],
        platforms: [],
        themes: [{ key: "Stored topic", count: 5, sourceInsightIds: ["x"] }],
        jobRoles: [{ key: "VP Engineering", count: 3, sourceInsightIds: ["y"] }],
        companies: [{ key: "VaultLM", count: 2 }],
        distinctCreators: 4,
        lens: "linkedin",
      },
    });
    expect(snap!.jobRoles[0]!.key).toBe("VP Engineering");
    expect(snap!.topics[0]!.key).toBe("Stored topic");
    expect(snap!.companies[0]!.key).toBe("VaultLM");
  });

  it("returns null for Meta-only briefs without LinkedIn slice", () => {
    expect(
      resolveLinkedInResearchSnapshot({
        researchStats: {
          formats: [{ key: "carousel", count: 3 }],
          hookTypes: [],
          emotions: [{ key: "Curiosity", count: 2 }],
          platforms: [],
          themes: [],
          jobRoles: [],
          companies: [],
          distinctCreators: 2,
        },
      })
    ).toBeNull();
  });
});
