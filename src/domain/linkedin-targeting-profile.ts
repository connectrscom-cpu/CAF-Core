/**
 * Project LinkedIn targeting profile — who/what matters for LinkedIn intelligence.
 * Stored at `criteria_json.market_intelligence.linkedin_targeting`.
 */
export interface LinkedInGeoTargeting {
  languages: string[];
  person_locations: string[];
  company_hq: string[];
}

export interface LinkedInTargetingProfile {
  schema_version: 1;
  /** Original free-text brief from the marketer. */
  free_text: string;
  roles: string[];
  industries: string[];
  company_size_bands: string[];
  companies: string[];
  geo: LinkedInGeoTargeting;
  topics_include: string[];
  topics_exclude: string[];
  /** Soft ranking only — never hard-drop on fit misses. */
  soft_only: true;
  compiled_at?: string;
  compiled_by?: "heuristic" | "llm";
}

export interface LinkedInAuthorContext {
  name?: string | null;
  headline?: string | null;
  title?: string | null;
  company?: string | null;
  company_hq?: string | null;
  location?: string | null;
  language?: string | null;
  followers?: number | null;
  profile_url?: string | null;
}

export interface LinkedInFitBreakdown {
  role_fit: number;
  company_fit: number;
  geo_fit: number;
  topic_fit: number;
  influence: number;
  /** Weighted soft priority 0–1. */
  priority: number;
}

export const EMPTY_LINKEDIN_TARGETING: LinkedInTargetingProfile = {
  schema_version: 1,
  free_text: "",
  roles: [],
  industries: [],
  company_size_bands: [],
  companies: [],
  geo: { languages: [], person_locations: [], company_hq: [] },
  topics_include: [],
  topics_exclude: [],
  soft_only: true,
};

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const t = raw.trim();
    if (!t) continue;
    const key = norm(t);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(t.slice(0, 120));
  }
  return out;
}

function asStringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return uniq(v.map((x) => String(x ?? "")));
}

function tokenOverlap(haystack: string, needles: string[]): number {
  if (!needles.length) return 0.5; // neutral when unconstrained
  const h = norm(haystack);
  if (!h) return 0.25;
  let hits = 0;
  for (const n of needles) {
    const nn = norm(n);
    if (!nn) continue;
    if (h.includes(nn) || nn.split(" ").every((t) => t.length < 3 || h.includes(t))) hits += 1;
  }
  if (hits === 0) return 0.15;
  return clamp01(0.35 + (hits / needles.length) * 0.65);
}

/** Parse stored targeting JSON; returns null if absent/invalid. */
export function parseLinkedInTargetingProfile(raw: unknown): LinkedInTargetingProfile | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const geoRaw = o.geo && typeof o.geo === "object" && !Array.isArray(o.geo) ? (o.geo as Record<string, unknown>) : {};
  return {
    schema_version: 1,
    free_text: String(o.free_text ?? o.freeText ?? "").trim(),
    roles: asStringList(o.roles),
    industries: asStringList(o.industries),
    company_size_bands: asStringList(o.company_size_bands ?? o.companySizeBands),
    companies: asStringList(o.companies),
    geo: {
      languages: asStringList(geoRaw.languages),
      person_locations: asStringList(geoRaw.person_locations ?? geoRaw.personLocations),
      company_hq: asStringList(geoRaw.company_hq ?? geoRaw.companyHq),
    },
    topics_include: asStringList(o.topics_include ?? o.topicsInclude),
    topics_exclude: asStringList(o.topics_exclude ?? o.topicsExclude),
    soft_only: true,
    compiled_at: typeof o.compiled_at === "string" ? o.compiled_at : undefined,
    compiled_by: o.compiled_by === "llm" || o.compiled_by === "heuristic" ? o.compiled_by : undefined,
  };
}

/** Read targeting from processing `criteria_json`. */
export function pickLinkedInTargetingFromCriteria(
  criteria: Record<string, unknown> | null | undefined
): LinkedInTargetingProfile | null {
  if (!criteria) return null;
  const mi = criteria.market_intelligence;
  if (!mi || typeof mi !== "object" || Array.isArray(mi)) return null;
  return parseLinkedInTargetingProfile((mi as Record<string, unknown>).linkedin_targeting);
}

/** Merge targeting into criteria_json without wiping other market_intelligence keys. */
export function mergeLinkedInTargetingIntoCriteria(
  criteria: Record<string, unknown>,
  targeting: LinkedInTargetingProfile
): Record<string, unknown> {
  const prevMi =
    criteria.market_intelligence && typeof criteria.market_intelligence === "object" && !Array.isArray(criteria.market_intelligence)
      ? { ...(criteria.market_intelligence as Record<string, unknown>) }
      : {};
  return {
    ...criteria,
    market_intelligence: {
      ...prevMi,
      linkedin_targeting: targeting,
    },
  };
}

/**
 * Heuristic compile from free text (offline / LLM fallback).
 * Looks for roles, geos, topics from common patterns; keeps the rest as include topics.
 */
export function compileLinkedInTargetingHeuristic(freeText: string): LinkedInTargetingProfile {
  const text = freeText.trim();
  const roles: string[] = [];
  const industries: string[] = [];
  const person_locations: string[] = [];
  const company_hq: string[] = [];
  const languages: string[] = [];
  const topics_include: string[] = [];
  const topics_exclude: string[] = [];
  const companies: string[] = [];
  const company_size_bands: string[] = [];

  const roleHints =
    /\b(cisos?|ceos?|ctos?|cfos?|cros?|cmos?|founders?|co-?founders?|vps?|vice presidents?|heads? of [\w\s/-]+|directors? of [\w\s/-]+|chief [\w\s]+ officers?|security leads?|qa leads?|product managers?|sales directors?|buyers?|procurement)\b/gi;
  for (const m of text.matchAll(roleHints)) {
    roles.push(m[0]!);
  }

  const geoHints: Array<{ re: RegExp; person?: string; hq?: string; lang?: string }> = [
    { re: /\bnetherlands?\b|\bdutch\b|\bnl\b/i, person: "Netherlands", hq: "Netherlands", lang: "nl" },
    { re: /\bportugal\b|\bportuguese\b|\bpt\b/i, person: "Portugal", hq: "Portugal", lang: "pt" },
    { re: /\bunited kingdom\b|\buk\b|\blondon\b/i, person: "United Kingdom", hq: "United Kingdom", lang: "en" },
    { re: /\bunited states\b|\busa\b|\bu\.s\.\b/i, person: "United States", hq: "United States", lang: "en" },
    { re: /\bgermany\b|\bgerman\b/i, person: "Germany", hq: "Germany", lang: "de" },
    { re: /\bfrance\b|\bfrench\b/i, person: "France", hq: "France", lang: "fr" },
    { re: /\beurope\b|\beu\b/i, hq: "Europe" },
  ];
  for (const g of geoHints) {
    if (g.re.test(text)) {
      if (g.person) person_locations.push(g.person);
      if (g.hq) company_hq.push(g.hq);
      if (g.lang) languages.push(g.lang);
    }
  }

  if (/\benglish\b/i.test(text)) languages.push("en");

  // Inline exclude phrases: "exclude consumer apps" / "excluding dating"
  for (const m of text.matchAll(/\bexclud(?:e|ing)\s+([^.;\n]{3,60})/gi)) {
    topics_exclude.push(m[1]!.trim());
  }

  if (/\b(startup|early.?stage)\b/i.test(text)) company_size_bands.push("1-50");
  if (/\b(mid.?size|sme|scale.?up)\b/i.test(text)) company_size_bands.push("51-200", "201-1000");
  if (/\b(enterprise|large company|fortune)\b/i.test(text)) company_size_bands.push("1001-5000", "5001+");

  const industryHints =
    /\b(ai security|cybersecurity|information security|fintech|saas|b2b software|grc|compliance|devops|cloud security)\b/gi;
  for (const m of text.matchAll(industryHints)) {
    industries.push(m[0]!);
  }

  for (const line of text.split(/\n+/)) {
    const t = line.trim();
    if (!t) continue;
    const excl = /^(?:-|exclude:)\s*(.+)$/i.exec(t);
    if (excl) {
      topics_exclude.push(excl[1]!);
      continue;
    }
    const titled = /^(?:title|job|role)\s*:\s*(.+)$/i.exec(t);
    if (titled) {
      roles.push(...titled[1]!.split(/[;,|]/).map((x) => x.trim()));
      continue;
    }
    const market = /^(?:market|location)\s*:\s*(.+)$/i.exec(t);
    if (market) {
      person_locations.push(...market[1]!.split(/[;,|]/).map((x) => x.trim()));
      continue;
    }
    const company = /^company\s*:\s*(.+)$/i.exec(t);
    if (company) {
      companies.push(...company[1]!.split(/[;,|]/).map((x) => x.trim()));
      continue;
    }
    const industry = /^industry\s*:\s*(.+)$/i.exec(t);
    if (industry) {
      industries.push(...industry[1]!.split(/[;,|]/).map((x) => x.trim()));
      continue;
    }
  }

  // Topic crumbs: quoted phrases + remaining meaningful nouns from short sentences
  for (const m of text.matchAll(/"([^"]{3,80})"|'([^']{3,80})'/g)) {
    topics_include.push((m[1] ?? m[2] ?? "").trim());
  }
  if (!topics_include.length && industries.length) {
    topics_include.push(...industries);
  }
  if (!topics_include.length) {
    const crumbs = text
      .split(/[.\n]/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8 && s.length <= 80 && !/^(care about|prefer|exclude)/i.test(s));
    topics_include.push(...crumbs.slice(0, 8));
  }

  return {
    schema_version: 1,
    free_text: text,
    roles: uniq(roles),
    industries: uniq(industries),
    company_size_bands: uniq(company_size_bands),
    companies: uniq(companies),
    geo: {
      languages: uniq(languages),
      person_locations: uniq(person_locations),
      company_hq: uniq(company_hq),
    },
    topics_include: uniq(topics_include),
    topics_exclude: uniq(topics_exclude),
    soft_only: true,
    compiled_at: new Date().toISOString(),
    compiled_by: "heuristic",
  };
}

/** Expand targeting into niche search lines for the LinkedIn scraper. */
export function nicheLinesFromLinkedInTargeting(profile: LinkedInTargetingProfile): string[] {
  const lines: string[] = [];
  for (const role of profile.roles.slice(0, 12)) {
    lines.push(`title: ${role}`);
  }
  for (const loc of profile.geo.person_locations.slice(0, 8)) {
    lines.push(`market: ${loc}`);
  }
  for (const company of profile.companies.slice(0, 8)) {
    lines.push(`company: ${company}`);
  }
  for (const industry of profile.industries.slice(0, 6)) {
    lines.push(industry);
  }
  for (const topic of profile.topics_include.slice(0, 8)) {
    if (!profile.roles.some((r) => norm(r) === norm(topic))) lines.push(topic);
  }
  return uniq(lines);
}

/** Keyword lines (include / exclude) for subject relevance + linkedinkeywords tab. */
export function keywordLinesFromLinkedInTargeting(profile: LinkedInTargetingProfile): string[] {
  const lines = [...profile.topics_include];
  for (const x of profile.topics_exclude) lines.push(`exclude: ${x}`);
  return uniq(lines);
}

export function influenceFromFollowers(followers: number | null | undefined): number {
  const n = typeof followers === "number" && Number.isFinite(followers) && followers > 0 ? followers : 0;
  if (n <= 0) return 0.35; // unknown → mild neutral, not a boost
  // log scale: ~100 → 0.35, ~1k → 0.5, ~10k → 0.65, ~100k → 0.8, ~1M → 0.95
  return clamp01(Math.log1p(n) / Math.log1p(1_000_000));
}

export function scoreLinkedInFit(
  targeting: LinkedInTargetingProfile | null | undefined,
  author: LinkedInAuthorContext,
  postText: string
): LinkedInFitBreakdown {
  const roleHay = `${author.title ?? ""} ${author.headline ?? ""}`;
  const companyHay = `${author.company ?? ""} ${author.headline ?? ""}`;
  const geoHay = `${author.location ?? ""} ${author.company_hq ?? ""} ${author.language ?? ""}`;
  const topicHay = `${postText} ${author.headline ?? ""}`;

  if (!targeting) {
    const influence = influenceFromFollowers(author.followers);
    return {
      role_fit: 0.5,
      company_fit: 0.5,
      geo_fit: 0.5,
      topic_fit: 0.5,
      influence,
      priority: clamp01(0.35 * 0.5 + 0.25 * 0.5 + 0.2 * 0.5 + 0.1 * 0.5 + 0.1 * influence),
    };
  }

  const role_fit = tokenOverlap(roleHay, targeting.roles);
  const companyNeedles = [...targeting.companies, ...targeting.industries];
  const company_fit = tokenOverlap(companyHay, companyNeedles);
  const geoNeedles = [
    ...targeting.geo.person_locations,
    ...targeting.geo.company_hq,
    ...targeting.geo.languages,
  ];
  const geo_fit = tokenOverlap(geoHay, geoNeedles);

  let topic_fit = tokenOverlap(topicHay, targeting.topics_include);
  if (targeting.topics_exclude.length) {
    const exclHit = targeting.topics_exclude.some((x) => norm(topicHay).includes(norm(x)));
    if (exclHit) topic_fit = Math.min(topic_fit, 0.1);
  }

  const influence = influenceFromFollowers(author.followers);

  const priority = clamp01(
    0.3 * topic_fit + 0.25 * role_fit + 0.2 * company_fit + 0.15 * geo_fit + 0.1 * influence
  );

  return {
    role_fit: Math.round(role_fit * 1000) / 1000,
    company_fit: Math.round(company_fit * 1000) / 1000,
    geo_fit: Math.round(geo_fit * 1000) / 1000,
    topic_fit: Math.round(topic_fit * 1000) / 1000,
    influence: Math.round(influence * 1000) / 1000,
    priority: Math.round(priority * 1000) / 1000,
  };
}

/** Author context from a normalized LinkedIn evidence payload. */
export function linkedInAuthorContextFromPayload(payload: Record<string, unknown>): LinkedInAuthorContext {
  const followersRaw = payload.author_followers ?? payload.authorFollowers ?? payload.followers_count;
  let followers: number | null = null;
  if (typeof followersRaw === "number" && Number.isFinite(followersRaw)) followers = followersRaw;
  else if (followersRaw != null && String(followersRaw).trim()) {
    const n = parseFloat(String(followersRaw).replace(/,/g, ""));
    if (Number.isFinite(n) && n > 0) followers = n;
  }
  return {
    name: String(payload.author_name ?? payload.authorName ?? "").trim() || null,
    headline: String(payload.author_headline ?? payload.authorHeadline ?? "").trim() || null,
    title: String(payload.author_title ?? payload.authorTitle ?? "").trim() || null,
    company: String(payload.author_company ?? payload.authorCompany ?? payload.company_name ?? "").trim() || null,
    company_hq: String(payload.company_hq ?? payload.companyHq ?? "").trim() || null,
    location: String(payload.author_location ?? payload.authorLocation ?? "").trim() || null,
    language: String(payload.author_language ?? payload.language ?? "").trim() || null,
    followers,
    profile_url: String(payload.author_url ?? payload.authorUrl ?? "").trim() || null,
  };
}
