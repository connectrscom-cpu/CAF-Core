import type { ReviewQueueRow } from "@/lib/types";

/** Prefer human mimic label from Core; fall back to canonical flow_type. */
export function displayFlowLabel(row: ReviewQueueRow | Record<string, string | undefined>): string {
  const label = String(row.flow_label ?? "").trim();
  if (label) return label;
  return String(row.flow_type ?? "").trim() || "—";
}
