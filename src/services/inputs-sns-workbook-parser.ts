/**
 * Parses "INPUTS - Sources for SNS" style workbooks into flat row records for caf_core.inputs_evidence_rows.
 * Uses SheetJS (`xlsx`) — same stack as signal-pack-parser.
 */
import { createHash } from "node:crypto";
import * as XLSX from "xlsx";

export const MAX_ROWS_PER_SHEET = 50_000;

export interface ParsedInputsEvidenceSheet {
  sheet_name: string;
  evidence_kind: string;
  row_count: number;
  truncated: boolean;
  /** First row keys (headers) for UI. */
  columns: string[];
}

export interface ParsedInputsEvidenceRow {
  sheet_name: string;
  row_index: number;
  evidence_kind: string;
  dedupe_key: string | null;
  payload_json: Record<string, unknown>;
}

export interface ParsedInputsEvidenceWorkbook {
  sheets: ParsedInputsEvidenceSheet[];
  rows: ParsedInputsEvidenceRow[];
  workbook_sha256: string;
}

function normSheetKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "_").replace(/\+/g, "_");
}

export function sheetNameToEvidenceKind(sheetName: string): string {
  const k = normSheetKey(sheetName);
  const map: Record<string, string> = {
    all_sources: "source_registry",
    websites_blogs: "source_registry",
    subreddits: "source_registry",
    tiktokaccounts: "source_registry",
    igaccounts: "source_registry",
    facebook: "source_registry",
    knowledge_pool: "reference_pool",
    scraped: "scraped_page",
    html_findings_summary: "html_summary",
    reddit_raw_info: "reddit_post",
    tiktok_videos: "tiktok_video",
    instagrampostdata: "instagram_post",
    facebook_info: "facebook_post",
  };
  return map[k] ?? `sheet_${k}`;
}

function stableStringify(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const o: Record<string, unknown> = {};
  for (const key of keys) o[key] = obj[key];
  return JSON.stringify(o);
}

function rowHash(row: Record<string, unknown>): string {
  return createHash("sha256").update(stableStringify(row)).digest("hex").slice(0, 40);
}

function pickFirst(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = row[key];
    if (v != null) {
      const s = String(v).trim();
      if (s) return s.slice(0, 512);
    }
  }
  return "";
}

export function computeDedupeKey(
  sheetName: string,
  evidenceKind: string,
  row: Record<string, unknown>
): string | null {
  switch (evidenceKind) {
    case "reddit_post": {
      const id = pickFirst(row, ["post_id", "Post ID", "post id"]);
      return id || null;
    }
    case "tiktok_video": {
      const id = pickFirst(row, ["videoId", "video_id", "VideoId"]);
      return id || null;
    }
    case "instagram_post": {
      const id = pickFirst(row, ["post_id", "post id", "Post ID"]);
      return id || null;
    }
    case "facebook_post": {
      const id = pickFirst(row, ["postId", "post_id", "Post ID"]);
      if (id) return id;
      const url = pickFirst(row, ["postUrl", "post_url", "url", "Post URL"]);
      return url || null;
    }
    case "scraped_page": {
      const h = pickFirst(row, ["content_hash", "content hash", "Content Hash"]);
      if (h) return `h:${h.slice(0, 120)}`;
      const url = pickFirst(row, ["url", "Url", "URL"]);
      const title = pickFirst(row, ["title", "Title"]);
      if (url || title) return `u:${url}|t:${title.slice(0, 200)}`;
      return null;
    }
    case "source_registry": {
      const link = pickFirst(row, ["Link", "link", "Facebook URL", "facebook url"]);
      const name = pickFirst(row, ["Name", "name"]);
      if (link) return `link:${link.slice(0, 400)}`;
      if (name) return `name:${name.slice(0, 200)}`;
      return null;
    }
    case "html_summary": {
      const sign = pickFirst(row, ["sign", "Sign"]);
      if (sign) return `sign:${sign}`;
      return null;
    }
    case "reference_pool": {
      const firstVal = Object.values(row).find((v) => v != null && String(v).trim());
      const s = firstVal != null ? String(firstVal).trim() : "";
      return s ? `ref:${s.slice(0, 400)}` : null;
    }
    default:
      return `${normSheetKey(sheetName)}:${rowHash(row)}`;
  }
}

function sheetToMatrix(sheet: XLSX.WorkSheet): unknown[][] {
  const ref = sheet["!ref"];
  if (!ref) return [];
  const range = XLSX.utils.decode_range(ref);
  const out: unknown[][] = [];
  for (let R = range.s.r; R <= range.e.r; R++) {
    const row: unknown[] = [];
    for (let C = range.s.c; C <= range.e.c; C++) {
      const addr = XLSX.utils.encode_cell({ r: R, c: C });
      const cell = sheet[addr];
      row.push(cell?.v ?? cell?.w ?? null);
    }
    out.push(row);
  }
  return out;
}

function headerStrings(row: unknown[]): string[] {
  return row.map((c, i) => {
    if (c == null || c === "") return `col_${i}`;
    return String(c).trim() || `col_${i}`;
  });
}

function zipRow(headers: string[], values: unknown[]): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i] ?? `col_${i}`;
    o[key] = values[i] ?? null;
  }
  return o;
}

export function parseInputsSnsWorkbookBuffer(buffer: Buffer): ParsedInputsEvidenceWorkbook {
  const workbook_sha256 = createHash("sha256").update(buffer).digest("hex");
  const wb = XLSX.read(buffer, { type: "buffer", cellDates: true, dense: false });

  const sheets: ParsedInputsEvidenceSheet[] = [];
  const rows: ParsedInputsEvidenceRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const matrix = sheetToMatrix(ws);
    if (matrix.length === 0) continue;

    const evidenceKind = sheetNameToEvidenceKind(sheetName);
    const headerRow = matrix[0] ?? [];
    const headers = headerStrings(headerRow);
    const dataRows = matrix.slice(1);

    let row_count = 0;
    let truncated = false;
    const max = MAX_ROWS_PER_SHEET;

    for (let i = 0; i < dataRows.length; i++) {
      if (row_count >= max) {
        truncated = true;
        break;
      }
      const vals = dataRows[i] ?? [];
      const isEmpty = vals.every((v) => v == null || String(v).trim() === "");
      if (isEmpty) continue;

      const payload_json = zipRow(headers, vals);
      const dedupe_key = computeDedupeKey(sheetName, evidenceKind, payload_json);
      rows.push({
        sheet_name: sheetName,
        row_index: row_count,
        evidence_kind: evidenceKind,
        dedupe_key,
        payload_json,
      });
      row_count++;
    }

    sheets.push({
      sheet_name: sheetName,
      evidence_kind: evidenceKind,
      row_count,
      truncated,
      columns: headers,
    });
  }

  return { sheets, rows, workbook_sha256 };
}
