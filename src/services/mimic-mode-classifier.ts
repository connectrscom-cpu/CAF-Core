import type { MimicMode, MimicSlidePlan } from "../domain/mimic-payload.js";
import {
  FLOW_TOP_PERFORMER_MIMIC_CAROUSEL,
  FLOW_TOP_PERFORMER_MIMIC_IMAGE,
} from "../domain/top-performer-mimic-flow-types.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function slideRecords(entry: Record<string, unknown>): Record<string, unknown>[] {
  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const slides = aes.slides;
  if (!Array.isArray(slides)) return [];
  return slides.map((s) => asRecord(s)).filter((x): x is Record<string, unknown> => x != null);
}

function avgTextDensityHigh(slides: Record<string, unknown>[]): boolean {
  if (slides.length === 0) return false;
  let high = 0;
  for (const s of slides) {
    if (String(s.text_density ?? "").toLowerCase() === "high") high++;
  }
  return high >= Math.ceil(slides.length * 0.6);
}

function mostlyNoImageRole(slides: Record<string, unknown>[]): boolean {
  if (slides.length === 0) return true;
  let none = 0;
  for (const s of slides) {
    const role = String(s.image_or_photo_role ?? "").toLowerCase();
    if (!role || role === "none") none++;
  }
  return none >= Math.ceil(slides.length * 0.6);
}

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

  const aes = asRecord(entry.aesthetic_analysis_json) ?? entry;
  const formatPattern = String(aes.format_pattern ?? entry.format_pattern ?? "").toLowerCase();
  const slides = slideRecords(entry);
  const templateLike =
    (formatPattern === "educational" ||
      formatPattern === "listicle" ||
      formatPattern.includes("list")) &&
    avgTextDensityHigh(slides) &&
    mostlyNoImageRole(slides);

  if (templateLike) {
    return { mode: "template_bg" };
  }

  const slide_plans: MimicSlidePlan[] = [];
  for (let i = 0; i < Math.max(slides.length, 1); i++) {
    const s = slides[i] ?? {};
    const density = String(s.text_density ?? "").toLowerCase();
    const role = String(s.image_or_photo_role ?? "").toLowerCase();
    const fullBleed = density !== "high" && role && role !== "none";
    slide_plans.push({
      slide_index: i + 1,
      render_mode: fullBleed ? "full_bleed" : "hbs",
      reference_index: Math.min(i + 1, slides.length || 1),
    });
  }

  return { mode: "carousel_visual", slide_plans };
}
