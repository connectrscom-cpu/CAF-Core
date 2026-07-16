import { describe, expect, it } from "vitest";
import {
  compileLinkedInTargetingHeuristic,
  influenceFromFollowers,
  nicheLinesFromLinkedInTargeting,
  scoreLinkedInFit,
} from "./linkedin-targeting-profile.js";
import { buildLinkedInMarketIntelligence } from "./linkedin-intelligence.js";

describe("linkedin-targeting-profile", () => {
  it("compiles free text into roles, geo, and topics", () => {
    const profile = compileLinkedInTargetingHeuristic(
      "AI security. Care about CISOs and Heads of Security in the Netherlands. Prefer Portuguese-speaking. Exclude consumer apps."
    );
    expect(profile.roles.some((r) => /ciso/i.test(r))).toBe(true);
    expect(profile.geo.person_locations).toContain("Netherlands");
    expect(profile.geo.languages).toEqual(expect.arrayContaining(["nl", "pt"]));
    expect(profile.topics_exclude.some((t) => /consumer/i.test(t))).toBe(true);
    expect(nicheLinesFromLinkedInTargeting(profile).some((l) => l.startsWith("title:"))).toBe(true);
  });

  it("soft-ranks role+topic fit above mismatched posts", () => {
    const targeting = compileLinkedInTargetingHeuristic("CISO cybersecurity Netherlands");
    const strong = scoreLinkedInFit(
      targeting,
      { title: "CISO", company: "Acme Security", location: "Amsterdam, Netherlands", followers: 12000 },
      "Zero trust and AI security for enterprises"
    );
    const weak = scoreLinkedInFit(
      targeting,
      { title: "Intern", company: "Consumer Dating App", location: "Remote", followers: 200000 },
      "Swipe tips for summer"
    );
    expect(strong.priority).toBeGreaterThan(weak.priority);
    expect(influenceFromFollowers(100)).toBeLessThan(influenceFromFollowers(100000));
  });
});

describe("linkedin-intelligence", () => {
  it("builds weekly topics with attributed quotes", () => {
    const intel = buildLinkedInMarketIntelligence({
      targeting: compileLinkedInTargetingHeuristic("CISO AI security"),
      rows: [
        {
          insights_id: "ins_1",
          evidence_kind: "linkedin_post",
          custom_label_1: "AI security governance",
          hook_text: "Boards are asking about AI risk",
          creator: "Ada Example",
          source_url: "https://www.linkedin.com/posts/1",
          evidence_payload: {
            content: "Boards are asking about AI risk this quarter.",
            author_name: "Ada Example",
            author_headline: "CISO",
            author_company: "SecureCo",
            author_followers: 8000,
            author_location: "Netherlands",
          },
        },
        {
          insights_id: "ins_2",
          evidence_kind: "linkedin_post",
          custom_label_1: "AI security governance",
          why_it_worked: "Clear operator framing",
          creator: "Bob Voice",
          evidence_payload: {
            content: "Permission-aware RAG is becoming table stakes.",
            author_name: "Bob Voice",
            author_headline: "Head of Security",
            author_company: "VaultLM",
            author_followers: 2500,
          },
        },
      ],
    });
    expect(intel).not.toBeNull();
    expect(intel!.weekly_topics.length).toBeGreaterThan(0);
    expect(intel!.weekly_topics[0]!.quotes[0]!.person_name).toBeTruthy();
    expect(intel!.relevant_voices.length).toBe(2);
    expect(intel!.distinct_people).toBe(2);
  });
});
