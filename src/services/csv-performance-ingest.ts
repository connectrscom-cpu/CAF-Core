import type { PerformanceIngestionInput } from "./market-learning.js";

export type CsvPerformanceColumnMap = Record<string, string>;

function cell(row: Record<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = row[k];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function num(row: Record<string, string>, keys: string[]): number | undefined {
  const s = cell(row, keys);
  if (!s) return undefined;
  const n = parseFloat(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

export function mapCsvRowToPerformanceInput(
  row: Record<string, string>,
  mapping: CsvPerformanceColumnMap
): PerformanceIngestionInput | null {
  const M = (logical: string, ...defaults: string[]) => {
    const col = mapping[logical];
    return col ? [col, ...defaults] : defaults;
  };

  const platform = cell(row, M("platform", "Platform", "platform"));
  const posted_at = cell(row, M("posted_at", "Date", "Posted at", "posted_at", "Day"));
  if (!platform || !posted_at) return null;

  return {
    candidate_id: cell(row, M("candidate_id", "candidate_id", "Candidate ID")) || undefined,
    task_id: cell(row, M("task_id", "task_id", "Task ID", "Content ID")) || undefined,
    platform,
    posted_at,
    metric_date: cell(row, M("metric_date", "metric_date")) || undefined,
    likes: num(row, M("likes", "Likes", "likes")),
    comments: num(row, M("comments", "Comments", "comments")),
    shares: num(row, M("shares", "Shares", "shares")),
    saves: num(row, M("saves", "Saves", "saves")),
    watch_time: num(row, M("watch_time", "Watch time")),
    engagement_rate: num(row, M("engagement_rate", "Engagement rate")),
    notes: cell(row, M("notes", "Notes")) || undefined,
  };
}
