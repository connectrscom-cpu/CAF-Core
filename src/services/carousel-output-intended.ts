/**
 * Build intended on-slide copy spec from a rendered carousel job (for post-generation OCR QA).
 */
import { pickGeneratedOutputOrEmpty } from "../domain/generation-payload-output.js";
import { pickMimicPayload } from "../domain/mimic-payload.js";
import type { BboxPct, CarouselIntendedTextLayer, CarouselOutputIntended } from "../domain/carousel-slide-analysis.js";

const DEFAULT_CANVAS = { width_px: 1080, height_px: 1350 };

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function parseBboxPct(raw: unknown): BboxPct | null {
  const norm = asRecord(raw);
  if (norm) {
    const x = Number(norm.x);
    const y = Number(norm.y);
    const w = Number(norm.w ?? norm.width);
    const h = Number(norm.h ?? norm.height);
    if ([x, y, w, h].every((n) => Number.isFinite(n))) {
      return {
        x: Math.max(0, Math.min(1, x)),
        y: Math.max(0, Math.min(1, y)),
        w: Math.max(0, Math.min(1, w)),
        h: Math.max(0, Math.min(1, h)),
      };
    }
  }
  if (Array.isArray(raw) && raw.length >= 4) {
    const nums = raw.slice(0, 4).map((v) => Number(v));
    if (!nums.every((n) => Number.isFinite(n))) return null;
    const max = Math.max(...nums.map(Math.abs));
    if (max <= 1.05) {
      return { x: nums[0]!, y: nums[1]!, w: nums[2]!, h: nums[3]! };
    }
    const x1 = Math.min(nums[0]!, nums[2]!);
    const y1 = Math.min(nums[1]!, nums[3]!);
    const x2 = Math.max(nums[0]!, nums[2]!);
    const y2 = Math.max(nums[1]!, nums[3]!);
    return {
      x: x1 / 100,
      y: y1 / 100,
      w: (x2 - x1) / 100,
      h: (y2 - y1) / 100,
    };
  }
  return null;
}

function slideGuidelineRecord(vg: Record<string, unknown>, slideIndex: number): Record<string, unknown> | null {
  const slides = vg.slides;
  if (!Array.isArray(slides)) return null;
  for (const raw of slides) {
    const s = asRecord(raw);
    if (!s) continue;
    if (Number(s.slide_index) === slideIndex) return s;
  }
  return null;
}

function textLayersFromSlide(
  slide: Record<string, unknown>,
  guidelineSlide: Record<string, unknown> | null,
  slideIndex: number
): CarouselIntendedTextLayer[] {
  const layers: CarouselIntendedTextLayer[] = [];
  const blocks = slide.text_blocks ?? guidelineSlide?.text_blocks;
  if (Array.isArray(blocks)) {
    let i = 0;
    for (const raw of blocks) {
      const b = asRecord(raw);
      if (!b) continue;
      const text = String(b.text ?? b.content ?? "").trim();
      if (!text) continue;
      i++;
      layers.push({
        id: String(b.role ?? b.id ?? `layer_${i}`).trim() || `layer_${i}`,
        text,
        bbox_pct: parseBboxPct(b.bbox_norm) ?? parseBboxPct(b.bbox_pct) ?? parseBboxPct(b.bbox),
        font: {
          size_px: Number(b.font_size_px) > 0 ? Math.round(Number(b.font_size_px)) : null,
          color_hex: typeof b.color_hex === "string" ? b.color_hex : null,
          weight: Number(b.font_weight) > 0 ? Math.round(Number(b.font_weight)) : null,
        },
      });
    }
    if (layers.length > 0) return layers;
  }

  const headline = String(slide.headline ?? slide.title ?? "").trim();
  const body = String(slide.body ?? slide.subtitle ?? "").trim();
  const kicker = String(slide.kicker ?? "").trim();
  if (kicker) layers.push({ id: "kicker", text: kicker, bbox_pct: null, font: {} });
  if (headline) layers.push({ id: "headline", text: headline, bbox_pct: null, font: {} });
  if (body) layers.push({ id: "body", text: body, bbox_pct: null, font: {} });

  const refTranscript = String(guidelineSlide?.on_screen_text_transcript ?? "").trim();
  if (layers.length === 0 && refTranscript) {
    layers.push({ id: "reference_transcript", text: refTranscript, bbox_pct: null, font: {} });
  }
  void slideIndex;
  return layers;
}

function forbiddenFromMimic(mimic: Record<string, unknown> | null): string[] {
  const vg = mimic ? asRecord(mimic.visual_guideline) : null;
  const avoid = vg?.mimic_instruction ?? mimic?.mimic_instruction;
  const arr = asRecord(avoid)?.avoid ?? asRecord(vg)?.avoid;
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => String(s).trim()).filter(Boolean);
}

export function buildCarouselOutputIntended(
  generationPayload: Record<string, unknown> | null | undefined,
  slideIndex: number,
  opts?: { artOnlyImage?: boolean }
): CarouselOutputIntended {
  const gp = generationPayload ?? {};
  const gen = pickGeneratedOutputOrEmpty(gp);
  const mimic = pickMimicPayload(gp);
  const mimicRec = mimic as unknown as Record<string, unknown> | null;
  const vg = mimicRec ? asRecord(mimicRec.visual_guideline) : null;
  const guidelineSlide = vg ? slideGuidelineRecord(vg, slideIndex) : null;

  const slides =
    (Array.isArray(gen.slides) && gen.slides) ||
    (Array.isArray(gen.slide_deck) && gen.slide_deck) ||
    (asRecord(gen.carousel)?.slides as unknown[]) ||
    [];
  const slideRaw = slides[slideIndex - 1];
  const slide = asRecord(slideRaw) ?? {};

  const snapshot = asRecord(gp.draft_package_snapshot);
  const renderPlan = asRecord(snapshot?.render_plan) ?? asRecord(gp.mimic_render_context);
  const artOnly =
    opts?.artOnlyImage ??
    (renderPlan?.strategy === "per_slide_mimic" || mimic?.mode === "carousel_visual");

  return {
    canvas: { ...DEFAULT_CANVAS },
    text_layers: textLayersFromSlide(slide, guidelineSlide, slideIndex),
    forbidden_text: forbiddenFromMimic(mimicRec),
    safe_margin_pct: 0.06,
    art_only_image: Boolean(artOnly),
  };
}
