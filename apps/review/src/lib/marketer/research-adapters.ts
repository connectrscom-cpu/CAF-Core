import type { ResearchSourceGroup } from "./types";

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
      "Paste profile or company URLs — one per line\nhttps://www.linkedin.com/in/satyanadella/\nhttps://www.linkedin.com/company/google",
    scraper: "linkedin",
  },
  {
    id: "linkedin_searches",
    label: "LinkedIn niche searches",
    tab: "linkedinsearches",
    platformLabel: "LinkedIn",
    placeholder:
      "Paste LinkedIn people-search queries — one per line\ncontent marketing director\nB2B SaaS founder",
    scraper: "linkedin",
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
      const link = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : trimmed.includes("/company/")
          ? `https://www.linkedin.com/company/${bare.replace(/^company\//i, "")}/`
          : `https://www.linkedin.com/in/${bare}/`;
      return {
        Name: bare,
        Link: link,
        Platform: platformLabel,
        source_tab: tab,
      };
    }
    case "linkedinsearches":
      return {
        Name: bare,
        Link: bare,
        searchQuery: bare,
        Platform: platformLabel,
        source_tab: tab,
      };
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
  let name = String(p.Name ?? p.handle ?? p.name ?? "").trim();
  const link = String(p.Link ?? p.link ?? p.url ?? "").trim();
  if (!name && link) {
    if (tab === "hashtags") {
      name = link.replace(/^#+/, "");
    } else if (tab === "subreddits") {
      name = link.match(/reddit\.com\/r\/([^/?#\s]+)/i)?.[1] ?? link.replace(/^r\//i, "");
    } else if (tab === "tiktokaccounts") {
      name = link.match(/tiktok\.com\/@([^/?#\s]+)/i)?.[1] ?? link.replace(/^@+/, "");
    } else if (tab === "igaccounts") {
      name = link.match(/instagram\.com\/([^/?#\s]+)/i)?.[1] ?? link.replace(/^@+/, "");
    } else if (tab === "linkedinaccounts") {
      name =
        link.match(/linkedin\.com\/(?:in|company)\/([^/?#\s]+)/i)?.[1] ??
        link.replace(/^https?:\/\/(www\.)?linkedin\.com\//i, "");
    } else if (tab === "linkedinsearches") {
      name = String(p.searchQuery ?? p.SearchQuery ?? link).trim();
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
