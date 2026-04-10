/**
 * Canonical content job task_id shape for orchestrator-created jobs:
 * `{run_id}__{platform}__{flow}__r{NNNN}__{variation}`
 *
 * Double underscores separate segments; variation is slugified or v{n}.
 */
import { isCarouselFlow } from "../decision_engine/flow-kind.js";

function slugSegment(raw: string, maxLen: number): string {
  const s = raw
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return (s || "x").slice(0, maxLen);
}

/** Short platform token for task IDs (IG / FB / TT / …). */
export function platformTagForTaskId(platform: string): string {
  const p = platform.trim().toLowerCase();
  if (!p) return "X";
  if (p === "ig" || p === "instagram" || p.includes("instagram")) return "IG";
  if (p === "fb" || p === "facebook" || p.includes("facebook")) return "FB";
  if (p.includes("tiktok") || p === "tt") return "TT";
  if (p.includes("youtube") || p === "yt" || p === "shorts") return "YT";
  if (p.includes("linkedin")) return "LI";
  if (p.includes("twitter")) return "X_TW";
  const collapsed = platform.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
  return collapsed.slice(0, 8) || "X";
}

export function flowSlugForTaskId(flowType: string): string {
  const s = flowType.replace(/^FLOW_/i, "").replace(/^Flow_/i, "");
  return slugSegment(s, 40);
}

/** Carousels are only planned for Instagram and Facebook. */
export function isCarouselAllowedPlatform(platform: string): boolean {
  const p = platform.trim().toLowerCase();
  if (!p) return false;
  if (p === "ig" || p === "fb") return true;
  if (p.includes("instagram")) return true;
  if (p.includes("facebook")) return true;
  return false;
}

export function buildContentTaskId(opts: {
  runId: string;
  platform: string;
  flowType: string;
  /** 1-based index of the signal-pack row */
  sourceRowIndex1Based: number;
  variationName: string;
  variationIndex: number;
}): string {
  const plat = platformTagForTaskId(opts.platform);
  const flow = flowSlugForTaskId(opts.flowType);
  const row = `r${String(opts.sourceRowIndex1Based).padStart(4, "0")}`;
  const varPart = opts.variationName.trim()
    ? slugSegment(opts.variationName, 28)
    : `v${opts.variationIndex + 1}`;
  return `${opts.runId}__${plat}__${flow}__${row}__${varPart}`;
}

/** Skip candidate expansion when carousel flow × non-IG/FB platform. */
export function shouldSkipCandidateForFlow(platform: string, flowType: string): boolean {
  return isCarouselFlow(flowType) && !isCarouselAllowedPlatform(platform);
}
