/**
 * Sync INPUTS workbook source tabs into caf_core.inputs_source_rows.
 * Does not touch evidence imports — XLSX upload path stays unchanged.
 */
import type { Pool } from "pg";
import * as XLSX from "xlsx";
import { replaceSourceTabRows } from "../repositories/inputs-sources.js";
import { sheetNameToEvidenceKind } from "./inputs-sns-workbook-parser.js";

const SOURCE_TAB_MAP: Record<string, string> = {
  all_sources: "all_sources",
  websites_blogs: "websites_blogs",
  igaccounts: "igaccounts",
  tiktokaccounts: "tiktokaccounts",
  subreddits: "subreddits",
  facebook: "facebook",
  linkedinaccounts: "linkedinaccounts",
  linkedinsearches: "linkedinsearches",
  hashtags: "hashtags",
};

function normSheetKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_").replace(/\+/g, "_");
}

function sheetToRows(ws: XLSX.WorkSheet): Record<string, unknown>[] {
  const ref = ws["!ref"];
  if (!ref) return [];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null }) as unknown[][];
  if (matrix.length < 2) return [];
  const headers = (matrix[0] ?? []).map((c, i) => {
    if (c == null || c === "") return `col_${i}`;
    return String(c).trim() || `col_${i}`;
  });
  const out: Record<string, unknown>[] = [];
  for (let i = 1; i < matrix.length; i++) {
    const vals = matrix[i] ?? [];
    const row: Record<string, unknown> = {};
    let empty = true;
    for (let c = 0; c < headers.length; c++) {
      const v = vals[c] ?? null;
      if (v != null && String(v).trim()) empty = false;
      row[headers[c]!] = v;
    }
    if (!empty) out.push(row);
  }
  return out;
}

export interface SyncSourcesFromWorkbookResult {
  tabs: Array<{ source_tab: string; sheet_name: string; row_count: number }>;
  total_rows: number;
}

export async function syncSourcesFromWorkbookBuffer(
  db: Pool,
  projectId: string,
  buffer: Buffer
): Promise<SyncSourcesFromWorkbookResult> {
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
  const tabs: SyncSourcesFromWorkbookResult["tabs"] = [];
  let total = 0;

  for (const sheetName of wb.SheetNames) {
    const key = normSheetKey(sheetName);
    let sourceTab = SOURCE_TAB_MAP[key];
    if (!sourceTab) {
      const kind = sheetNameToEvidenceKind(sheetName);
      if (kind === "source_registry") sourceTab = key;
      else continue;
    }
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows = sheetToRows(ws);
    await replaceSourceTabRows(
      db,
      projectId,
      sourceTab,
      rows.map((payload_json, row_index) => ({
        row_index,
        enabled: true,
        payload_json,
      }))
    );
    tabs.push({ source_tab: sourceTab, sheet_name: sheetName, row_count: rows.length });
    total += rows.length;
  }

  return { tabs, total_rows: total };
}

/** Map source_tab to workbook sheet name for evidence row output. */
export const SOURCE_TAB_TO_OUTPUT_SHEET: Record<string, string> = {
  igaccounts: "IGAccounts",
  tiktokaccounts: "TikTokAccounts",
  subreddits: "SubReddits",
  facebook: "Facebook",
  linkedinaccounts: "LinkedInAccounts",
  linkedinsearches: "LinkedInSearches",
  websites_blogs: "Websites+Blogs",
  all_sources: "All Sources",
  hashtags: "Hashtags",
};

const WORKBOOK_TEMPLATE_SHEETS: Array<{
  sheet_name: string;
  source_tab: string;
  example_rows: Array<Record<string, string>>;
}> = [
  {
    sheet_name: "IGAccounts",
    source_tab: "igaccounts",
    example_rows: [
      {
        Name: "competitor.handle",
        Link: "https://www.instagram.com/competitor.handle/",
        Platform: "Instagram",
        Followers: "",
      },
    ],
  },
  {
    sheet_name: "TikTokAccounts",
    source_tab: "tiktokaccounts",
    example_rows: [
      {
        Name: "creator",
        Link: "https://www.tiktok.com/@creator",
        Platform: "TikTok",
        Followers: "",
      },
    ],
  },
  {
    sheet_name: "Hashtags",
    source_tab: "hashtags",
    example_rows: [{ Name: "contentmarketing", Link: "#contentmarketing", Platform: "Multi-platform" }],
  },
  {
    sheet_name: "SubReddits",
    source_tab: "subreddits",
    example_rows: [
      {
        Name: "marketing",
        Link: "https://www.reddit.com/r/marketing/",
        Platform: "Reddit",
      },
    ],
  },
  {
    sheet_name: "Facebook",
    source_tab: "facebook",
    example_rows: [
      {
        Name: "Competitor Page",
        Link: "https://www.facebook.com/competitor.page",
        Platform: "Facebook",
        Followers: "",
      },
    ],
  },
  {
    sheet_name: "LinkedInAccounts",
    source_tab: "linkedinaccounts",
    example_rows: [
      {
        Name: "satyanadella",
        Link: "https://www.linkedin.com/in/satyanadella/",
        Platform: "LinkedIn",
        Followers: "",
      },
      {
        Name: "alice",
        Link: "https://www.linkedin.com/in/alice/ | similar",
        Platform: "LinkedIn",
        Followers: "",
      },
    ],
  },
  {
    sheet_name: "LinkedInSearches",
    source_tab: "linkedinsearches",
    example_rows: [
      {
        Name: "content marketing director",
        Link: "content marketing director",
        Platform: "LinkedIn",
      },
      {
        Name: "title: VP Marketing",
        Link: "title: VP Marketing",
        Platform: "LinkedIn",
      },
    ],
  },
  {
    sheet_name: "Websites+Blogs",
    source_tab: "websites_blogs",
    example_rows: [
      {
        Name: "Industry blog",
        Link: "https://blog.example.com",
        Platform: "Web",
      },
    ],
  },
];

/** Minimal INPUTS-style workbook for marketer Research upload (one tab per watchlist type). */
export function buildSourcesWorkbookTemplateBuffer(): Buffer {
  const wb = XLSX.utils.book_new();
  for (const sheet of WORKBOOK_TEMPLATE_SHEETS) {
    const ws = XLSX.utils.json_to_sheet(sheet.example_rows, {
      header: ["Name", "Link", "Platform"],
    });
    XLSX.utils.book_append_sheet(wb, ws, sheet.sheet_name);
  }
  return Buffer.from(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }));
}

export const SCRAPER_OUTPUT_SHEETS: Record<string, string> = {
  instagram: "InstagramPostData",
  tiktok: "Tiktok_Videos",
  reddit: "Reddit_Raw_Info",
  facebook: "Facebook_Info",
  linkedin: "LinkedInPostData",
  html: "SCRAPED",
};
