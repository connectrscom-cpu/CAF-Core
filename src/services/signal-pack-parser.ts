/**
 * Parses an SNS Insights Excel workbook buffer into the structured JSON
 * columns expected by caf_core.signal_packs.
 *
 * Uses the `xlsx` library (SheetJS) to read cells without any native deps.
 *
 * When the workbook includes a **Signal Pack** tab (Google Sheets / n8n export), that row’s
 * `overall_candidates_json` cell is the canonical curated candidate list — we prefer it over
 * scanning every row on **Overall** (which may be huge and lack stable `candidate_id`s).
 */
import * as XLSX from "xlsx";

export interface ParsedSignalPack {
  /** Workbook sheet names that mapped into structured fields (Overall, IG Summary, …). */
  sheets_ingested: string[];
  /** True when candidates came from the published Signal Pack sheet row, not only from Overall. */
  used_published_signal_pack_row?: boolean;
  overall_candidates_json: unknown[];
  ig_summary_json: unknown | null;
  tiktok_summary_json: unknown | null;
  reddit_summary_json: unknown | null;
  fb_summary_json: unknown | null;
  html_summary_json: unknown | null;
  ig_archetypes_json: unknown | null;
  ig_7day_plan_json: unknown | null;
  ig_top_examples_json: unknown | null;
  tiktok_archetypes_json: unknown | null;
  tiktok_7day_plan_json: unknown | null;
  tiktok_top_examples_json: unknown | null;
  reddit_archetypes_json: unknown | null;
  reddit_top_examples_json: unknown | null;
  html_findings_raw_json: unknown | null;
  reddit_subreddit_insights_json: unknown | null;
  derived_globals_json: Record<string, unknown>;
}

const SHEET_MAP: Record<string, keyof ParsedSignalPack> = {
  "Overall": "overall_candidates_json",
  "HTML Summary": "html_summary_json",
  "HTML Insights": "html_summary_json",
  "HTML_Findings_Raw": "html_findings_raw_json",
  "Reddit Summary": "reddit_summary_json",
  "SubReddit Insights": "reddit_subreddit_insights_json",
  "Reddit Archetypes": "reddit_archetypes_json",
  "Reddit TopExamples": "reddit_top_examples_json",
  "IG Summary": "ig_summary_json",
  "IG Archetypes": "ig_archetypes_json",
  "IG 7DayPlan": "ig_7day_plan_json",
  "IG TopExamples": "ig_top_examples_json",
  "TikTok Summary": "tiktok_summary_json",
  "TikTok Archetypes": "tiktok_archetypes_json",
  "TikTok 7DayPlan": "tiktok_7day_plan_json",
  "TikTok TopExamples": "tiktok_top_examples_json",
  "FB Summary": "fb_summary_json",
};

const PUBLISHED_PACK_SHEET_ALIASES = new Set(["signal pack", "signal packs", "signal_packs", "signal_pack"]);

function normalizeTabKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function findPublishedSignalPackSheetName(sheetNames: string[]): string | null {
  for (const n of sheetNames) {
    const key = normalizeTabKey(n).replace(/ /g, "_");
    const keySpaced = normalizeTabKey(n);
    if (PUBLISHED_PACK_SHEET_ALIASES.has(keySpaced) || PUBLISHED_PACK_SHEET_ALIASES.has(key)) return n;
  }
  return null;
}

function parseJsonCell(val: unknown): unknown {
  if (val == null || val === "") return null;
  if (typeof val === "object") return val;
  const s = String(val).trim();
  if (!s) return null;
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return null;
  }
}

function parseOverallCandidatesCell(val: unknown): unknown[] | null {
  const parsed = parseJsonCell(val);
  if (!parsed) return null;
  if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  return null;
}

/**
 * Stable ids for the decision engine / job payload matching.
 * Curated packs usually include `row_number`; raw Overall tabs often omit `candidate_id`.
 */
export function normalizeOverallCandidateRows(
  rows: unknown[],
  runIdHint: string | null
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const safeRun = runIdHint ? String(runIdHint).replace(/[^a-zA-Z0-9_]+/g, "_") : "";
  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    if (!raw || typeof raw !== "object") continue;
    const row = { ...(raw as Record<string, unknown>) };
    const platform = String(row.platform ?? row.target_platform ?? "Multi").replace(/\s+/g, "_");
    const fmt = String(row.format ?? "idea").replace(/\s+/g, "_");
    const rn = row.row_number;
    let base = String(row.candidate_id ?? "").trim();
    if (!base) {
      if (rn != null && String(rn).trim() !== "") {
        base = `${platform}_r${String(rn).trim()}`;
      } else {
        base = `${platform}_${fmt}_idx${i + 1}`;
      }
      if (safeRun) base = `${safeRun}__${base}`;
      row.candidate_id = base;
    }
    if (!row.content_idea && row.idea_description) {
      row.content_idea = row.idea_description;
    }
    const conf = row.confidence_score ?? row.confidence;
    if (conf != null && conf !== "") {
      const n = parseFloat(String(conf));
      if (!Number.isNaN(n)) row.confidence_score = n;
    }
    out.push(row);
  }
  return out;
}

function applyPublishedSignalPackRow(row: Record<string, unknown>, result: ParsedSignalPack): boolean {
  const overall = parseOverallCandidatesCell(row.overall_candidates_json);
  if (!overall) return false;

  const runIdHint = row.run_id != null && String(row.run_id).trim() ? String(row.run_id).trim() : null;
  result.overall_candidates_json = normalizeOverallCandidateRows(overall, runIdHint);
  result.used_published_signal_pack_row = true;

  const assignSummary = (key: keyof ParsedSignalPack, cellKey: string) => {
    const v = parseJsonCell(row[cellKey]);
    if (v != null) (result as unknown as Record<string, unknown>)[key] = v;
  };

  assignSummary("ig_summary_json", "ig_summary_json");
  assignSummary("tiktok_summary_json", "tiktok_summary_json");
  assignSummary("reddit_summary_json", "reddit_summary_json");
  assignSummary("fb_summary_json", "fb_summary_json");
  assignSummary("html_summary_json", "html_summary_json");

  const g = { ...result.derived_globals_json };
  const copyScalar = (k: string) => {
    const v = row[k];
    if (v != null && v !== "") g[k] = v;
  };
  copyScalar("platform_alignment_summary");
  copyScalar("cross_platform_themes");
  copyScalar("global_rising_keywords");
  copyScalar("global_winning_formats");
  copyScalar("global_engagement_triggers");
  copyScalar("total_candidates_count");
  copyScalar("confidence_score_avg");
  if (row.notes != null && String(row.notes).trim()) g.signal_pack_row_notes = row.notes;
  if (runIdHint) g.published_run_id = runIdHint;
  g.from_published_signal_pack_sheet = true;
  g.total_candidates = result.overall_candidates_json.length;
  result.derived_globals_json = g;
  return true;
}

export function parseSignalPackExcel(buffer: Buffer): ParsedSignalPack {
  const wb = XLSX.read(buffer, { type: "buffer" });

  const result: ParsedSignalPack = {
    sheets_ingested: [],
    overall_candidates_json: [],
    ig_summary_json: null,
    tiktok_summary_json: null,
    reddit_summary_json: null,
    fb_summary_json: null,
    html_summary_json: null,
    ig_archetypes_json: null,
    ig_7day_plan_json: null,
    ig_top_examples_json: null,
    tiktok_archetypes_json: null,
    tiktok_7day_plan_json: null,
    tiktok_top_examples_json: null,
    reddit_archetypes_json: null,
    reddit_top_examples_json: null,
    html_findings_raw_json: null,
    reddit_subreddit_insights_json: null,
    derived_globals_json: {},
  };

  const publishedSheet = findPublishedSignalPackSheetName(wb.SheetNames);
  if (publishedSheet) {
    const wsPub = wb.Sheets[publishedSheet];
    const pubRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wsPub, { defval: null });
    for (let i = pubRows.length - 1; i >= 0; i--) {
      if (applyPublishedSignalPackRow(pubRows[i], result)) break;
    }
  }

  for (const sheetName of wb.SheetNames) {
    const targetField = SHEET_MAP[sheetName];
    if (!targetField) continue;

    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
    const cleaned = rows.filter((r) => Object.values(r).some((v) => v != null && v !== ""));

    if (cleaned.length === 0) continue;

    if (targetField === "overall_candidates_json") {
      if (result.used_published_signal_pack_row) continue;
      result.overall_candidates_json = normalizeOverallCandidateRows(cleaned, null);
    } else if (targetField === "html_summary_json" && sheetName === "HTML Insights") {
      const existing = result.html_summary_json;
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        (existing as Record<string, unknown>).insights = cleaned;
      } else {
        result.html_summary_json = { insights: cleaned };
      }
    } else if (targetField === "html_summary_json" && sheetName === "HTML Summary") {
      const existing = result.html_summary_json;
      if (existing && typeof existing === "object" && !Array.isArray(existing)) {
        (existing as Record<string, unknown>).summary = cleaned[0] ?? null;
      } else {
        result.html_summary_json = { summary: cleaned[0] ?? null };
      }
    } else {
      (result as unknown as Record<string, unknown>)[targetField] = cleaned;
    }
  }

  const derived = deriveGlobals(result);
  result.derived_globals_json = {
    ...derived,
    ...result.derived_globals_json,
    total_candidates: result.overall_candidates_json.length,
  };
  const ingested = wb.SheetNames.filter((name) => Boolean(SHEET_MAP[name]));
  if (publishedSheet && result.used_published_signal_pack_row) {
    if (!ingested.includes(publishedSheet)) ingested.push(publishedSheet);
  }
  result.sheets_ingested = ingested;
  return result;
}

function deriveGlobals(pack: ParsedSignalPack): Record<string, unknown> {
  const candidates = pack.overall_candidates_json as Record<string, unknown>[];
  return {
    total_candidates: candidates.length,
    platforms_found: [...new Set(candidates.map((c) => c.platform).filter(Boolean))],
    signs_found: [...new Set(candidates.map((c) => c.sign).filter(Boolean))],
    parsed_at: new Date().toISOString(),
  };
}
