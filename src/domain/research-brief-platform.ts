/**
 * Platform scoping for research briefs: one overall brief + one per network when multi-platform.
 */

export const RESEARCH_BRIEF_PLATFORM_IDS = [
  "instagram",
  "tiktok",
  "reddit",
  "facebook",
  "linkedin",
  "html",
] as const;

export type ResearchBriefPlatformId = (typeof RESEARCH_BRIEF_PLATFORM_IDS)[number];

export type ResearchBriefScope = "overall" | "platform";

const PLATFORM_ID_SET = new Set<string>(RESEARCH_BRIEF_PLATFORM_IDS);

const PLATFORM_LABELS: Record<ResearchBriefPlatformId, string> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  reddit: "Reddit",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  html: "Websites & blogs",
};

/** Map evidence_kind / display labels to marketer research-platform ids. */
export function researchPlatformIdFromEvidenceKind(evidenceKind: string): ResearchBriefPlatformId | null {
  const k = String(evidenceKind ?? "")
    .trim()
    .toLowerCase();
  if (k === "instagram_post") return "instagram";
  if (k === "tiktok_video") return "tiktok";
  if (k === "reddit_post") return "reddit";
  if (k === "facebook_post") return "facebook";
  if (k === "linkedin_post") return "linkedin";
  if (k === "scraped_page" || k === "html_summary") return "html";
  if (k.includes("instagram")) return "instagram";
  if (k.includes("tiktok")) return "tiktok";
  if (k.includes("reddit")) return "reddit";
  if (k.includes("facebook")) return "facebook";
  if (k.includes("linkedin")) return "linkedin";
  return null;
}

export function normalizeResearchBriefPlatformId(raw: string): ResearchBriefPlatformId | null {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (s === "ig" || s === "instagram") return "instagram";
  if (s === "tt" || s === "tiktok") return "tiktok";
  if (s === "reddit" || s === "subreddit") return "reddit";
  if (s === "fb" || s === "facebook") return "facebook";
  if (s === "linkedin") return "linkedin";
  if (s === "html" || s === "web" || s === "website" || s === "websites" || s === "websites_blogs") return "html";
  return PLATFORM_ID_SET.has(s) ? (s as ResearchBriefPlatformId) : null;
}

export function researchPlatformLabel(platformId: string): string {
  const id = normalizeResearchBriefPlatformId(platformId);
  return id ? PLATFORM_LABELS[id] : platformId;
}

export function insightRowMatchesResearchPlatform(
  evidenceKind: string,
  platformId: ResearchBriefPlatformId
): boolean {
  const rowPlatform = researchPlatformIdFromEvidenceKind(evidenceKind);
  return rowPlatform === platformId;
}

export function ideaJsonMatchesResearchPlatform(idea: Record<string, unknown>, platformId: ResearchBriefPlatformId): boolean {
  const raw = String(idea.platform ?? "").trim();
  if (!raw || /^multi$/i.test(raw)) return false;
  const normalized = normalizeResearchBriefPlatformId(raw);
  if (!normalized) {
    if (platformId === "instagram" && /instagram/i.test(raw)) return true;
    if (platformId === "tiktok" && /tiktok/i.test(raw)) return true;
    if (platformId === "reddit" && /reddit/i.test(raw)) return true;
    if (platformId === "facebook" && /facebook/i.test(raw)) return true;
    if (platformId === "linkedin" && /linkedin/i.test(raw)) return true;
    if (platformId === "html" && /(web|blog|html)/i.test(raw)) return true;
    return false;
  }
  return normalized === platformId;
}

export function candidateRowMatchesResearchPlatform(row: Record<string, unknown>, platformId: ResearchBriefPlatformId): boolean {
  const raw = String(row.platform ?? "").trim();
  if (!raw) return false;
  const normalized = normalizeResearchBriefPlatformId(raw);
  if (normalized) return normalized === platformId;
  if (platformId === "instagram" && /instagram/i.test(raw)) return true;
  if (platformId === "tiktok" && /tiktok/i.test(raw)) return true;
  if (platformId === "reddit" && /reddit/i.test(raw)) return true;
  if (platformId === "facebook" && /facebook/i.test(raw)) return true;
  if (platformId === "linkedin" && /linkedin/i.test(raw)) return true;
  if (platformId === "html" && /(web|blog|html)/i.test(raw)) return true;
  return false;
}

export function serializeMarketerResearchBriefNotes(opts: {
  marketerTitle?: string | null;
  briefScope: ResearchBriefScope;
  platforms: string[];
  parentSignalPackId?: string | null;
  postMaxAgeDays?: number | null;
}): string {
  const platforms = opts.platforms
    .map((p) => normalizeResearchBriefPlatformId(p))
    .filter((p): p is ResearchBriefPlatformId => p != null);
  const unique = [...new Set(platforms)];
  const cleaned: Record<string, unknown> = {
    brief_scope: opts.briefScope,
    platforms: unique.length ? unique : opts.platforms,
  };
  if (opts.marketerTitle?.trim()) cleaned.marketer_title = opts.marketerTitle.trim();
  if (opts.parentSignalPackId) cleaned.parent_signal_pack_id = opts.parentSignalPackId;
  if (opts.postMaxAgeDays != null) cleaned.postMaxAgeDays = opts.postMaxAgeDays;
  return JSON.stringify({ marketer: cleaned });
}
