import type { ResearchBrief, ResearchSourceGroup } from "./types";

/** Marketer-facing source groups mapped to Core `inputs_source_rows` tabs. */
export const RESEARCH_SOURCE_GROUPS: Array<{
  id: string;
  label: string;
  tab: string;
  platformLabel: string;
  placeholder: string;
  scraper: "instagram" | "tiktok" | "reddit" | "facebook" | "linkedin" | "html" | null;
}> = [
  {
    id: "instagram",
    label: "Instagram accounts",
    tab: "igaccounts",
    platformLabel: "Instagram",
    placeholder: "Paste handles — one per line or comma-separated\n@competitor1\ninspiration.brand",
    scraper: "instagram",
  },
  {
    id: "tiktok",
    label: "TikTok accounts",
    tab: "tiktokaccounts",
    platformLabel: "TikTok",
    placeholder: "Paste handles — one per line\n@creator1\nbrand.official",
    scraper: "tiktok",
  },
  {
    id: "hashtags",
    label: "Hashtags",
    tab: "hashtags",
    platformLabel: "Multi-platform",
    placeholder: "Paste hashtags — one per line\n#contentmarketing\n#saas",
    scraper: "instagram",
  },
  {
    id: "reddit",
    label: "Reddit communities",
    tab: "subreddits",
    platformLabel: "Reddit",
    placeholder: "Paste subreddit names\nr/marketing\nr/saas",
    scraper: "reddit",
  },
  {
    id: "facebook",
    label: "Facebook pages",
    tab: "facebook",
    platformLabel: "Facebook",
    placeholder: "Paste page names or URLs",
    scraper: "facebook",
  },
  {
    id: "linkedin",
    label: "LinkedIn profiles & companies",
    tab: "linkedinaccounts",
    platformLabel: "LinkedIn",
    placeholder:
      "Paste profile or company URLs — one per line\nhttps://www.linkedin.com/in/satyanadella/\nhttps://www.linkedin.com/company/google\n\nAppend | similar to expand from a seed profile:\nhttps://www.linkedin.com/in/alice/ | similar",
    scraper: "linkedin",
  },
  {
    id: "linkedin_searches",
    label: "LinkedIn niches",
    tab: "linkedinsearches",
    platformLabel: "LinkedIn",
    placeholder:
      "Paste niches — job titles, industries, markets, or plain keywords (one per line)\ncontent marketing director\ntitle: VP Marketing\nindustry: software\nmarket: United Kingdom\ncompany: hubspot\n\nOr use the LinkedIn targeting box above to compile free text into niches automatically.",
    scraper: "linkedin",
  },
  {
    id: "linkedin_keywords",
    label: "LinkedIn keywords",
    tab: "linkedinkeywords",
    platformLabel: "LinkedIn",
    placeholder:
      "Paste subject keywords — one per line. Used to keep on-topic LinkedIn posts in research briefs.\n#SecureAI\npermission-aware RAG\nEU AI Act\n\nPrefix with - or exclude: to drop off-topic matches:\n-exclude this phrase\nexclude: unrelated topic",
    scraper: null,
  },
  {
    id: "websites",
    label: "Websites & blogs",
    tab: "websites_blogs",
    platformLabel: "Web",
    placeholder: "Paste URLs — one per line\nhttps://blog.example.com",
    scraper: "html",
  },
];

export function parseHandlesInput(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/^@+/, "").replace(/^#+/, "").replace(/^r\//i, ""))
    .filter(Boolean);
}

/** Preserve niche/keyword lines verbatim (title:, industry:, #hashtags, exclude:). */
export function parseResearchPaste(text: string, tab: string): string[] {
  if (tab === "linkedinsearches" || tab === "linkedinkeywords") {
    return text
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return parseHandlesInput(text);
}

/** Build a Core `inputs_source_rows` payload in the shape scrapers expect. */
export function buildSourceRowPayload(
  raw: string,
  tab: string,
  platformLabel: string
): Record<string, unknown> {
  const trimmed = raw.trim();
  const bare = trimmed.replace(/^@+/, "").replace(/^#+/, "").replace(/^r\//i, "");

  switch (tab) {
    case "igaccounts": {
      const handle = bare;
      return {
        Name: handle,
        Link: `https://www.instagram.com/${handle}/`,
        Platform: platformLabel,
        source_tab: tab,
      };
    }
    case "tiktokaccounts": {
      const link = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://www.tiktok.com/@${bare}`;
      return {
        Name: bare,
        Link: link,
        Platform: platformLabel,
        source_tab: tab,
      };
    }
    case "hashtags":
      return {
        Name: bare,
        Link: `#${bare}`,
        Platform: platformLabel,
        source_tab: tab,
      };
    case "subreddits":
      return {
        Name: bare,
        Link: `https://www.reddit.com/r/${bare}/`,
        Platform: platformLabel,
        source_tab: tab,
      };
    case "facebook": {
      const link = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://www.facebook.com/${trimmed.replace(/^\/+/, "")}`;
      return {
        Name: trimmed,
        Link: link,
        Platform: platformLabel,
        source_tab: tab,
      };
    }
    case "linkedinaccounts": {
      const parsed = trimmed.match(/^(.*?)(?:\s*[|]\s*similar\s*)$/i);
      const linkText = (parsed ? parsed[1]! : trimmed).trim();
      const deriveSimilar = Boolean(parsed);
      const linkBare = linkText.replace(/^@+/, "");
      const link = /^https?:\/\//i.test(linkText)
        ? linkText
        : linkText.includes("/company/")
          ? `https://www.linkedin.com/company/${linkBare.replace(/^company\//i, "")}/`
          : `https://www.linkedin.com/in/${linkBare}/`;
      return {
        Name: linkBare,
        Link: link,
        Platform: platformLabel,
        source_tab: tab,
        ...(deriveSimilar ? { deriveSimilar: true } : {}),
      };
    }
    case "linkedinsearches": {
      const query = trimmed;
      return {
        Name: query,
        Link: query,
        searchQuery: query,
        Platform: platformLabel,
        source_tab: tab,
      };
    }
    case "linkedinkeywords": {
      const excludeMatch = trimmed.match(/^-\s*(.+)$/) || trimmed.match(/^exclude:\s*(.+)$/i);
      const keyword = excludeMatch ? excludeMatch[1]!.trim() : trimmed;
      const role = excludeMatch ? "exclude" : "include";
      return {
        Name: trimmed,
        Link: keyword,
        keyword,
        role,
        Platform: platformLabel,
        source_tab: tab,
      };
    }
    case "websites_blogs": {
      const link = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
      return {
        Name: trimmed,
        Link: link,
        Platform: platformLabel,
        source_tab: tab,
      };
    }
    default:
      return {
        Name: bare,
        Link: trimmed,
        Platform: platformLabel,
        source_tab: tab,
      };
  }
}

export function handlesToSourceRows(
  handles: string[],
  tab: string,
  platformLabel: string
): Array<{ row_index: number; enabled: boolean; payload_json: Record<string, unknown> }> {
  return handles.map((handle, row_index) => ({
    row_index,
    enabled: true,
    payload_json: buildSourceRowPayload(handle, tab, platformLabel),
  }));
}

function handleFromSourcePayload(
  p: Record<string, unknown>,
  tab?: string
): string {
  if (tab === "linkedinkeywords") {
    const stored = String(p.Name ?? p.keyword ?? p.Link ?? "").trim();
    if (stored) return stored;
    const role = String(p.role ?? "").trim();
    const keyword = String(p.keyword ?? p.Link ?? "").trim();
    if (!keyword) return "";
    return role === "exclude" ? `exclude: ${keyword}` : keyword;
  }

  if (tab === "linkedinsearches") {
    return String(p.searchQuery ?? p.SearchQuery ?? p.Name ?? p.Link ?? "").trim();
  }

  let name = String(p.Name ?? p.handle ?? p.name ?? "").trim();
  const link = String(p.Link ?? p.link ?? p.url ?? "").trim();

  if (tab === "linkedinaccounts") {
    const deriveSimilar = p.deriveSimilar === true;
    const linkedInUrl = [link, name].find((v) => /^https?:\/\/.*linkedin\.com/i.test(v));
    if (linkedInUrl) {
      const base = linkedInUrl.replace(/\/+$/, "");
      return deriveSimilar ? `${base} | similar` : base;
    }
    if (name) return deriveSimilar ? `${name} | similar` : name;
    return "";
  }

  if (tab === "websites_blogs" || tab === "facebook") {
    if (/^https?:\/\//i.test(link)) return link;
    if (/^https?:\/\//i.test(name)) return name;
  }

  if (!name && link) {
    if (tab === "hashtags") {
      name = link.replace(/^#+/, "");
    } else if (tab === "subreddits") {
      name = link.match(/reddit\.com\/r\/([^/?#\s]+)/i)?.[1] ?? link.replace(/^r\//i, "");
    } else if (tab === "tiktokaccounts") {
      name = link.match(/tiktok\.com\/@([^/?#\s]+)/i)?.[1] ?? link.replace(/^@+/, "");
    } else if (tab === "igaccounts") {
      name = link.match(/instagram\.com\/([^/?#\s]+)/i)?.[1] ?? link.replace(/^@+/, "");
    } else {
      name = link.replace(/^https?:\/\/(www\.)?/i, "");
    }
  }
  if (!name) return "";
  if (tab === "subreddits") return name.startsWith("r/") ? name : `r/${name}`;
  if (tab === "hashtags") return name.startsWith("#") ? name : `#${name}`;
  return name;
}

export function rowsToHandles(
  rows: Array<{ payload_json?: Record<string, unknown> }>,
  tab?: string
): string[] {
  return rows
    .map((r) => handleFromSourcePayload(r.payload_json ?? {}, tab))
    .filter(Boolean);
}

export const RESEARCH_RUN_PLATFORMS = [
  { id: "instagram" as const, label: "Instagram" },
  { id: "tiktok" as const, label: "TikTok" },
  { id: "reddit" as const, label: "Reddit" },
  { id: "facebook" as const, label: "Facebook" },
  { id: "linkedin" as const, label: "LinkedIn" },
  { id: "html" as const, label: "Websites & blogs" },
];

export const RESEARCH_POST_AGE_OPTIONS = [
  { days: 7, label: "Last 7 days" },
  { days: 14, label: "Last 2 weeks" },
  { days: 30, label: "Last 30 days" },
  { days: 60, label: "Last 60 days" },
  { days: 90, label: "Last 90 days" },
] as const;

export const DEFAULT_RESEARCH_PLATFORMS = ["instagram", "tiktok"] as const;
export const DEFAULT_RESEARCH_POST_AGE_DAYS = 30;

const RESEARCH_PLATFORM_ID_SET = new Set(RESEARCH_RUN_PLATFORMS.map((p) => p.id));

/** Normalize scraper ids, evidence kinds, and display labels to marketer run-platform ids. */
export function normalizeResearchPlatformId(raw: string): string {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase();
  if (!s) return "";
  if (s === "ig" || s === "instagram" || s === "instagram_post") return "instagram";
  if (s === "tt" || s === "tiktok" || s === "tiktok_video") return "tiktok";
  if (s === "reddit" || s === "reddit_post" || s === "subreddit") return "reddit";
  if (s === "fb" || s === "facebook" || s === "facebook_post") return "facebook";
  if (s === "linkedin" || s === "linkedin_post") return "linkedin";
  if (
    s === "html" ||
    s === "web" ||
    s === "website" ||
    s === "websites" ||
    s === "websites_blogs" ||
    s === "scraped_page" ||
    s === "html_summary"
  ) {
    return "html";
  }
  return s;
}

export function normalizeResearchBriefPlatforms(platforms: string[]): string[] {
  const out: string[] = [];
  for (const raw of platforms) {
    const id = normalizeResearchPlatformId(raw);
    if (id && RESEARCH_PLATFORM_ID_SET.has(id as (typeof RESEARCH_RUN_PLATFORMS)[number]["id"])) {
      if (!out.includes(id)) out.push(id);
    }
  }
  return out;
}

export function researchBriefMatchesPlatformFilter(
  brief: Pick<ResearchBrief, "platforms">,
  platformFilter: string
): boolean {
  const filter = normalizeResearchPlatformId(platformFilter);
  if (!filter || filter === "all") return true;
  const platforms = normalizeResearchBriefPlatforms(brief.platforms ?? []);
  // Untagged / legacy briefs: don't hide them behind a platform filter.
  if (!platforms.length) return true;
  return platforms.includes(filter);
}

export function filterResearchBriefsByPlatform<T extends Pick<ResearchBrief, "platforms">>(
  briefs: T[],
  platformFilter: string
): T[] {
  const filter = normalizeResearchPlatformId(platformFilter);
  if (!filter || filter === "all") return briefs;
  return briefs.filter((brief) => researchBriefMatchesPlatformFilter(brief, filter));
}

export function toResearchSourceGroups(
  rowsByTab: Record<string, Array<{ payload_json?: Record<string, unknown> }>>
): ResearchSourceGroup[] {
  return RESEARCH_SOURCE_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    tab: g.tab,
    placeholder: g.placeholder,
    handles: rowsToHandles(rowsByTab[g.tab] ?? [], g.tab),
  }));
}
