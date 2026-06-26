import type { MimicReferenceItem } from "../domain/mimic-payload.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "../domain/signal-pack-top-performer-knowledge.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
  FLOW_VISUAL_FIRST_CAROUSEL,
  FLOW_WHY_MIMIC_CAROUSEL,
} from "../domain/top-performer-mimic-flow-types.js";
import type { JobLineageResult } from "../repositories/job-lineage.js";
import { enrichGuidelineEntryFromLineageInsight } from "../domain/mimic-job-grounding.js";
import {
  compactStoredInspectionMedia,
  type VisualGuidelineInspectionMedia,
} from "./visual-guidelines-media.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x ?? "").trim()).filter(Boolean);
}

export interface ResolvedMimicReference {
  source_insights_id: string;
  source_evidence_row_id: string | null;
  analysis_tier: string;
  /** True when a non-primary tier was used (e.g. carousel slide for image mimic). */
  reference_tier_fallback?: boolean;
  reference_items: MimicReferenceItem[];
  guideline_entry: Record<string, unknown>;
}

/** When primary tier is missing from the pack, try these tiers (same inspection media shape). */
const MIMIC_TIER_FALLBACKS: Record<string, readonly string[]> = {
  top_performer_deep: ["top_performer_carousel"],
  top_performer_carousel: [],
};

function expectedTier(flowType: string): string {
  if (flowType === FLOW_TOP_PERFORMER_MIMIC_IMAGE) return "top_performer_deep";
  if (flowType === FLOW_TOP_PERFORMER_MIMIC_CAROUSEL || flowType === FLOW_VISUAL_FIRST_CAROUSEL || flowType === FLOW_WHY_MIMIC_CAROUSEL) {
    return "top_performer_carousel";
  }
  return "";
}

/**
 * Archive rows may use 0-based or 1-based indexes; merges can duplicate index values.
 * Render plans and slide_plans always use 1-based reference_index aligned to deck order.
 */
export function normalizeMimicReferenceItems(items: MimicReferenceItem[]): MimicReferenceItem[] {
  if (items.length === 0) return items;
  const sorted = [...items].sort((a, b) => {
    const ai = typeof a.index === "number" && Number.isFinite(a.index) ? a.index : Number.MAX_SAFE_INTEGER;
    const bi = typeof b.index === "number" && Number.isFinite(b.index) ? b.index : Number.MAX_SAFE_INTEGER;
    if (ai !== bi) return ai - bi;
    const ap = (a.object_path ?? a.preview_url ?? a.vision_fetch_url ?? "").toLowerCase();
    const bp = (b.object_path ?? b.preview_url ?? b.vision_fetch_url ?? "").toLowerCase();
    return ap.localeCompare(bp);
  });
  return sorted.map((item, i) => ({ ...item, index: i + 1 }));
}

function itemsFromInspectionMedia(media: VisualGuidelineInspectionMedia | null): MimicReferenceItem[] {
  if (!media?.items?.length) return [];
  const out: MimicReferenceItem[] = [];
  for (const it of media.items) {
    const url = (it.vision_fetch_url ?? it.public_url ?? "").trim();
    if (!url) continue;
    out.push({
      index: it.index ?? out.length + 1,
      role: it.role,
      vision_fetch_url: url,
      preview_url: it.public_url,
      bucket: it.bucket,
      object_path: it.object_path,
      source_slide_index:
        it.source_slide_index != null && it.source_slide_index > 0 ? it.source_slide_index : null,
      is_video_slide: it.is_video_slide === true || String(it.role ?? "").toLowerCase().includes("video"),
      content_type: it.content_type ?? null,
      source_url: it.source_url ?? null,
    });
  }
  return normalizeMimicReferenceItems(out);
}

function findGuidelineEntry(
  derivedGlobals: Record<string, unknown> | null,
  insightIds: string[],
  tier: string
): Record<string, unknown> | null {
  const pack = asRecord(derivedGlobals?.[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]);
  const entries = Array.isArray(pack?.entries) ? pack!.entries : [];
  const idSet = new Set(insightIds);
  for (const e of entries) {
    const rec = asRecord(e);
    if (!rec) continue;
    const iid = String(rec.insights_id ?? "").trim();
    const at = String(rec.analysis_tier ?? "").trim();
    if (iid && idSet.has(iid) && (!tier || at === tier)) return rec;
  }
  for (const e of entries) {
    const rec = asRecord(e);
    if (!rec) continue;
    const at = String(rec.analysis_tier ?? "").trim();
    if (tier && at === tier) return rec;
  }
  return null;
}

function listGuidelineTiers(derivedGlobals: Record<string, unknown> | null): string[] {
  const pack = asRecord(derivedGlobals?.[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]);
  const entries = Array.isArray(pack?.entries) ? pack!.entries : [];
  const tiers = new Set<string>();
  for (const e of entries) {
    const rec = asRecord(e);
    const at = String(rec?.analysis_tier ?? "").trim();
    if (at) tiers.add(at);
  }
  return [...tiers];
}

function resolveGuidelineEntry(
  derived: Record<string, unknown> | null,
  insightIds: string[],
  primaryTier: string,
  flowType?: string
): { entry: Record<string, unknown>; resolvedTier: string; reference_tier_fallback: boolean } | null {
  const tiersToTry = [primaryTier, ...(MIMIC_TIER_FALLBACKS[primaryTier] ?? [])];
  for (const tier of tiersToTry) {
    const entry = findGuidelineEntry(derived, insightIds, tier);
    if (!entry) continue;
    if (flowType === FLOW_TOP_PERFORMER_MIMIC_IMAGE && entryReferenceFrameCount(entry) > 1) {
      continue;
    }
    return {
      entry,
      resolvedTier: tier,
      reference_tier_fallback: tier !== primaryTier,
    };
  }
  return null;
}

/** Archived inspection frames on a visual-guidelines pack entry. */
export function entryReferenceFrameCount(entry: Record<string, unknown>): number {
  const media =
    compactStoredInspectionMedia(entry.inspection_media) ??
    compactStoredInspectionMedia(entry.stored_inspection_media_json);
  if (!media?.items?.length) return 0;
  return media.items.filter((it) => String(it.vision_fetch_url ?? it.public_url ?? "").trim()).length;
}

/** True when idea grounding resolves to a single-frame deep (or eligible fallback) reference. */
export function mimicImageReferenceEligible(
  derived: Record<string, unknown> | null,
  insightIds: string[]
): boolean {
  if (insightIds.length === 0) return false;
  const resolved = resolveGuidelineEntry(
    derived,
    insightIds,
    "top_performer_deep",
    FLOW_TOP_PERFORMER_MIMIC_IMAGE
  );
  return resolved != null && entryReferenceFrameCount(resolved.entry) <= 1;
}

/** True when grounding resolves to a carousel reference with 2+ archived slides. */
export function mimicCarouselReferenceEligible(
  derived: Record<string, unknown> | null,
  insightIds: string[]
): boolean {
  if (insightIds.length === 0) return false;
  const resolved = resolveGuidelineEntry(
    derived,
    insightIds,
    "top_performer_carousel",
    FLOW_TOP_PERFORMER_MIMIC_CAROUSEL
  );
  return resolved != null && entryReferenceFrameCount(resolved.entry) >= 2;
}

export function resolveMimicReferenceFromLineage(
  flowType: string,
  lineage: JobLineageResult,
  candidateData: Record<string, unknown> | null
): ResolvedMimicReference {
  const tier = expectedTier(flowType);
  if (!tier) {
    throw new Error(`Unsupported mimic flow_type: ${flowType}`);
  }

  const fromCandidate = stringList(candidateData?.grounding_insight_ids);
  const insightIds =
    fromCandidate.length > 0
      ? fromCandidate
      : lineage.grounding.map((g) => String(g.insight_row.insights_id ?? "").trim()).filter(Boolean);

  const derived = asRecord(lineage.signal_pack?.derived_globals_json);
  const resolvedGuideline = resolveGuidelineEntry(derived, insightIds, tier, flowType);

  let entry = resolvedGuideline?.entry ?? null;
  let resolvedTier = tier;
  let referenceTierFallback = false;

  if (resolvedGuideline) {
    resolvedTier = resolvedGuideline.resolvedTier;
    referenceTierFallback = resolvedGuideline.reference_tier_fallback;
  }

  if (!entry && lineage.grounding.length > 0) {
    const match = lineage.grounding.find((g) => {
      const t = String(g.insight_row.analysis_tier ?? "").trim();
      const iid = String(g.insight_row.insights_id ?? "").trim();
      return t === tier && (insightIds.length === 0 || insightIds.includes(iid));
    });
    if (match) {
      entry = {
        insights_id: match.insight_row.insights_id,
        analysis_tier: match.insight_row.analysis_tier,
        source_evidence_row_id: match.insight_row.source_evidence_row_id,
        aesthetic_analysis_json: match.insight_row.aesthetic_analysis_json,
        stored_inspection_media_json: null,
      };
      resolvedTier = String(entry.analysis_tier ?? tier);
    }
  }

  if (!entry) {
    const available = listGuidelineTiers(derived);
    const groundingLabel = insightIds.length ? insightIds.join(", ") : "none";
    const tierHint =
      tier === "top_performer_deep"
        ? "Run the top-performer deep (single-image) vision pass and rebuild the signal pack, or use FLOW_TOP_PERFORMER_MIMIC_CAROUSEL when only carousel references exist."
        : "Ground ideas to top-performer insights and rebuild the signal pack.";
    throw new Error(
      `No visual guideline entry for mimic (${tier}). Pack has tiers: ${available.join(", ") || "none"}. Idea grounding: ${groundingLabel}. ${tierHint}`
    );
  }

  let reference_items = itemsFromInspectionMedia(
    compactStoredInspectionMedia(entry.inspection_media) ??
      compactStoredInspectionMedia(entry.stored_inspection_media_json)
  );

  if (reference_items.length === 0) {
    const g = lineage.grounding.find(
      (x) => String(x.insight_row.insights_id) === String(entry!.insights_id)
    );
    if (g) {
      reference_items = itemsFromInspectionMedia(
        compactStoredInspectionMedia(
          (g.insight_row as unknown as Record<string, unknown>).stored_inspection_media_json
        )
      );
    }
  }

  if (reference_items.length === 0) {
    throw new Error(
      "Top-performer inspection media missing — run top-performer pass with Supabase archive enabled (stored_inspection_media_json)."
    );
  }

  const sourceId = String(entry.insights_id ?? insightIds[0] ?? "").trim();
  const groundingMatch = lineage.grounding.find(
    (g) => String(g.insight_row.insights_id ?? "").trim() === sourceId
  );
  if (groundingMatch) {
    entry = enrichGuidelineEntryFromLineageInsight(entry, {
      aesthetic_analysis_json: groundingMatch.insight_row.aesthetic_analysis_json,
      hook_text: groundingMatch.insight_row.hook_text,
    });
  }

  return {
    source_insights_id: sourceId,
    source_evidence_row_id: entry.source_evidence_row_id != null ? String(entry.source_evidence_row_id) : null,
    analysis_tier: String(entry.analysis_tier ?? resolvedTier),
    reference_tier_fallback: referenceTierFallback,
    reference_items,
    guideline_entry: entry,
  };
}
