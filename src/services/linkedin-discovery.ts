/**
 * LinkedIn discovery helpers — niche parsing, URL routing, similar-profile expansion.
 */
import type { LinkedInScraperConfig } from "./inputs-scraper-apify-config.js";
import { normalizeLinkedInTargetUrl } from "./inputs-scraper-transforms.js";

export type LinkedInDiscoverySource =
  | "manual_account"
  | "profile_search"
  | "post_search"
  | "similar_profile";

export function isLinkedInCompanyUrl(url: string): boolean {
  return /linkedin\.com\/company\//i.test(url);
}

export function isLinkedInPersonProfileUrl(url: string): boolean {
  return /linkedin\.com\/in\//i.test(url);
}

export function splitLinkedInTargetUrls(urls: string[]): { profileUrls: string[]; companyUrls: string[] } {
  const profileUrls: string[] = [];
  const companyUrls: string[] = [];
  const seen = new Set<string>();
  for (const raw of urls) {
    const u = raw.trim();
    if (!u || seen.has(u)) continue;
    seen.add(u);
    if (isLinkedInCompanyUrl(u)) companyUrls.push(u);
    else profileUrls.push(u);
  }
  return { profileUrls, companyUrls };
}

function truthyFlag(v: unknown): boolean {
  if (v === true || v === 1) return true;
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y" || s === "on";
}

/** Per-row or global toggle for similar-profile expansion from seed person profiles. */
export function shouldDeriveSimilarProfiles(
  row: Record<string, unknown>,
  cfg: LinkedInScraperConfig | undefined
): boolean {
  if (row.deriveSimilar != null) return truthyFlag(row.deriveSimilar);
  if (row.DeriveSimilar != null) return truthyFlag(row.DeriveSimilar);
  return cfg?.deriveSimilarProfilesEnabled === true;
}

/** Strip `| similar` suffix from pasted profile lines. */
export function parseLinkedInAccountPasteLine(raw: string): { link: string; deriveSimilar: boolean } {
  const trimmed = raw.trim();
  const m = /^(.*?)(?:\s*[|]\s*similar\s*)$/i.exec(trimmed);
  if (m) {
    return { link: m[1]!.trim(), deriveSimilar: true };
  }
  return { link: trimmed, deriveSimilar: false };
}

export interface ParsedLinkedInNiche {
  searchQuery?: string;
  currentJobTitles?: string[];
  locations?: string[];
  currentCompanies?: string[];
  industryIds?: string[];
  raw: string;
}

const NICHE_PREFIX_RE =
  /^(title|job|role|industry|market|location|company|school)\s*:\s*(.+)$/i;

function splitCsvOrSingle(v: string): string[] {
  return [
    ...new Set(
      v
        .split(/[;,|]/)
        .map((x) => x.trim())
        .filter(Boolean)
    ),
  ];
}

/** Parse one niche line into profile-search filters. Plain text → searchQuery. */
export function parseLinkedInNicheLine(raw: string): ParsedLinkedInNiche {
  const text = String(raw ?? "").trim();
  if (!text) return { raw: "" };

  const m = NICHE_PREFIX_RE.exec(text);
  if (!m) return { raw: text, searchQuery: text };

  const kind = m[1]!.toLowerCase();
  const value = m[2]!.trim();
  if (!value) return { raw: text, searchQuery: text };

  if (kind === "title" || kind === "job" || kind === "role") {
    return { raw: text, currentJobTitles: splitCsvOrSingle(value) };
  }
  if (kind === "industry") {
    const ids = splitCsvOrSingle(value)
      .map((x) => parseInt(x, 10))
      .filter((n) => !Number.isNaN(n))
      .map(String);
    if (ids.length > 0) return { raw: text, industryIds: ids };
    return { raw: text, searchQuery: value };
  }
  if (kind === "market" || kind === "location") {
    return { raw: text, locations: splitCsvOrSingle(value) };
  }
  if (kind === "company") {
    const companies = splitCsvOrSingle(value).map((c) =>
      c.includes("linkedin.com") ? c.replace(/^https?:\/\/(www\.)?linkedin\.com\/company\//i, "").replace(/\/+$/, "") : c
    );
    return { raw: text, currentCompanies: companies };
  }
  return { raw: text, searchQuery: value };
}

export function nicheTextFromSource(row: Record<string, unknown>): string {
  return String(
    row.searchQuery ?? row.SearchQuery ?? row.Link ?? row.link ?? row.Name ?? row.name ?? ""
  ).trim();
}

export function buildProfileSearchInputFromNiche(
  niche: ParsedLinkedInNiche,
  cfg: LinkedInScraperConfig | undefined
): Record<string, unknown> | null {
  const input: Record<string, unknown> = {
    maxItems: cfg?.profileSearchMaxItems ?? 20,
  };
  if (niche.searchQuery) input.searchQuery = niche.searchQuery;
  if (niche.currentJobTitles?.length) input.currentJobTitles = niche.currentJobTitles;
  if (niche.locations?.length) input.locations = niche.locations;
  if (niche.currentCompanies?.length) input.currentCompanies = niche.currentCompanies;
  if (niche.industryIds?.length) input.industryIds = niche.industryIds;
  // Location-only / company-only niches are valid LinkedIn discovery inputs.
  if (
    !input.searchQuery &&
    !niche.currentJobTitles?.length &&
    !niche.industryIds?.length &&
    !niche.locations?.length &&
    !niche.currentCompanies?.length
  ) {
    return null;
  }
  return input;
}

/** Build similar-profile search input from a profile-scraper row. */
export function buildSimilarProfileSearchInputFromScrapedProfile(
  profile: Record<string, unknown>,
  cfg: LinkedInScraperConfig | undefined
): Record<string, unknown> | null {
  const positions = Array.isArray(profile.positions) ? profile.positions : [];
  const current = (positions[0] ?? profile.currentPosition ?? profile.current_position) as
    | Record<string, unknown>
    | undefined;

  const title = String(
    current?.title ?? profile.headline ?? profile.info ?? profile.tagline ?? ""
  ).trim();
  const companyName = String(current?.companyName ?? current?.company ?? "").trim();
  const companyUrl = String(current?.companyLinkedinUrl ?? current?.companyUrl ?? "").trim();

  const input: Record<string, unknown> = {
    maxItems: cfg?.similarProfilesPerSeed ?? cfg?.profileSearchMaxItems ?? 10,
  };

  if (title) input.currentJobTitles = [title.slice(0, 120)];
  const companies: string[] = [];
  if (companyUrl && /linkedin\.com\/company\//i.test(companyUrl)) {
    const slug = companyUrl.match(/linkedin\.com\/company\/([^/?#\s]+)/i)?.[1];
    if (slug) companies.push(slug);
  } else if (companyName) {
    input.searchQuery = `${title} ${companyName}`.trim().slice(0, 85);
  }
  if (companies.length) input.currentCompanies = companies;
  if (!input.searchQuery && !input.currentJobTitles) return null;
  return input;
}

export function personProfileUrlsFromAccountSources(
  rows: Record<string, unknown>[],
  cfg: LinkedInScraperConfig | undefined
): { allUrls: string[]; similarSeedUrls: string[] } {
  const allUrls: string[] = [];
  const similarSeedUrls: string[] = [];
  for (const row of rows) {
    const linkRaw = String(row.Link ?? row.link ?? row.URL ?? row.url ?? "").trim();
    let workingRow = row;
    if (linkRaw) {
      const parsed = parseLinkedInAccountPasteLine(linkRaw);
      if (parsed.deriveSimilar) {
        workingRow = { ...row, Link: parsed.link, deriveSimilar: true };
      }
    }
    const url = normalizeLinkedInTargetUrl(workingRow);
    if (!url) continue;
    if (!isLinkedInPersonProfileUrl(url)) {
      allUrls.push(url);
      continue;
    }
    allUrls.push(url);
    if (shouldDeriveSimilarProfiles(workingRow, cfg)) similarSeedUrls.push(url);
  }
  return {
    allUrls: [...new Set(allUrls)],
    similarSeedUrls: [...new Set(similarSeedUrls)],
  };
}

export function authorProfileUrlFromPost(item: Record<string, unknown>): string | null {
  const author = (item.author ?? {}) as Record<string, unknown>;
  const url = String(author.linkedinUrl ?? author.linkedin_url ?? item.author_url ?? "").trim();
  if (url && isLinkedInPersonProfileUrl(url)) return normalizeLinkedInTargetUrl({ Link: url });
  const id = String(author.publicIdentifier ?? author.public_identifier ?? "").trim();
  if (id) return normalizeLinkedInTargetUrl({ Link: id });
  return null;
}

export function postEngagementLikes(item: Record<string, unknown>): number {
  const engagement = (item.engagement ?? {}) as Record<string, unknown>;
  const n = Number(engagement.likes ?? item.likes ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function postSearchQueryFromNiche(niche: ParsedLinkedInNiche): string {
  if (niche.searchQuery?.trim()) return niche.searchQuery.trim();
  if (niche.currentJobTitles?.length) return niche.currentJobTitles.join(" ");
  if (niche.currentCompanies?.length) return niche.currentCompanies.join(" ");
  if (niche.locations?.length) return niche.locations.join(" ");
  return niche.raw.trim();
}

export function linkedinPostDedupeKey(row: Record<string, unknown>): string {
  const postId = String(row.post_id ?? "").trim();
  if (postId) return `id:${postId}`;
  const postUrl = String(row.post_url ?? row.linkedin_url ?? row.url ?? "").trim();
  if (postUrl) return `url:${postUrl}`;
  const content = String(row.content ?? row.caption ?? "").slice(0, 120);
  const author = String(row.author_handle ?? row.author_name ?? "").trim();
  return `fallback:${author}:${content}`;
}

export function mergeDiscoveryContext(
  row: Record<string, unknown>,
  ctx: {
    discovery_source: LinkedInDiscoverySource;
    discovery_query?: string | null;
    seed_profile_url?: string | null;
  }
): Record<string, unknown> {
  return {
    ...row,
    discovery_source: ctx.discovery_source,
    ...(ctx.discovery_query ? { discovery_query: ctx.discovery_query } : {}),
    ...(ctx.seed_profile_url ? { seed_profile_url: ctx.seed_profile_url } : {}),
  };
}
