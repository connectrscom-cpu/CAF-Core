import type { ReviewQueueRow } from "@/lib/types";

type FlowDisplayRow = ReviewQueueRow | Record<string, string | undefined>;

/** Prefer human mimic label from Core; fall back to canonical flow_type. */
export function displayFlowLabel(row: FlowDisplayRow): string {
  const label = String(row.flow_label ?? "").trim();
  if (label) return label;
  return String(row.flow_type ?? "").trim() || "—";
}

/** Model, similarity, image-input mode, overlay — for review console subtitle. */
export function displayFlowDetail(row: FlowDisplayRow): string | null {
  const detail = String(row.flow_detail ?? "").trim();
  return detail || null;
}
