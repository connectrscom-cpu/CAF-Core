import type { MimicMode, MimicSlidePlan, MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  aestheticSlideRecords,
  deckUsesUnifiedBackgroundPlate,
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
    const refFrames = entryReferenceFrameCount(entry);
    const slideCount = Math.max(slides.length, refFrames, 1);
    const unifiedBg = deckUsesUnifiedBackgroundPlate(entry);
    const slide_plans: MimicSlidePlan[] = [];
    for (let i = 0; i < slideCount; i++) {
      const refSlot = unifiedBg ? 1 : refFrames > 0 ? (i % refFrames) + 1 : 1;
      slide_plans.push({
        slide_index: i + 1,
        render_mode: "hbs",
        reference_index: refSlot,
      });
    }
    return { mode: "template_bg", slide_plans };
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

/** Ensure every output slide has a render plan (cycle reference frames for extras). */
export function extendSlidePlansForOutputCount(
  mimic: { mode: MimicMode; reference_items: { index: number }[]; slide_plans?: MimicSlidePlan[] },
  outputSlideCount: number
): MimicSlidePlan[] {
  const refCount = Math.max(mimic.reference_items.length, 1);
  const plans = [...(mimic.slide_plans ?? [])];
  const defaultMode: MimicSlidePlan["render_mode"] =
    mimic.mode === "template_bg" ? "hbs" : plans[plans.length - 1]?.render_mode ?? "hbs";

  for (let slideIndex = plans.length + 1; slideIndex <= outputSlideCount; slideIndex++) {
    const unifiedBg = mimic.mode === "template_bg";
    const refSlot = unifiedBg ? 1 : refCount > 0 ? ((slideIndex - 1) % refCount) + 1 : 1;
    const render_mode =
      mimic.mode === "template_bg"
        ? "hbs"
        : defaultMode === "full_bleed" && slideIndex > (mimic.slide_plans?.length ?? 0)
          ? "hbs"
          : defaultMode;
    plans.push({ slide_index: slideIndex, render_mode, reference_index: refSlot });
  }
  return plans;
}

/** Re-classify from persisted visual_guideline when prep ran before classifier rules improved. */
export function reconcileMimicPayloadAtRender(
  flowType: string,
  mimic: MimicPayloadV1
): MimicPayloadV1 {
  if (flowType !== FLOW_TOP_PERFORMER_MIMIC_CAROUSEL) return mimic;
  const vg = mimic.visual_guideline ?? {};
  const entry: Record<string, unknown> = {
    ...vg,
    stored_inspection_media_json: {
      items: mimic.reference_items.map((r) => ({
        index: r.index,
        vision_fetch_url: r.vision_fetch_url ?? "",
      })),
    },
  };
  const classified = classifyMimicMode(flowType, entry);
  return { ...mimic, mode: classified.mode, slide_plans: classified.slide_plans ?? mimic.slide_plans };
}
