/**
 * New Visual Carousel — original brand carousel lane (`FLOW_VISUAL_FIRST_CAROUSEL`).
 * Uses mimic image/copy engine without top-performer replication.
 */
import type { MimicPayloadV1, MimicSlidePlan } from "./mimic-payload.js";
import { isVisualFirstCarouselFlow } from "./visual-first-carousel-flow-types.js";

export const MIMIC_EXECUTION_MODE_NEW_VISUAL = "new_visual" as const;

export type NewVisualCarouselExecutionMode = typeof MIMIC_EXECUTION_MODE_NEW_VISUAL;

export function isNewVisualCarouselExecution(
  flowType: string,
  mimic?: Pick<MimicPayloadV1, "execution_mode"> | null
): boolean {
  const mode = String(mimic?.execution_mode ?? "").trim();
  if (mode === MIMIC_EXECUTION_MODE_NEW_VISUAL) return true;
  return isVisualFirstCarouselFlow(flowType);
}

/** True when a stored mimic payload should be rebuilt (legacy TP-replication prep). */
export function staleNewVisualCarouselPayload(
  mimic: Pick<MimicPayloadV1, "execution_mode" | "mode" | "reference_items"> | null | undefined
): boolean {
  if (!mimic) return true;
  if (String(mimic.execution_mode ?? "").trim() !== MIMIC_EXECUTION_MODE_NEW_VISUAL) return true;
  if (mimic.mode === "template_bg") return true;
  if ((mimic.reference_items?.length ?? 0) > 0) return true;
  return false;
}

export function inferNewVisualTargetSlideCount(candidateData: Record<string, unknown>): number {
  const keyPoints = Array.isArray(candidateData.key_points)
    ? candidateData.key_points.map((x) => String(x ?? "").trim()).filter(Boolean)
    : [];
  if (keyPoints.length > 0) {
    return Math.min(Math.max(keyPoints.length + 2, 5), 10);
  }
  const threeLiner = String(candidateData.three_liner ?? "")
    .split(/\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (threeLiner.length >= 3) {
    return Math.min(Math.max(threeLiner.length + 1, 5), 8);
  }
  return 6;
}

export function isNewVisualMimicPayload(
  mimic: Pick<MimicPayloadV1, "execution_mode" | "mode" | "reference_items"> | null | undefined
): boolean {
  if (String(mimic?.execution_mode ?? "").trim() === MIMIC_EXECUTION_MODE_NEW_VISUAL) return true;
  return mimic?.mode === "carousel_visual" && (mimic.reference_items?.length ?? 0) === 0;
}

export function buildNewVisualSlidePlans(slideCount: number): MimicSlidePlan[] {
  const n = Math.max(1, Math.floor(slideCount));
  return Array.from({ length: n }, (_, i) => ({
    slide_index: i + 1,
    render_mode: "full_bleed" as const,
    reference_index: i + 1,
    source_slide_index: i + 1,
  }));
}

export function newVisualSlidePurpose(slideIndex: number, totalSlides: number): string {
  if (slideIndex <= 1) return "hook";
  if (totalSlides > 1 && slideIndex >= totalSlides) return "cta";
  return "content";
}

export const NEW_VISUAL_CAROUSEL_RERUN_PAYLOAD_DROP_KEYS = [
  "mimic_v1",
  "mimic_render_context",
  "mimic_render_settings",
  "template_backgrounds_prepared_at",
  "template_backgrounds_slide_count",
  "template_storage_decision",
  "draft_package_snapshot",
  "draft_package_type",
] as const;
