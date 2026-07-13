import { extractVisualFirstSlideVisualFields } from "../../../../src/domain/visual-first-carousel-visual-direction.js";

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s || null;
}

export function hasSlideIntelligenceBundle(mimicV1: Record<string, unknown> | null | undefined): boolean {
  const raw = mimicV1?.slide_intelligence;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const rec = raw as Record<string, unknown>;
  if (rec.schema_version !== "slide_intelligence_v1") return false;
  return Array.isArray(rec.slides) && rec.slides.length > 0;
}

export function newVisualSlideRole(slideIndex: number, totalSlides: number): string {
  if (slideIndex <= 1) return "hook";
  if (totalSlides > 1 && slideIndex >= totalSlides) return "cta";
  return "content";
}

export function isNewVisualCarouselMimic(mimicV1: Record<string, unknown> | null | undefined): boolean {
  if (!mimicV1) return false;
  if (String(mimicV1.execution_mode ?? "").trim() === "new_visual") return true;
  const refs = mimicV1.reference_items;
  return mimicV1.mode === "carousel_visual" && (!Array.isArray(refs) || refs.length === 0);
}

function slideRowsFromPayload(gp: Record<string, unknown>): Record<string, unknown>[] {
  const go = asRec(gp.generated_output);
  const snap = asRec(gp.draft_package_snapshot);
  for (const root of [go, snap, gp]) {
    if (!root) continue;
    const slides = root.slides;
    if (Array.isArray(slides) && slides.length > 0) {
      return slides.filter((s) => s && typeof s === "object" && !Array.isArray(s)) as Record<string, unknown>[];
    }
  }
  const vg = asRec(asRec(gp.mimic_v1)?.visual_guideline);
  const vgSlides = vg?.slides;
  if (Array.isArray(vgSlides) && vgSlides.length > 0) {
    return vgSlides.filter((s) => s && typeof s === "object" && !Array.isArray(s)) as Record<string, unknown>[];
  }
  return [];
}

function slideRowForIndex(rows: Record<string, unknown>[], slideIndex: number): Record<string, unknown> | null {
  const byIndex = rows.find((r) => Number(r.slide_index) === slideIndex);
  if (byIndex) return byIndex;
  return rows[slideIndex - 1] ?? null;
}

export type NewVisualSlideWhyContext = {
  deckConcept: string | null;
  thesis: string | null;
  noveltyAngle: string | null;
  keyPoints: string[];
  slideRole: string;
  arcPosition: string;
  visualDirection: string | null;
  visualMetaphor: string | null;
  mustAvoid: string | null;
  generatedCopy: string | null;
  slideArgument: string | null;
};

export function buildNewVisualSlideWhyContext(args: {
  generationPayload: Record<string, unknown> | null | undefined;
  mimicV1: Record<string, unknown> | null | undefined;
  slideIndex: number;
  slideCount: number;
  generatedOnScreenText?: string | null;
}): NewVisualSlideWhyContext | null {
  if (!isNewVisualCarouselMimic(args.mimicV1)) return null;
  if (hasSlideIntelligenceBundle(args.mimicV1)) return null;

  const gp = args.generationPayload ?? {};
  const mimic = args.mimicV1 ?? {};
  const candidate = asRec(gp.candidate_data) ?? asRec(gp.planned) ?? {};
  const vg = asRec(mimic.visual_guideline) ?? {};
  const renderCtx = asRec(gp.mimic_render_context) ?? {};

  const deckConcept =
    str(vg.deck_concept) ?? str(renderCtx.deck_concept) ?? str(candidate.title) ?? str(candidate.idea_title);
  const thesis =
    str(vg.thesis) ?? str(renderCtx.thesis) ?? str(candidate.thesis) ?? str(candidate.summary_excerpt);
  const noveltyAngle = str(vg.novelty_angle) ?? str(candidate.novelty_angle);

  const keyPoints = Array.isArray(candidate.key_points)
    ? candidate.key_points.map((x) => String(x ?? "").trim()).filter(Boolean).slice(0, 12)
    : [];

  const slideRows = slideRowsFromPayload(gp);
  const slideRow = slideRowForIndex(slideRows, args.slideIndex);
  const visual = extractVisualFirstSlideVisualFields(slideRow);

  const slideRole = newVisualSlideRole(args.slideIndex, Math.max(args.slideCount, 1));
  const arcPosition = `${slideRole} · beat ${args.slideIndex}/${Math.max(args.slideCount, 1)}`;

  const generatedCopy = args.generatedOnScreenText?.trim() || null;
  const slideArgument =
    str(slideRow?.slide_argument) ??
    str(slideRow?.narrative_function) ??
    (slideRole === "hook"
      ? "Stop the scroll and name the deck promise."
      : slideRole === "cta"
        ? "Close with a clear next step tied to the deck thesis."
        : keyPoints[Math.max(0, args.slideIndex - 2)] ?? "Advance one concrete idea in the deck arc.");

  return {
    deckConcept,
    thesis,
    noveltyAngle,
    keyPoints,
    slideRole,
    arcPosition,
    visualDirection: visual.visual_direction,
    visualMetaphor: visual.visual_metaphor,
    mustAvoid: visual.must_avoid,
    generatedCopy,
    slideArgument,
  };
}
