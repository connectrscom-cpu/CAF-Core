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
  websites_blogs: "Websites+Blogs",
  all_sources: "All Sources",
  hashtags: "Hashtags",
};

export const SCRAPER_OUTPUT_SHEETS: Record<string, string> = {
  instagram: "InstagramPostData",
  tiktok: "Tiktok_Videos",
  reddit: "Reddit_Raw_Info",
  facebook: "Facebook_Info",
  html: "SCRAPED",
};
