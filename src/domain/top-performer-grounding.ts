import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "./signal-pack-top-performer-knowledge.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

/** Find a visual-guidelines pack entry by insights_id (any tier). */
export function findVisualGuidelineEntryForGrounding(
  derivedGlobals: Record<string, unknown> | null | undefined,
  insightsId: string
): Record<string, unknown> | null {
  const want = insightsId.trim();
  if (!want) return null;
  const pack = asRecord(derivedGlobals?.[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]);
  const entries = Array.isArray(pack?.entries) ? pack!.entries : [];
  for (const raw of entries) {
    const entry = asRecord(raw);
    if (!entry) continue;
    if (String(entry.insights_id ?? "").trim() === want) return entry;
  }
  return null;
}

/** First grounded entry matching a tier (e.g. top_performer_video). */
export function findGroundedVisualGuidelineEntry(
  derivedGlobals: Record<string, unknown> | null | undefined,
  insightIds: string[],
  tier?: string
): Record<string, unknown> | null {
  for (const id of insightIds) {
    const entry = findVisualGuidelineEntryForGrounding(derivedGlobals, id);
    if (!entry) continue;
    if (tier) {
      const at = String(entry.analysis_tier ?? "").trim();
      if (at && at !== tier) continue;
    }
    return entry;
  }
  return null;
}

export function groundingInsightIdsFromRow(row: Record<string, unknown>): string[] {
  return stringList(row.grounding_insight_ids);
}

export function isTopPerformerVideoGroundedRow(
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  if (row.manual_mimic_pick === true && String(row.mimic_kind ?? "").trim() === "video") {
    return true;
  }
  const ids = groundingInsightIdsFromRow(row);
  if (ids.length === 0) return false;
  return findGroundedVisualGuidelineEntry(derivedGlobals, ids, "top_performer_video") != null;
}

export function isTopPerformerCarouselGroundedRow(
  row: Record<string, unknown>,
  derivedGlobals: Record<string, unknown> | null | undefined
): boolean {
  if (row.manual_mimic_pick === true && String(row.mimic_kind ?? "").trim() === "carousel") {
    return true;
  }
  const ids = groundingInsightIdsFromRow(row);
  if (ids.length === 0) return false;
  return findGroundedVisualGuidelineEntry(derivedGlobals, ids, "top_performer_carousel") != null;
}
