import type { MimicReferenceItem } from "../domain/mimic-payload.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "../domain/signal-pack-top-performer-knowledge.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
} from "../domain/top-performer-mimic-flow-types.js";
import type { JobLineageResult } from "../repositories/job-lineage.js";
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
  reference_items: MimicReferenceItem[];
  guideline_entry: Record<string, unknown>;
}

function expectedTier(flowType: string): string {
  if (flowType === FLOW_TOP_PERFORMER_MIMIC_IMAGE) return "top_performer_deep";
  if (flowType === FLOW_TOP_PERFORMER_MIMIC_CAROUSEL) return "top_performer_carousel";
  return "";
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
    });
  }
  return out;
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
  let entry = findGuidelineEntry(derived, insightIds, tier);

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
    }
  }

  if (!entry) {
    throw new Error(
      `No visual guideline entry for mimic (${tier}). Ground ideas to top-performer insights and rebuild the signal pack.`
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

  return {
    source_insights_id: String(entry.insights_id ?? insightIds[0] ?? ""),
    source_evidence_row_id: entry.source_evidence_row_id != null ? String(entry.source_evidence_row_id) : null,
    analysis_tier: String(entry.analysis_tier ?? tier),
    reference_items,
    guideline_entry: entry,
  };
}
