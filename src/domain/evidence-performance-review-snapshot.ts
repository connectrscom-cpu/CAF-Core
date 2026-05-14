/**
 * Snapshot of the inputs evidence **rating** pass (LLM components + rationale) copied onto
 * `inputs_evidence_row_insights` for top-performer tiers so insights carry performance context.
 */

export interface EvidenceRatingFieldsRow {
  id: string;
  rating_score: string | null;
  rating_components_json: Record<string, unknown> | null;
  rating_rationale: string | null;
  rated_at: string | null;
}

export function evidencePerformanceReviewJsonFromRatingRow(
  r: Pick<EvidenceRatingFieldsRow, "rating_score" | "rating_components_json" | "rating_rationale" | "rated_at">
): Record<string, unknown> | null {
  const raw = String(r.rating_score ?? "").trim();
  if (!raw) return null;
  const n = parseFloat(raw);
  if (Number.isNaN(n)) return null;
  return {
    version: 1,
    rating_score: n,
    rating_components_json: r.rating_components_json && typeof r.rating_components_json === "object" ? r.rating_components_json : {},
    rating_rationale: r.rating_rationale ?? null,
    rated_at: r.rated_at ?? null,
    source: "inputs_evidence_row",
  };
}

export function ratingReviewSnapshotsByRowId(rows: EvidenceRatingFieldsRow[]): Map<string, Record<string, unknown> | null> {
  const m = new Map<string, Record<string, unknown> | null>();
  for (const r of rows) {
    m.set(String(r.id), evidencePerformanceReviewJsonFromRatingRow(r));
  }
  return m;
}
