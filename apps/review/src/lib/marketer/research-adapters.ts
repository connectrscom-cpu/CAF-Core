import type { ResearchSourceGroup } from "./types";

/** Marketer-facing source groups mapped to Core `inputs_source_rows` tabs. */
export const RESEARCH_SOURCE_GROUPS: Array<{
  id: string;
  label: string;
  tab: string;
  platformLabel: string;
  placeholder: string;
  scraper: "instagram" | "tiktok" | "reddit" | "facebook" | "html" | null;
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

export function handlesToSourceRows(
  handles: string[],
  tab: string,
  platformLabel: string
): Array<{ row_index: number; enabled: boolean; payload_json: Record<string, unknown> }> {
  return handles.map((name, row_index) => ({
    row_index,
    enabled: true,
    payload_json: {
      Name: name,
      Link: "",
      Platform: platformLabel,
      source_tab: tab,
    },
  }));
}

export function rowsToHandles(
  rows: Array<{ payload_json?: Record<string, unknown> }>
): string[] {
  return rows
    .map((r) => {
      const p = r.payload_json ?? {};
      return String(p.Name ?? p.handle ?? p.name ?? "").trim();
    })
    .filter(Boolean);
}

export const RESEARCH_RUN_PLATFORMS = [
  { id: "instagram" as const, label: "Instagram" },
  { id: "tiktok" as const, label: "TikTok" },
  { id: "reddit" as const, label: "Reddit" },
  { id: "facebook" as const, label: "Facebook" },
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
    handles: rowsToHandles(rowsByTab[g.tab] ?? []),
  }));
}
