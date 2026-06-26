/**
 * Merge Document AI OCR + Nemotron semantic carousel JSON into persisted insight shape.
 */
import type { CarouselDocumentAiSlideOcr, CarouselDetectedTextLayer } from "../domain/carousel-slide-analysis.js";
import { attachCopySlotsToSlideRecord } from "./mimic-copy-slots.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function textBlockFromLayer(layer: CarouselDetectedTextLayer, role: string | null): Record<string, unknown> {
  const block: Record<string, unknown> = {
    text: layer.text,
    role: role ?? "other",
    align: layer.alignment,
    bbox_norm: {
      x: layer.bbox_pct.x,
      y: layer.bbox_pct.y,
      w: layer.bbox_pct.w,
      h: layer.bbox_pct.h,
    },
    bbox_pct: [
      Math.round(layer.bbox_pct.x * 100),
      Math.round(layer.bbox_pct.y * 100),
      Math.round((layer.bbox_pct.x + layer.bbox_pct.w) * 100),
      Math.round((layer.bbox_pct.y + layer.bbox_pct.h) * 100),
    ],
    source: "document_ai",
    position_confidence: layer.confidence != null && layer.confidence >= 0.85 ? "high" : "medium",
  };
  if (layer.font.size_px != null) block.font_size_px = layer.font.size_px;
  if (layer.font.weight != null) block.font_weight = layer.font.weight;
  if (layer.font.color_hex) block.color_hex = layer.font.color_hex;
  if (layer.font.family_detected) block.font_family = layer.font.family_detected;
  if (layer.font.bold != null) block.bold = layer.font.bold;
  if (layer.font.italic != null) block.italic = layer.font.italic;
  return block;
}

function pickNemotronRoleForLayer(
  slide: Record<string, unknown>,
  layerIndex: number
): string | null {
  const roles = slide.text_block_roles;
  if (!Array.isArray(roles)) return null;
  for (const raw of roles) {
    const r = asRecord(raw);
    if (!r) continue;
    const idx = Number(r.block_index ?? r.layer_index);
    if (idx === layerIndex) {
      const role = String(r.role ?? "").trim();
      if (role) return role;
    }
  }
  return null;
}

function mergeSlideRecord(
  nemotronSlide: Record<string, unknown>,
  ocr: CarouselDocumentAiSlideOcr | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...nemotronSlide };
  if (!ocr) return attachCopySlotsToSlideRecord(out);

  out.document_ai_ocr_v1 = ocr;
  out.on_screen_text_transcript = ocr.full_text;
  if (ocr.text_layers.length > 0) {
    const blocks: Record<string, unknown>[] = [];
    for (const layer of ocr.text_layers) {
      const role =
        pickNemotronRoleForLayer(nemotronSlide, layer.layer_index) ??
        inferRoleFromLayer(layer.layer_index, ocr.text_layers.length, layer.text);
      blocks.push(textBlockFromLayer(layer, role));
    }
    out.text_blocks = blocks;
    const primary = ocr.text_layers[0];
    if (primary?.font.size_px != null) {
      const typo = asRecord(out.typography) ?? {};
      typo.font_size_px_headline = primary.font.size_px;
      if (ocr.text_layers.length > 1 && ocr.text_layers[1]?.font.size_px != null) {
        typo.font_size_px_body = ocr.text_layers[1]!.font.size_px;
      }
      out.typography = typo;
    }
  }
  delete out.on_screen_text_transcript_nemotron;
  return attachCopySlotsToSlideRecord(out);
}

function inferRoleFromLayer(layerIndex: number, total: number, text: string): string {
  const t = String(text ?? "").trim();
  if (/^how you should text\b/i.test(t)) return "headline";
  if (/^your .+ friend$/i.test(t)) return "subheadline";
  if (layerIndex === total && total > 1) return "cta";
  if (layerIndex === 1) return "headline";
  return "body";
}

export function mergeCarouselReferenceAnalysis(
  nemotronParsed: Record<string, unknown> | null,
  ocrBySlide: Map<number, CarouselDocumentAiSlideOcr>
): Record<string, unknown> | null {
  if (!nemotronParsed) return null;
  const root: Record<string, unknown> = { ...nemotronParsed };
  const slidesRaw = root.slides;
  if (!Array.isArray(slidesRaw)) return root;

  const slides: Record<string, unknown>[] = [];
  for (const raw of slidesRaw) {
    const s = asRecord(raw);
    if (!s) continue;
    const idx = Number(s.slide_index);
    const ocr = Number.isFinite(idx) && idx > 0 ? ocrBySlide.get(idx) : undefined;
    slides.push(mergeSlideRecord(s, ocr));
  }
  root.slides = slides;
  if (ocrBySlide.size > 0) {
    root.document_ai_deck_v1 = {
      slide_count: ocrBySlide.size,
      slides: [...ocrBySlide.values()].map((o) => ({
        slide_index: o.slide_index,
        full_text: o.full_text,
        text_layer_count: o.text_layers.length,
        ocr_confidence_mean: o.ocr_confidence_mean,
      })),
    };
  }
  return root;
}

export const TOP_PERFORMER_CAROUSEL_WITH_DOCUMENT_AI_NEMOTRON_APPENDIX = `

Document AI provides exact on-screen text and typography separately. For each slide:
- Do NOT include on_screen_text_transcript, text_blocks[].text, font_size_px, color_hex, or bbox coordinates.
- DO include text_block_roles[]: { "block_index": 1, "role": "headline|subheadline|body|cta|logo|watermark|other" } matching reading order of visible text regions (block_index starts at 1).
- When two adjacent lines form one title sentence (e.g. headline + subheadline), label the second line **subheadline** — not body.
- DO include all visual / semantic fields: visual_description, layout_template, composition_blueprint (descriptions and element types only — no literal text in text_blocks), typography qualitative guesses (headline_guess, text_placement, relative_scale words only — no pixel sizes), slide_purpose, why_it_works, brand_specificity, color_tokens as color names not OCR.
- why_it_works (per slide): 3–4 sentences (~120+ chars) on why THIS slide works in the deck arc — distinct from visual_description and deck-level why_it_worked; never copy the deck thesis onto every slide.
- visual_description (per slide): 2–3 sentences (~80+ chars) on composition, subjects, palette, and mood.
- Describe ONLY pixels visible in each attached image.`;
