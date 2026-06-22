/**
 * Human-facing flow labels for jobs that replicate top-performer references ("mimic" lanes).
 * Canonical `flow_type` stays unchanged for prompts, filters, and joins.
 */
import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";
import { groundingInsightIdsFromCandidate } from "./mimic-job-grounding.js";
import { pickMimicPayload } from "./mimic-payload.js";
import type { VideoPipelineIntent } from "../decision_engine/video-flow-routing.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_VIDEO,
  isTopPerformerMimicFlow,
  isTopPerformerMimicImageFlow,
  isTpGroundedCarouselRenderFlow,
  isVisualFirstCarouselFlow,
} from "./top-performer-mimic-flow-types.js";
import {
  TOP_PERFORMER_MIMIC_VIDEO_HEYGEN_FLOWS,
  heygenLaneLabelForIntent,
} from "./top-performer-video-heygen-routing.js";

export type MimicReplicationKind = "image" | "carousel" | "video";

export interface JobFlowDisplayInfo {
  /** Canonical execution flow (unchanged). */
  flow_type: string;
  /** Human label — includes Mimic · … when the job replicates a top performer. */
  flow_label: string;
  is_mimic_replication: boolean;
  mimic_kind: MimicReplicationKind | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function mimicKindLabel(kind: MimicReplicationKind): string {
  switch (kind) {
    case "image":
      return "Mimic · Image";
    case "carousel":
      return "Mimic · Carousel";
    case "video":
      return "Mimic · Video";
  }
}

function mimicKindFromGroundingIds(ids: string[]): MimicReplicationKind | null {
  if (ids.some((id) => /_vdeep$/i.test(id))) return "video";
  if (ids.some((id) => /_(?:cdeep|broad)$/i.test(id))) return "carousel";
  return null;
}

function mimicKindFromCandidate(candidate: Record<string, unknown> | null): MimicReplicationKind | null {
  if (!candidate) return null;
  const kind = str(candidate.mimic_kind).toLowerCase();
  if (kind === "image" || kind === "carousel" || kind === "video") return kind;

  const target = str(candidate.target_flow_type);
  if (isTopPerformerMimicImageFlow(target)) return "image";
  if (isTpGroundedCarouselRenderFlow(target)) return "carousel";
  if (target === FLOW_TOP_PERFORMER_MIMIC_VIDEO) return "video";

  const cid = str(candidate.candidate_id ?? candidate.idea_id ?? candidate.id);
  if (!cid.startsWith("mimic_")) return null;

  const fmt = str(candidate.format).toLowerCase();
  if (fmt === "video") return "video";
  if (fmt === "carousel") return "carousel";
  if (fmt === "post") return "image";
  return null;
}

function isHeygenMimicVideoFlow(flowType: string): boolean {
  return (TOP_PERFORMER_MIMIC_VIDEO_HEYGEN_FLOWS as readonly string[]).includes(flowType);
}

function heygenSubLabel(flowType: string, candidate: Record<string, unknown> | null): string {
  const style = str(candidate?.video_style) as VideoPipelineIntent;
  if (style === "script_avatar" || style === "prompt_avatar" || style === "no_avatar") {
    return heygenLaneLabelForIntent(style);
  }
  if (flowType === CANONICAL_FLOW_TYPES.VID_SCRIPT) return heygenLaneLabelForIntent("script_avatar");
  if (flowType === CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR) {
    return heygenLaneLabelForIntent("no_avatar");
  }
  if (flowType === CANONICAL_FLOW_TYPES.VID_PROMPT) return heygenLaneLabelForIntent("prompt_avatar");
  return "HeyGen";
}

function isMimicReplicationJob(
  flowType: string,
  gp: Record<string, unknown>,
  candidate: Record<string, unknown> | null
): boolean {
  if (isTopPerformerMimicFlow(flowType) || isVisualFirstCarouselFlow(flowType)) return true;
  if (isTpGroundedCarouselRenderFlow(flowType) || isTopPerformerMimicImageFlow(flowType)) return true;
  if (pickMimicPayload(gp)) return true;
  if (asRecord(gp.mimic_job_grounding)) return true;
  if (candidate?.manual_mimic_pick === true) return true;
  if (mimicKindFromCandidate(candidate)) return true;
  if (groundingInsightIdsFromCandidate(candidate).length > 0 && isHeygenMimicVideoFlow(flowType)) {
    return true;
  }
  return false;
}

function resolveMimicKind(
  flowType: string,
  candidate: Record<string, unknown> | null,
  isMimic: boolean
): MimicReplicationKind | null {
  const fromCandidate = mimicKindFromCandidate(candidate);
  if (fromCandidate) return fromCandidate;
  const fromGrounding = mimicKindFromGroundingIds(groundingInsightIdsFromCandidate(candidate));
  if (fromGrounding) return fromGrounding;
  if (!isMimic) return null;
  if (isTopPerformerMimicImageFlow(flowType)) return "image";
  if (isTpGroundedCarouselRenderFlow(flowType)) return "carousel";
  if (isHeygenMimicVideoFlow(flowType) || flowType === FLOW_TOP_PERFORMER_MIMIC_VIDEO) return "video";
  return null;
}

export function resolveJobFlowDisplayLabel(
  flowTypeRaw: string | null | undefined,
  generationPayload?: unknown
): JobFlowDisplayInfo {
  const flow_type = str(flowTypeRaw) || "UNKNOWN";
  const gp = asRecord(generationPayload) ?? {};
  const candidate = asRecord(gp.candidate_data);
  const is_mimic_replication = isMimicReplicationJob(flow_type, gp, candidate);
  const mimic_kind = resolveMimicKind(flow_type, candidate, is_mimic_replication);

  if (!is_mimic_replication) {
    return { flow_type, flow_label: flow_type, is_mimic_replication: false, mimic_kind: null };
  }

  let flow_label: string;
  if (isVisualFirstCarouselFlow(flow_type)) {
    flow_label = "Mimic · Carousel (visual-first)";
  } else if (mimic_kind === "carousel" && isHeygenMimicVideoFlow(flow_type)) {
    flow_label = `Mimic · Carousel ref → ${heygenSubLabel(flow_type, candidate)}`;
  } else if (mimic_kind === "video" && isHeygenMimicVideoFlow(flow_type)) {
    flow_label = `${mimicKindLabel("video")} → ${heygenSubLabel(flow_type, candidate)}`;
  } else if (mimic_kind) {
    flow_label = mimicKindLabel(mimic_kind);
  } else if (flow_type === FLOW_TOP_PERFORMER_MIMIC_VIDEO) {
    flow_label = mimicKindLabel("video");
  } else {
    flow_label = `Mimic · ${flow_type.replace(/^FLOW_/, "").replace(/_/g, " ")}`;
  }

  return { flow_type, flow_label, is_mimic_replication: true, mimic_kind };
}
