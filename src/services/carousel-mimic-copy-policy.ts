import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  CAROUSEL_COPY_SYSTEM_ADDENDUM,
  MIMIC_FULL_BLEED_COPY_ADDENDUM,
  MIMIC_TEMPLATE_BG_COPY_ADDENDUM,
} from "./carousel-copy-prompt-policy.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export type MimicCarouselCopyBranch = "template_bg" | "full_bleed" | "default";

/** Which copy contract applies for this mimic carousel job. */
export function mimicCarouselCopyBranch(
  mimic: MimicPayloadV1 | null,
  mimicRenderContext: Record<string, unknown> | null | undefined
): MimicCarouselCopyBranch {
  if (!mimic) return "default";
  const ctx = mimicRenderContext ?? {};
  const seq = String(ctx.render_sequence ?? "").trim();
  if (mimic.mode === "template_bg" || seq === "copy_then_template_overlay") return "template_bg";
  if (mimic.mode === "carousel_visual" || seq === "per_slide_visual_mimic") return "full_bleed";
  return "default";
}

/** System-prompt addendum(s) for mimic carousel copy generation. */
export function mimicCarouselCopySystemAddendum(
  branch: MimicCarouselCopyBranch
): string {
  if (branch === "template_bg") {
    return `${CAROUSEL_COPY_SYSTEM_ADDENDUM}\n\n${MIMIC_TEMPLATE_BG_COPY_ADDENDUM}`.trim();
  }
  if (branch === "full_bleed") {
    return `${CAROUSEL_COPY_SYSTEM_ADDENDUM}\n\n${MIMIC_FULL_BLEED_COPY_ADDENDUM}`.trim();
  }
  return CAROUSEL_COPY_SYSTEM_ADDENDUM;
}

/** Full-bleed jobs should not use long body-length targets meant for listicle templates. */
export function mimicCarouselUsesFullBodyLengthTargets(branch: MimicCarouselCopyBranch): boolean {
  return branch === "template_bg" || branch === "default";
}
