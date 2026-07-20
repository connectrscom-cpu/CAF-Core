import { describe, expect, it } from "vitest";
import {
  compileLinkedInTargetingHeuristic,
  influenceFromFollowers,
  nicheLinesFromLinkedInTargeting,
  scoreLinkedInFit,
} from "./linkedin-targeting-profile.js";
import {
  buildLinkedInMarketIntelligence,
  buildLinkedInResearchStatBuckets,
  extractLinkedInJobRoleLabel,
  linkedInActivityIdFromUrl,
  linkedInIntelPostDedupeKey,
} from "./linkedin-intelligence.js";

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

  it("extracts activity ids from divergent LinkedIn URL shapes", () => {
    expect(
      linkedInActivityIdFromUrl(
        "https://www.linkedin.com/posts/ajay_fire-the-cto-activity-7340123456789012345-abcd"
      )
    ).toBe("7340123456789012345");
    expect(
      linkedInActivityIdFromUrl(
        "https://www.linkedin.com/feed/update/urn:li:activity:7340123456789012345"
      )
    ).toBe("7340123456789012345");
  });

  it("collapses duplicate insight rows for the same LinkedIn post", () => {
    const content =
      "Fire the CTO of that startup now... This isn't an LLM problem. It's an architecture problem.";
    const intel = buildLinkedInMarketIntelligence({
      targeting: compileLinkedInTargetingHeuristic("CTO AI architecture"),
      rows: [
        {
          insights_id: "ins_a",
          evidence_kind: "linkedin_post",
          custom_label_1: "Fire the CTO of that startup now...",
          creator: "Ajay S.",
          source_url:
            "https://www.linkedin.com/posts/ajay_fire-the-cto-activity-7340123456789012345-abcd",
          evidence_payload: {
            content,
            post_id: "actor-search-1",
            author_name: "Ajay S.",
            author_headline: "CTO, AI, Neuro Symbolic AI",
            author_company: "Acme",
          },
        },
        {
          insights_id: "ins_b",
          evidence_kind: "linkedin_post",
          custom_label_1: "Fire the CTO of that startup now...",
          creator: "Ajay S.",
          source_url: "https://www.linkedin.com/feed/update/urn:li:activity:7340123456789012345",
          evidence_payload: {
            content,
            post_id: "actor-profile-2",
            author_name: "Ajay S.",
            author_headline: "CTO, AI, Neuro Symbolic AI",
            author_company: "Acme",
          },
        },
        {
          insights_id: "ins_c",
          evidence_kind: "linkedin_post",
          custom_label_1: "Fire the CTO of that startup now...",
          creator: "Ajay S.",
          evidence_payload: {
            content,
            post_id: "actor-company-3",
            author_name: "Ajay S.",
            author_headline: "CTO, AI, Neuro Symbolic AI",
            author_company: "Acme",
          },
        },
      ],
    });
    expect(intel).not.toBeNull();
    expect(intel!.weekly_topics).toHaveLength(1);
    expect(intel!.weekly_topics[0]!.evidence_count).toBe(1);
    expect(intel!.weekly_topics[0]!.quotes).toHaveLength(1);
    expect(intel!.relevant_voices[0]!.post_count).toBe(1);
  });

  it("collapses same content from one person when company labels differ", () => {
    const content =
      "In this article of my new 'Agentic Healthcare' series, I discuss: How AI Agents are changing healthcare workflows";
    const intel = buildLinkedInMarketIntelligence({
      rows: [
        {
          insights_id: "ins_1",
          evidence_kind: "linkedin_post",
          custom_label_1: "In this article of my new 'Agentic Healthcare' series...",
          creator: "Sujeet Katiyar",
          evidence_payload: {
            content,
            author_name: "Sujeet Katiyar",
            author_company: "Digital Personal Data Protection Act, 2023 (DPDP Act)",
          },
        },
        {
          insights_id: "ins_2",
          evidence_kind: "linkedin_post",
          custom_label_1: "In this article of my new 'Agentic Healthcare' series...",
          creator: "Sujeet Katiyar",
          evidence_payload: {
            content,
            author_name: "Sujeet Katiyar",
            author_company: "DPDP HUB",
          },
        },
      ],
    });
    expect(intel).not.toBeNull();
    expect(intel!.weekly_topics[0]!.evidence_count).toBe(1);
    expect(intel!.weekly_topics[0]!.quotes).toHaveLength(1);
  });

  it("keeps distinct posts from the same person", () => {
    const keyA = linkedInIntelPostDedupeKey({
      person: "Ada",
      quote: "First distinct post about governance.",
      evidence_payload: { content: "First distinct post about governance." },
    });
    const keyB = linkedInIntelPostDedupeKey({
      person: "Ada",
      quote: "Second distinct post about budgets.",
      evidence_payload: { content: "Second distinct post about budgets." },
    });
    expect(keyA).not.toBe(keyB);

    const intel = buildLinkedInMarketIntelligence({
      rows: [
        {
          insights_id: "ins_1",
          evidence_kind: "linkedin_post",
          custom_label_1: "Governance",
          creator: "Ada",
          evidence_payload: {
            content: "First distinct post about governance.",
            author_name: "Ada",
          },
        },
        {
          insights_id: "ins_2",
          evidence_kind: "linkedin_post",
          custom_label_1: "Budgets",
          creator: "Ada",
          evidence_payload: {
            content: "Second distinct post about budgets.",
            author_name: "Ada",
          },
        },
      ],
    });
    expect(intel!.relevant_voices[0]!.post_count).toBe(2);
  });

  it("builds LinkedIn research snapshot buckets for roles and companies", () => {
    expect(extractLinkedInJobRoleLabel("CTO, AI, Neuro Symbolic AI")).toBe("CTO");
    const buckets = buildLinkedInResearchStatBuckets([
      {
        insights_id: "a",
        evidence_kind: "linkedin_post",
        evidence_payload: {
          author_headline: "CTO, AI",
          author_company: "Acme",
        },
      },
      {
        insights_id: "b",
        evidence_kind: "linkedin_post",
        evidence_payload: {
          author_title: "CISO",
          author_company: "SecureCo",
        },
      },
      {
        insights_id: "c",
        evidence_kind: "instagram_post",
        evidence_payload: { author_headline: "Creator" },
      },
    ]);
    expect(buckets.job_roles.map((r) => r.key).sort()).toEqual(["CISO", "CTO"]);
    expect(buckets.companies.map((c) => c.key).sort()).toEqual(["Acme", "SecureCo"]);
  });
});
