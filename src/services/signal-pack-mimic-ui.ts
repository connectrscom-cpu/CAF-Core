import type { SignalPackRow } from "../repositories/signal-packs.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "../domain/signal-pack-top-performer-knowledge.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
  FLOW_TOP_PERFORMER_MIMIC_VIDEO,
} from "../domain/top-performer-mimic-flow-types.js";
import { platformFromEvidenceKind } from "./signal-pack-compile-ideas.js";

export type MimicPickKind = "image" | "carousel" | "video";

export const MIMIC_PICK_KINDS: readonly MimicPickKind[] = ["image", "carousel", "video"] as const;

export const MIMIC_PICK_TAB_ORDER = ["mimic_image", "mimic_carousel", "mimic_video"] as const;

export type MimicPickTabId = (typeof MIMIC_PICK_TAB_ORDER)[number];

const TIER_FOR_KIND: Record<MimicPickKind, string> = {
  image: "top_performer_deep",
  carousel: "top_performer_carousel",
  video: "top_performer_video",
};

const KIND_FOR_TIER: Record<string, MimicPickKind> = {
  top_performer_deep: "image",
  top_performer_carousel: "carousel",
  top_performer_video: "video",
};

export function mimicKindToFlowType(kind: MimicPickKind): string {
  switch (kind) {
    case "image":
      return FLOW_TOP_PERFORMER_MIMIC_IMAGE;
    case "carousel":
      return FLOW_TOP_PERFORMER_MIMIC_CAROUSEL;
    case "video":
      return FLOW_TOP_PERFORMER_MIMIC_VIDEO;
  }
}

export function mimicPickTabLabel(tab: MimicPickTabId): string {
  switch (tab) {
    case "mimic_image":
      return "Mimic · Image";
    case "mimic_carousel":
      return "Mimic · Carousel";
    case "mimic_video":
      return "Mimic · Video";
  }
}

export function mimicPickTabToKind(tab: MimicPickTabId): MimicPickKind {
  switch (tab) {
    case "mimic_image":
      return "image";
    case "mimic_carousel":
      return "carousel";
    case "mimic_video":
      return "video";
  }
}

export function isMimicPickTab(tab: string): tab is MimicPickTabId {
  return (MIMIC_PICK_TAB_ORDER as readonly string[]).includes(tab);
}

/** Rows for admin manual picker — top-performer references from visual_guidelines_pack_v1. */
export interface SignalPackMimicReferenceUiRow {
  pick_id: string;
  insights_id: string;
  mimic_kind: MimicPickKind;
  title: string;
  detail: string;
  platform: string;
  analysis_tier: string;
  source_evidence_row_id: string;
  has_inspection_media: boolean;
  format_pattern: string;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function stringish(v: unknown, max = 400): string {
  if (typeof v !== "string") return "";
  const t = v.trim();
  if (!t) return "";
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function hasInspectionMedia(entry: Record<string, unknown>): boolean {
  const im = asRecord(entry.inspection_media);
  const items = im?.items;
  if (Array.isArray(items) && items.length > 0) return true;
  const stored = entry.stored_inspection_media_json;
  if (stored && typeof stored === "object") {
    const rec = asRecord(stored);
    const storedItems = rec?.items;
    return Array.isArray(storedItems) && storedItems.length > 0;
  }
  return false;
}

export function buildSignalPackMimicReferencesForUi(
  signalPack: SignalPackRow | null
): SignalPackMimicReferenceUiRow[] {
  if (!signalPack) return [];
  const dg = asRecord(signalPack.derived_globals_json);
  const pack = asRecord(dg?.[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]);
  const entries = Array.isArray(pack?.entries) ? pack!.entries : [];
  const out: SignalPackMimicReferenceUiRow[] = [];

  for (const raw of entries) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const tier = stringish(entry.analysis_tier, 80);
    const mimicKind = KIND_FOR_TIER[tier];
    if (!mimicKind) continue;
    const insightsId = stringish(entry.insights_id, 200);
    if (!insightsId) continue;
    const rowId = stringish(entry.source_evidence_row_id, 40);
    const hook = stringish(entry.hook_text_preview, 160);
    const why = stringish(entry.why_it_worked, 280);
    const formatPattern = stringish(entry.format_pattern, 120);
    const title =
      hook ||
      why.slice(0, 120) ||
      `${formatPattern || tier} · row ${rowId || "?"}`;
    const detail = [why, formatPattern ? `Format: ${formatPattern}` : ""].filter(Boolean).join(" — ");
    const platform = platformFromEvidenceKind(stringish(entry.evidence_kind, 80) || "instagram_post");

    out.push({
      pick_id: insightsId,
      insights_id: insightsId,
      mimic_kind: mimicKind,
      title,
      detail: detail || "Top-performer reference",
      platform,
      analysis_tier: tier,
      source_evidence_row_id: rowId,
      has_inspection_media: hasInspectionMedia(entry),
      format_pattern: formatPattern,
    });
  }

  out.sort((a, b) => {
    const tierCmp = a.analysis_tier.localeCompare(b.analysis_tier);
    if (tierCmp !== 0) return tierCmp;
    return a.title.localeCompare(b.title);
  });
  return out;
}

export function groupMimicReferencesByTab(
  rows: SignalPackMimicReferenceUiRow[]
): Map<MimicPickTabId, SignalPackMimicReferenceUiRow[]> {
  const map = new Map<MimicPickTabId, SignalPackMimicReferenceUiRow[]>();
  for (const tab of MIMIC_PICK_TAB_ORDER) {
    map.set(tab, []);
  }
  for (const row of rows) {
    const tab: MimicPickTabId =
      row.mimic_kind === "image"
        ? "mimic_image"
        : row.mimic_kind === "carousel"
          ? "mimic_carousel"
          : "mimic_video";
    map.get(tab)!.push(row);
  }
  return map;
}

export function findVisualGuidelineEntry(
  signalPack: SignalPackRow | null,
  insightsId: string
): Record<string, unknown> | null {
  if (!signalPack) return null;
  const dg = asRecord(signalPack.derived_globals_json);
  const pack = asRecord(dg?.[SIGNAL_PACK_DERIVED_GLOBALS_KEYS.visualGuidelinesPackV1]);
  const entries = Array.isArray(pack?.entries) ? pack!.entries : [];
  const want = insightsId.trim();
  for (const raw of entries) {
    const entry = asRecord(raw);
    if (!entry) continue;
    if (stringish(entry.insights_id, 200) === want) return entry;
  }
  return null;
}

export { TIER_FOR_KIND };
