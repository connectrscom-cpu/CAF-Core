import type { MimicMode, MimicSlidePlan } from "../domain/mimic-payload.js";
import type { SignalPackRow } from "../repositories/signal-packs.js";
import { getMimicModeOverridesFromPack } from "../repositories/signal-packs.js";
import { SIGNAL_PACK_DERIVED_GLOBALS_KEYS } from "../domain/signal-pack-top-performer-knowledge.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
  FLOW_TOP_PERFORMER_MIMIC_VIDEO,
} from "../domain/top-performer-mimic-flow-types.js";
import {
  heygenLaneLabelForIntent,
  resolveTopPerformerVideoHeygenRoute,
} from "../domain/top-performer-video-heygen-routing.js";
import { classifyMimicMode } from "./mimic-mode-classifier.js";
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

/** Resolve planner target_flow_type for a video top-performer reference (HeyGen lane). */
export function mimicVideoPickFlowType(entry: Record<string, unknown>): string {
  return resolveTopPerformerVideoHeygenRoute(entry).flow_type;
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
  /** Human label: Template | Full bleed | Mixed | Image | — */
  predicted_render_label: string;
  /** Classifier mode (when applicable). */
  predicted_mimic_mode: MimicMode | null;
  /** Short reason (Nemotron mode_reason or heuristic note). */
  predicted_render_detail: string;
  /** Manual override on signal pack (`derived_globals_json.mimic_mode_overrides`). */
  mode_override: MimicMode | null;
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

/** UI label for how a mimic carousel will render (matches classifier at generate time). */
export function mimicRenderLabelForMode(mode: MimicMode, slidePlans?: MimicSlidePlan[]): string {
  if (mode === "image_full") return "Image";
  if (mode === "template_bg") return "Template";
  const plans = slidePlans ?? [];
  if (!plans.length) return "Full bleed";
  const fullBleedCount = plans.filter((p) => p.render_mode === "full_bleed").length;
  if (fullBleedCount === 0) return "Template";
  if (fullBleedCount === plans.length) return "Full bleed";
  return "Mixed";
}

function mimicRenderDetailForEntry(
  entry: Record<string, unknown>,
  mode: MimicMode,
  slidePlans?: MimicSlidePlan[]
): string {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const mimicEval = asRecord(aes.mimic_evaluation) ?? asRecord(entry.mimic_evaluation);
  const modeReason = stringish(mimicEval?.mode_reason, 160);
  if (modeReason) return modeReason;

  if (mode === "template_bg") {
    const tc = stringish(mimicEval?.template_consistency, 40);
    return tc ? `Text on template (${tc} background)` : "Text on shared template background";
  }
  if (mode === "image_full") return "Single-frame visual mimic";

  const plans = slidePlans ?? [];
  const fb = plans.filter((p) => p.render_mode === "full_bleed").length;
  const hbs = plans.length - fb;
  if (plans.length > 0 && fb > 0 && hbs > 0) {
    return `${fb} full-bleed slide(s), ${hbs} text-on-template slide(s)`;
  }
  const recommended = stringish(mimicEval?.recommended_mode, 80);
  if (recommended) return `Nemotron: ${recommended.replace(/_/g, " ")}`;
  return "Visual-led per-slide mimic (Qwen)";
}

function predictedRenderForEntry(
  mimicKind: MimicPickKind,
  entry: Record<string, unknown>,
  modeOverride?: MimicMode | null
): { mode: MimicMode | null; label: string; detail: string } {
  if (mimicKind === "video") {
    const route = resolveTopPerformerVideoHeygenRoute(entry);
    return {
      mode: null,
      label: heygenLaneLabelForIntent(route.intent),
      detail: `Routes to ${route.flow_type} (${route.reason})`,
    };
  }
  const flow = mimicKindToFlowType(mimicKind);
  const { mode, slide_plans } = classifyMimicMode(flow, entry, modeOverride ?? null);
  return {
    mode,
    label: mimicRenderLabelForMode(mode, slide_plans),
    detail: mimicRenderDetailForEntry(entry, mode, slide_plans),
  };
}

export function buildSignalPackMimicReferencesForUi(
  signalPack: SignalPackRow | null
): SignalPackMimicReferenceUiRow[] {
  if (!signalPack) return [];
  const modeOverrides = getMimicModeOverridesFromPack(signalPack);
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
    const modeOverride = modeOverrides[insightsId] as MimicMode | null | undefined;
    const predicted = predictedRenderForEntry(mimicKind, entry, modeOverride ?? null);

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
      predicted_render_label: predicted.label,
      predicted_mimic_mode: predicted.mode,
      predicted_render_detail: predicted.detail,
      mode_override: modeOverride ?? null,
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
