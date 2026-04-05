import type { ReviewQueueRow, TaskListParams } from "./types";

function getVal(row: ReviewQueueRow, key: string): string {
  return (row[key] ?? "").trim();
}

function matchesFilter(row: ReviewQueueRow, params: TaskListParams): boolean {
  if (params.project && getVal(row, "project") !== params.project) return false;
  if (params.run_id && getVal(row, "run_id") !== params.run_id) return false;
  if (params.platform && getVal(row, "platform") !== params.platform) return false;
  if (params.flow_type && getVal(row, "flow_type") !== params.flow_type) return false;
  if (params.review_status && getVal(row, "review_status") !== params.review_status) return false;
  if (params.decision !== undefined) {
    const d = getVal(row, "decision");
    if (params.decision === "" && d !== "") return false;
    if (params.decision !== "" && d !== params.decision) return false;
  }
  if (params.recommended_route && getVal(row, "recommended_route") !== params.recommended_route) return false;
  if (params.qc_status && getVal(row, "qc_status") !== params.qc_status) return false;
  if (params.risk_score_min !== undefined && params.risk_score_min !== "") {
    const r = parseFloat(getVal(row, "risk_score"));
    const min = parseFloat(params.risk_score_min);
    if (isNaN(r) || r < min) return false;
  }
  if (params.has_preview === "true") {
    const preview = getVal(row, "preview_url");
    const video = getVal(row, "video_url");
    if (!preview && !video) return false;
  }
  if (params.search && params.search.trim() !== "") {
    const q = params.search.trim().toLowerCase();
    const searchable = [getVal(row, "task_id"), getVal(row, "generated_title"), getVal(row, "generated_hook"), getVal(row, "generated_caption"), getVal(row, "candidate_id")].join(" ").toLowerCase();
    if (!searchable.includes(q)) return false;
  }
  return true;
}

export function filterRows(rows: ReviewQueueRow[], params: TaskListParams): ReviewQueueRow[] {
  return rows.filter((row) => matchesFilter(row, params));
}

function compare(a: ReviewQueueRow, b: ReviewQueueRow, sort: string): number {
  const [key, dir] = sort.startsWith("-") ? [sort.slice(1), "desc"] : [sort, "asc"];
  const av = (a[key] ?? "").trim();
  const bv = (b[key] ?? "").trim();
  const cmp = av.localeCompare(bv, undefined, { numeric: true });
  return dir === "desc" ? -cmp : cmp;
}

export function sortRows(rows: ReviewQueueRow[], sortParam?: string): ReviewQueueRow[] {
  const sort = (sortParam ?? "task_id").trim();
  if (!sort) return rows;
  return [...rows].sort((a, b) => compare(a, b, sort));
}

export function paginateRows<T>(rows: T[], page: number, limit: number): { items: T[]; total: number; page: number; limit: number } {
  const total = rows.length;
  const p = Math.max(1, page);
  const l = Math.min(100, Math.max(1, limit));
  const start = (p - 1) * l;
  const items = rows.slice(start, start + l);
  return { items, total, page: p, limit: l };
}
