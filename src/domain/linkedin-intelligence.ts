/**
 * LinkedIn-specific market intelligence slice — topics + attributed voices
 * (person-first), not Meta-style hooks/carousels.
 */
import {
  linkedInAuthorContextFromPayload,
  scoreLinkedInFit,
  type LinkedInFitBreakdown,
  type LinkedInTargetingProfile,
} from "./linkedin-targeting-profile.js";

export interface LinkedInAttributedQuoteV1 {
  person_name: string;
  role_or_headline: string | null;
  company: string | null;
  followers: number | null;
  profile_url: string | null;
  post_url: string | null;
  quote: string;
  insights_id: string;
  fit?: LinkedInFitBreakdown;
}

export interface LinkedInTopicClusterV1 {
  id: string;
  title: string;
  summary: string;
  evidence_count: number;
  source_insight_ids: string[];
  quotes: LinkedInAttributedQuoteV1[];
}

export interface LinkedInVoiceV1 {
  person_name: string;
  role_or_headline: string | null;
  company: string | null;
  followers: number | null;
  profile_url: string | null;
  post_count: number;
  avg_priority: number;
  source_insight_ids: string[];
  sample_topics: string[];
}

export interface LinkedInMarketIntelligenceV1 {
  schema_version: 1;
  /** Weekly agenda — what relevant people are talking about. */
  weekly_topics: LinkedInTopicClusterV1[];
  /** People to monitor, ranked by soft fit + activity. */
  relevant_voices: LinkedInVoiceV1[];
  distinct_people: number;
  distinct_companies: number;
  /** Geo/language mix observed in the window. */
  geo_signals: Array<{ key: string; count: number }>;
}

export interface LinkedInIntelRowInput {
  insights_id: string;
  evidence_kind: string;
  pre_llm_score?: string | null;
  why_it_worked?: string | null;
  hook_text?: string | null;
  custom_label_1?: string | null;
  custom_label_2?: string | null;
  custom_label_3?: string | null;
  creator?: string | null;
  source_url?: string | null;
  /** Normalized LinkedIn evidence payload fields. */
  evidence_payload?: Record<string, unknown> | null;
}

function nonEmpty(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t : null;
}

function normalizeTopicKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72);
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function topicSeed(row: LinkedInIntelRowInput): string {
  return (
    nonEmpty(row.custom_label_1) ||
    nonEmpty(row.custom_label_2) ||
    nonEmpty(row.hook_text) ||
    nonEmpty(row.why_it_worked) ||
    "Industry conversation"
  );
}

function quoteFromRow(row: LinkedInIntelRowInput, payload: Record<string, unknown>): string {
  const content = nonEmpty(String(payload.content ?? payload.caption ?? "")) || nonEmpty(row.hook_text) || nonEmpty(row.why_it_worked);
  return truncate(content ?? "LinkedIn post in this research window.", 220);
}

function scoreNum(row: LinkedInIntelRowInput): number {
  const n = row.pre_llm_score != null ? parseFloat(String(row.pre_llm_score)) : NaN;
  return Number.isFinite(n) ? n : 0.4;
}

/** Extract LinkedIn activity id from /posts/...activity-NNN or urn:li:activity:NNN URLs. */
export function linkedInActivityIdFromUrl(url: string): string | null {
  const urn = url.match(/urn:li:activity:(\d+)/i);
  if (urn?.[1]) return urn[1];
  const dash = url.match(/activity-(\d+)/i);
  if (dash?.[1]) return dash[1];
  return null;
}

function normalizeLinkedInPostUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./i, "").toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return url
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, "")
      .replace(/^www\./, "")
      .replace(/[?#].*$/, "")
      .replace(/\/+$/, "");
  }
}

/**
 * All identity keys for a LinkedIn post (activity, URL, content).
 * Rows that share any key are treated as the same post.
 */
export function linkedInIntelPostIdentityKeys(input: {
  source_url?: string | null;
  person: string;
  quote: string;
  evidence_payload?: Record<string, unknown> | null;
}): string[] {
  const payload = input.evidence_payload && typeof input.evidence_payload === "object" ? input.evidence_payload : {};
  const urls = [
    input.source_url,
    payload.post_url,
    payload.linkedin_url,
    payload.url,
    payload.source_url,
  ]
    .map((u) => nonEmpty(String(u ?? "")))
    .filter((u): u is string => Boolean(u));

  const keys: string[] = [];

  for (const url of urls) {
    const activityId = linkedInActivityIdFromUrl(url);
    if (activityId) keys.push(`activity:${activityId}`);
  }

  // Prefer numeric LinkedIn activity ids; ignore opaque Apify actor-local post_ids
  // so content/URL keys can still collapse the same post from divergent scrapes.
  const postId = nonEmpty(String(payload.post_id ?? ""));
  if (postId) {
    const digits = postId.match(/(\d{10,})/);
    if (digits?.[1]) keys.push(`activity:${digits[1]}`);
    else if (/^\d+$/.test(postId)) keys.push(`id:${postId}`);
  }

  for (const url of urls) {
    const n = normalizeLinkedInPostUrl(url);
    if (n) keys.push(`url:${n}`);
  }

  const person = normalizeTopicKey(input.person) || "unknown";
  const content = input.quote
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  if (content.length >= 40) keys.push(`content:${person}:${content}`);

  if (keys.length === 0) {
    if (postId) keys.push(`id:${postId}`);
    else keys.push(`insight:${person}:${content || "empty"}`);
  }

  return [...new Set(keys)];
}

/** Preferred single key (first identity key) — useful for tests / scrape-aligned callers. */
export function linkedInIntelPostDedupeKey(input: {
  source_url?: string | null;
  person: string;
  quote: string;
  evidence_payload?: Record<string, unknown> | null;
}): string {
  return linkedInIntelPostIdentityKeys(input)[0]!;
}

/**
 * Short primary job title from a LinkedIn headline/title
 * (e.g. "CTO, AI, Neuro Symbolic AI" → "CTO").
 */
export function extractLinkedInJobRoleLabel(roleOrHeadline: string | null | undefined): string | null {
  if (typeof roleOrHeadline !== "string") return null;
  let s = roleOrHeadline.trim();
  if (!s) return null;
  if (/^\d+(st|nd|rd|th)\+?$/i.test(s)) return null;

  s = s.split(/\s*[|·•]\s*/)[0]!.trim();
  s = s.split(/\s+@\s+/)[0]!.trim();
  s = s.split(/\s+at\s+/i)[0]!.trim();

  const commaParts = s
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  if (commaParts.length > 1 && commaParts[0]!.length <= 40) {
    s = commaParts[0]!;
  }

  s = s.replace(/\s+/g, " ").trim();
  if (s.length < 2 || s.length > 48) return null;
  return s;
}

function companyLabelForSnapshot(company: string | null | undefined): string | null {
  if (!company) return null;
  const s = company.trim();
  if (!s) return null;
  if (/^\d+(st|nd|rd|th)\+?$/i.test(s)) return null;
  if (s.length < 2) return null;
  return truncate(s, 48);
}

export interface LinkedInResearchStatBucket {
  key: string;
  count: number;
  evidence_urls?: string[];
  source_insight_ids?: string[];
}

/** Person-first snapshot buckets for LinkedIn research briefs (roles / companies). */
export function buildLinkedInResearchStatBuckets(rows: LinkedInIntelRowInput[]): {
  job_roles: LinkedInResearchStatBucket[];
  companies: LinkedInResearchStatBucket[];
} {
  type Acc = { count: number; urls: Set<string>; insightIds: Set<string>; label: string };
  const roles = new Map<string, Acc>();
  const companies = new Map<string, Acc>();

  const bump = (m: Map<string, Acc>, label: string, row: LinkedInIntelRowInput) => {
    const key = label.toLowerCase();
    let acc = m.get(key);
    if (!acc) {
      acc = { count: 0, urls: new Set(), insightIds: new Set(), label };
      m.set(key, acc);
    }
    acc.count += 1;
    const url = nonEmpty(row.source_url);
    if (url && /^https?:\/\//i.test(url)) acc.urls.add(url);
    if (row.insights_id) acc.insightIds.add(row.insights_id);
  };

  for (const row of rows) {
    if (!/linkedin/i.test(row.evidence_kind)) continue;
    const payload = row.evidence_payload && typeof row.evidence_payload === "object" ? row.evidence_payload : {};
    const author = linkedInAuthorContextFromPayload(payload);
    const headline =
      (author.title != null && author.title !== "" ? author.title : null) ??
      (author.headline != null && author.headline !== "" ? author.headline : null);
    const role = extractLinkedInJobRoleLabel(headline);
    if (role) bump(roles, role, row);
    const company = companyLabelForSnapshot(author.company);
    if (company) bump(companies, company, row);
  }

  const topN = (m: Map<string, Acc>, n: number): LinkedInResearchStatBucket[] =>
    [...m.values()]
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
      .slice(0, n)
      .map((acc) => ({
        key: acc.label,
        count: acc.count,
        evidence_urls: [...acc.urls].slice(0, 12),
        source_insight_ids: [...acc.insightIds].slice(0, 48),
      }));

  return {
    job_roles: topN(roles, 8),
    companies: topN(companies, 8),
  };
}

export function buildLinkedInMarketIntelligence(input: {
  rows: LinkedInIntelRowInput[];
  targeting?: LinkedInTargetingProfile | null;
}): LinkedInMarketIntelligenceV1 | null {
  const linkedinRows = input.rows.filter((r) => /linkedin/i.test(r.evidence_kind));
  if (linkedinRows.length === 0) return null;

  type Enriched = {
    row: LinkedInIntelRowInput;
    payload: Record<string, unknown>;
    person: string;
    company: string | null;
    headline: string | null;
    followers: number | null;
    profileUrl: string | null;
    fit: LinkedInFitBreakdown;
    topicKey: string;
    topicTitle: string;
  };

  const enrichedRaw: Enriched[] = [];
  for (const row of linkedinRows) {
    const payload = row.evidence_payload && typeof row.evidence_payload === "object" ? row.evidence_payload : {};
    const author = linkedInAuthorContextFromPayload(payload);
    const person =
      nonEmpty(author.name) ||
      nonEmpty(row.creator) ||
      nonEmpty(String(payload.author_handle ?? "")) ||
      "Unknown voice";
    const postText = String(payload.content ?? payload.caption ?? row.hook_text ?? "");
    const fit = scoreLinkedInFit(input.targeting, author, postText);
    const seed = topicSeed(row);
    const topicKey = normalizeTopicKey(seed) || "conversation";
    enrichedRaw.push({
      row,
      payload,
      person,
      company: author.company != null && author.company !== "" ? author.company : null,
      headline:
        (author.title != null && author.title !== "" ? author.title : null) ??
        (author.headline != null && author.headline !== "" ? author.headline : null),
      followers: typeof author.followers === "number" ? author.followers : null,
      profileUrl: author.profile_url != null && author.profile_url !== "" ? author.profile_url : null,
      fit,
      topicKey,
      topicTitle: truncate(seed, 80),
    });
  }

  // Same LinkedIn post can land as multiple insight rows (search + profile scrape, divergent URLs/IDs).
  // Union rows that share any identity key (activity / URL / content) so counts are not inflated.
  const parent = enrichedRaw.map((_, i) => i);
  const find = (i: number): number => {
    let cur = i;
    while (parent[cur] !== cur) {
      parent[cur] = parent[parent[cur]!]!;
      cur = parent[cur]!;
    }
    return cur;
  };
  const union = (a: number, b: number) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent[rb] = ra;
  };
  const keyToIndex = new Map<string, number>();
  for (let i = 0; i < enrichedRaw.length; i++) {
    const e = enrichedRaw[i]!;
    const keys = linkedInIntelPostIdentityKeys({
      source_url: e.row.source_url,
      person: e.person,
      quote: quoteFromRow(e.row, e.payload),
      evidence_payload: e.payload,
    });
    for (const key of keys) {
      const prev = keyToIndex.get(key);
      if (prev != null) union(prev, i);
      else keyToIndex.set(key, i);
    }
  }
  const bestByRoot = new Map<number, Enriched>();
  for (let i = 0; i < enrichedRaw.length; i++) {
    const e = enrichedRaw[i]!;
    const root = find(i);
    const prev = bestByRoot.get(root);
    if (
      !prev ||
      e.fit.priority > prev.fit.priority ||
      (e.fit.priority === prev.fit.priority && scoreNum(e.row) > scoreNum(prev.row))
    ) {
      bestByRoot.set(root, e);
    }
  }
  const enriched = [...bestByRoot.values()];

  // Topic clusters
  const topicBuckets = new Map<string, Enriched[]>();
  for (const e of enriched) {
    if (!topicBuckets.has(e.topicKey)) topicBuckets.set(e.topicKey, []);
    topicBuckets.get(e.topicKey)!.push(e);
  }

  const weekly_topics: LinkedInTopicClusterV1[] = [...topicBuckets.entries()]
    .map(([key, members]) => {
      const sorted = [...members].sort((a, b) => b.fit.priority - a.fit.priority || scoreNum(b.row) - scoreNum(a.row));
      const quotes: LinkedInAttributedQuoteV1[] = sorted.slice(0, 6).map((m) => ({
        person_name: m.person,
        role_or_headline: m.headline,
        company: m.company,
        followers: m.followers,
        profile_url: m.profileUrl,
        post_url: nonEmpty(m.row.source_url) || nonEmpty(String(m.payload.post_url ?? m.payload.linkedin_url ?? "")),
        quote: quoteFromRow(m.row, m.payload),
        insights_id: m.row.insights_id,
        fit: m.fit,
      }));
      const avgPri = sorted.reduce((s, m) => s + m.fit.priority, 0) / Math.max(1, sorted.length);
      return {
        cluster: {
          id: `li_topic_${key.replace(/\s+/g, "_").slice(0, 40)}`,
          title: sorted[0]?.topicTitle ?? key,
          summary: truncate(
            `${sorted.length} attributed post${sorted.length === 1 ? "" : "s"} from relevant LinkedIn voices on this theme.`,
            280
          ),
          evidence_count: sorted.length,
          source_insight_ids: [...new Set(sorted.map((m) => m.row.insights_id))],
          quotes,
        } satisfies LinkedInTopicClusterV1,
        sort: avgPri * 0.6 + Math.min(1, sorted.length / 5) * 0.4,
      };
    })
    .sort((a, b) => b.sort - a.sort)
    .slice(0, 12)
    .map((x) => x.cluster);

  // Voices
  const voiceBuckets = new Map<string, Enriched[]>();
  for (const e of enriched) {
    const key = normalizeTopicKey(e.profileUrl || e.person);
    if (!voiceBuckets.has(key)) voiceBuckets.set(key, []);
    voiceBuckets.get(key)!.push(e);
  }

  const relevant_voices: LinkedInVoiceV1[] = [...voiceBuckets.values()]
    .map((members) => {
      const head = members[0]!;
      const avg_priority = members.reduce((s, m) => s + m.fit.priority, 0) / members.length;
      const topics = [...new Set(members.map((m) => m.topicTitle))].slice(0, 4);
      return {
        person_name: head.person,
        role_or_headline: head.headline,
        company: head.company,
        followers: head.followers,
        profile_url: head.profileUrl,
        post_count: members.length,
        avg_priority: Math.round(avg_priority * 1000) / 1000,
        source_insight_ids: [...new Set(members.map((m) => m.row.insights_id))],
        sample_topics: topics,
      };
    })
    .sort((a, b) => b.avg_priority - a.avg_priority || b.post_count - a.post_count)
    .slice(0, 20);

  const companies = new Set(enriched.map((e) => normalizeTopicKey(e.company ?? "")).filter(Boolean));
  const geo_counts = new Map<string, number>();
  for (const e of enriched) {
    const loc = nonEmpty(String(e.payload.author_location ?? e.payload.company_hq ?? ""));
    if (!loc) continue;
    const k = truncate(loc, 40);
    geo_counts.set(k, (geo_counts.get(k) ?? 0) + 1);
  }

  return {
    schema_version: 1,
    weekly_topics,
    relevant_voices,
    distinct_people: voiceBuckets.size,
    distinct_companies: companies.size,
    geo_signals: [...geo_counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  };
}
