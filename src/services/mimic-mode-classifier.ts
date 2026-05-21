import type { MimicMode, MimicSlidePlan } from "../domain/mimic-payload.js";
import {
  aestheticSlideRecords,
  requiresCopyBeforeVisualMimic,
} from "../domain/mimic-text-heavy.js";
import { entryReferenceFrameCount } from "./mimic-reference-resolver.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
} from "../domain/top-performer-mimic-flow-types.js";

export function classifyMimicMode(
  flowType: string,
  entry: Record<string, unknown>
): { mode: MimicMode; slide_plans?: MimicSlidePlan[] } {
  if (flowType === FLOW_TOP_PERFORMER_MIMIC_IMAGE) {
    return { mode: "image_full" };
  }
  if (flowType !== FLOW_TOP_PERFORMER_MIMIC_CAROUSEL) {
    return { mode: "carousel_visual" };
  }

  const slides = aestheticSlideRecords(entry);

  if (requiresCopyBeforeVisualMimic(entry)) {
    return { mode: "template_bg" };
  }

  const refFrames = entryReferenceFrameCount(entry);
  const slideCount = Math.max(slides.length, refFrames, 1);
  const slide_plans: MimicSlidePlan[] = [];
  for (let i = 0; i < slideCount; i++) {
    const s = slides[i] ?? {};
    const density = String(s.text_density ?? "").toLowerCase();
    const role = String(s.image_or_photo_role ?? "").toLowerCase();
    // Text-only slides use template overlay; otherwise default to full-bleed mimic when role is missing.
    const fullBleed = role !== "none" && density !== "high";
    slide_plans.push({
      slide_index: i + 1,
      render_mode: fullBleed ? "full_bleed" : "hbs",
      reference_index: Math.min(i + 1, refFrames || slides.length || 1),
    });
  }

  return { mode: "carousel_visual", slide_plans };
}
