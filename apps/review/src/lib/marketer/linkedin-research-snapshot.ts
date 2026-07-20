/**
 * LinkedIn-shaped Research snapshot columns (roles / topics / companies).
 * Works from stored research_stats.lens or derived from linkedin intelligence for older packs.
 */
import { extractLinkedInJobRoleLabel } from "../../../../../src/domain/linkedin-intelligence";
import type { LinkedInIntelligenceView, ResearchStatsView } from "./market-intelligence-adapters";

export type SnapshotStatBucket = {
  key: string;
  count: number;
  evidenceUrls?: string[];
  sourceInsightIds?: string[];
};

export interface LinkedInResearchSnapshotView {
  jobRoles: SnapshotStatBucket[];
  topics: SnapshotStatBucket[];
  companies: SnapshotStatBucket[];
}

function companyLabel(company: string | null | undefined): string | null {
  if (!company?.trim()) return null;
  const s = company.trim();
  if (/^\d+(st|nd|rd|th)\+?$/i.test(s)) return null;
  if (s.length < 2) return null;
  return s.length > 48 ? `${s.slice(0, 47)}…` : s;
}

function bump(
  m: Map<string, { label: string; count: number; ids: Set<string> }>,
  label: string,
  insightId?: string
) {
  const key = label.toLowerCase();
  let acc = m.get(key);
  if (!acc) {
    acc = { label, count: 0, ids: new Set() };
    m.set(key, acc);
  }
  acc.count += 1;
  if (insightId) acc.ids.add(insightId);
}

function topBuckets(
  m: Map<string, { label: string; count: number; ids: Set<string> }>,
  n: number
): SnapshotStatBucket[] {
  return [...m.values()]
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, n)
    .map((acc) => ({
      key: acc.label,
      count: acc.count,
      sourceInsightIds: [...acc.ids].slice(0, 48),
    }));
}

function deriveFromLinkedIn(li: LinkedInIntelligenceView): LinkedInResearchSnapshotView {
  const roles = new Map<string, { label: string; count: number; ids: Set<string> }>();
  const companies = new Map<string, { label: string; count: number; ids: Set<string> }>();

  for (const topic of li.weeklyTopics) {
    for (const q of topic.quotes) {
      const role = extractLinkedInJobRoleLabel(q.roleOrHeadline);
      if (role) bump(roles, role, q.insightsId);
      const company = companyLabel(q.company);
      if (company) bump(companies, company, q.insightsId);
    }
  }
  for (const voice of li.relevantVoices) {
    const role = extractLinkedInJobRoleLabel(voice.roleOrHeadline);
    if (role) bump(roles, role, voice.sourceInsightIds[0]);
    const company = companyLabel(voice.company);
    if (company) bump(companies, company, voice.sourceInsightIds[0]);
  }

  const topics: SnapshotStatBucket[] = li.weeklyTopics.slice(0, 8).map((t) => ({
    key: t.title,
    count: t.evidenceCount,
    sourceInsightIds: t.sourceInsightIds.slice(0, 48),
  }));

  return {
    jobRoles: topBuckets(roles, 8),
    topics,
    companies: topBuckets(companies, 8),
  };
}

/** Prefer stored LinkedIn lens stats; fall back to deriving from linkedin intelligence. */
export function resolveLinkedInResearchSnapshot(input: {
  linkedin?: LinkedInIntelligenceView | null;
  researchStats?: ResearchStatsView | null;
}): LinkedInResearchSnapshotView | null {
  const stats = input.researchStats;
  const storedLens =
    stats?.lens === "linkedin" ||
    (stats?.jobRoles?.length ?? 0) > 0 ||
    (stats?.companies?.length ?? 0) > 0;

  if (storedLens && stats) {
    const topics =
      stats.themes.length > 0
        ? stats.themes
        : input.linkedin
          ? deriveFromLinkedIn(input.linkedin).topics
          : [];
    const jobRoles = stats.jobRoles.length
      ? stats.jobRoles
      : input.linkedin
        ? deriveFromLinkedIn(input.linkedin).jobRoles
        : [];
    const companies = stats.companies.length
      ? stats.companies
      : input.linkedin
        ? deriveFromLinkedIn(input.linkedin).companies
        : [];
    if (!jobRoles.length && !topics.length && !companies.length) return null;
    return { jobRoles, topics, companies };
  }

  if (input.linkedin && (input.linkedin.weeklyTopics.length > 0 || input.linkedin.relevantVoices.length > 0)) {
    return deriveFromLinkedIn(input.linkedin);
  }

  return null;
}
