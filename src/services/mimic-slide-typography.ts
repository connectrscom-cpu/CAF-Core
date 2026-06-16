import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import { sanitizeMimicOverlayCopyText } from "../domain/mimic-overlay-copy.js";
import type { ProjectBrandAssetRow } from "../repositories/project-config.js";
import {
  collectInstagramHandlesFromText,
  formatInstagramHandleForCta,
  isHandleTextBlock,
  looksLikeInstagramHandleText,
  stripLeadingInstagramHandle,
  substituteReferenceHandlesInText,
} from "../domain/instagram-handle.js";
import {
  collapseParagraphCopyTargets,
  blocksVerticallyNestedOrAdjacent,
  dropOcrContainerBoxes,
  filterOverlayLayoutBlocks,
  isChatMockFriendSubtitle,
  isOverlayChromeReferenceText,
  bodySlotIndexForHeadlineRemainder,
  isPreserveReferenceDecorText,
  preferSingleLineTextBackLayer,
  referenceTextMatchesLlmHeadline,
  shouldRenderDocAiLayerSingleLine,
  splitHeadlineWithPreservedDecorTitle,
} from "./mimic-docai-overlay-layout.js";
import {
  assignLlmCopyUsingCopySlots,
  parseCopySlotsFromSlide,
  isChatMockTitlePairBlocks,
  isTemplateInstructionText,
  splitHeadlineForChatMockTitlePair,
} from "./mimic-copy-slots.js";
import {
  bodyLinesToSemanticUnits,
  fitSemanticUnitsToStackCount,
  joinOrphanWordBodyLines,
  repairDanglingStackTexts,
  semanticBodyCopyForStacks,
} from "./mimic-semantic-copy-units.js";

export { joinOrphanWordBodyLines } from "./mimic-semantic-copy-units.js";

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function slideOnScreenTextChars(slide: Record<string, unknown>): number {
  return String(slide.on_screen_text_transcript ?? slide.on_image_text ?? "").trim().length;
}

export interface MimicTextBlock {
  text: string;
  role: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  align: string | null;
  font_size_px: number | null;
  font_weight: string | null;
  color_hex: string | null;
  font_family: string | null;
  source: string | null;
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

function pickNum(raw: unknown): number | null {
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function pickBBoxNorm(rec: Record<string, unknown>): { x: number; y: number; w: number; h: number } | null {
  const directX = pickNum(rec.x);
  const directY = pickNum(rec.y);
  const directW = pickNum(rec.w);
  const directH = pickNum(rec.h);
  if (directX != null && directY != null && directW != null && directH != null) {
    return {
      x: clamp01(directX),
      y: clamp01(directY),
      w: clamp01(directW),
      h: clamp01(directH),
    };
  }

  const bboxNorm = asRecord(rec.bbox_norm);
  if (bboxNorm) {
    const x = pickNum(bboxNorm.x ?? bboxNorm.left);
    const y = pickNum(bboxNorm.y ?? bboxNorm.top);
    const w = pickNum(bboxNorm.w ?? bboxNorm.width);
    const h = pickNum(bboxNorm.h ?? bboxNorm.height);
    if (x != null && y != null && w != null && h != null) return { x: clamp01(x), y: clamp01(y), w: clamp01(w), h: clamp01(h) };
  }
  const bbox = Array.isArray(rec.bbox) ? rec.bbox : Array.isArray(rec.bounding_box) ? rec.bounding_box : null;
  if (bbox && bbox.length >= 4) {
    const [a, b, c, d] = bbox.map((v) => Number(v));
    if (![a, b, c, d].every((v) => Number.isFinite(v))) return null;
    const maxVal = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d));
    if (maxVal <= 1.05) {
      return { x: clamp01(a), y: clamp01(b), w: clamp01(c), h: clamp01(d) };
    }
    const canvasW = 1080;
    const canvasH = 1350;
    const x2 = Math.max(a, c);
    const y2 = Math.max(b, d);
    const x1 = Math.min(a, c);
    const y1 = Math.min(b, d);
    return {
      x: clamp01(x1 / canvasW),
      y: clamp01(y1 / canvasH),
      w: clamp01((x2 - x1) / canvasW),
      h: clamp01((y2 - y1) / canvasH),
    };
  }
  return null;
}

export function parseMimicTextBlocks(raw: unknown): MimicTextBlock[] {
  if (!Array.isArray(raw)) return [];
  const out: MimicTextBlock[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const text = String(rec.text ?? rec.content ?? "").trim();
    if (!text) continue;
    const box = pickBBoxNorm(rec);
    if (!box) continue;
    const fontPx = pickNum(rec.font_size_px ?? rec.estimated_font_size_px ?? rec.font_size);
    const color = String(rec.color_hex ?? rec.color ?? "").trim();
    const family = String(rec.font_family ?? rec.font_family_detected ?? "").trim();
    const source = String(rec.source ?? "").trim().toLowerCase() || null;
    out.push({
      text,
      role: String(rec.role ?? rec.semantic_role ?? "").trim().toLowerCase() || null,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      align: String(rec.align ?? rec.alignment ?? rec.text_align ?? "").trim().toLowerCase() || null,
      font_size_px: fontPx != null && fontPx > 0 && fontPx < 400 ? Math.round(fontPx) : null,
      font_weight: String(rec.font_weight ?? rec.weight ?? "").trim().toLowerCase() || null,
      color_hex: /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : null,
      font_family: family || null,
      source,
    });
  }
  return out;
}

export function slidePreferHbsTextOverlay(slide: Record<string, unknown>): boolean {
  if (slideOnScreenTextChars(slide) > 0) return true;
  const blocks = parseMimicTextBlocks(slide.text_blocks);
  return blocks.some((b) => b.text.length > 0);
}

export function textPlacementFromSlide(slide: Record<string, unknown> | null): string {
  if (!slide) return "";
  const typography = asRecord(slide.typography);
  const placement = String(typography?.text_placement ?? "").trim().toLowerCase();
  if (placement) return placement;

  const blocks = parseMimicTextBlocks(slide.text_blocks);
  if (blocks.length === 0) return "";

  const centers = blocks.map((b) => b.y + b.h / 2);
  const avg = centers.reduce((a, c) => a + c, 0) / centers.length;
  if (avg >= 0.62) return "bottom band";
  if (avg <= 0.38) return "top band";
  return "center band";
}

export function buildArtOnlySafeZoneHint(slide: Record<string, unknown> | null | undefined): string {
  if (!slide) return "";
  const blocks = parseMimicTextBlocks(slide.text_blocks);
  if (blocks.length === 0) return "";

  const zones = blocks.map((b) => ({
    left: Math.max(0, Math.min(100, Math.round(b.x * 100))),
    top: Math.max(0, Math.min(100, Math.round(b.y * 100))),
    right: Math.max(0, Math.min(100, Math.round((b.x + b.w) * 100))),
    bottom: Math.max(0, Math.min(100, Math.round((b.y + b.h) * 100))),
  }));

  const hints = zones.map(
    (z) =>
      `${z.left}–${z.right}% width × ${z.top}–${z.bottom}% height`
  );

  return (
    "Reserve smooth low-detail backdrop zones where HTML overlay copy will sit (match these layout regions): " +
    `${hints.join("; ")}. Do not place faces, busy texture, or high-contrast detail inside those rectangles.`
  );
}

/** Fixed carousel render canvas — must match services/renderer (1080×1350). */
export const CAROUSEL_RENDER_WIDTH_PX = 1080;
export const CAROUSEL_RENDER_HEIGHT_PX = 1350;

/** Default on-canvas font when OCR/ref size is missing (review + Puppeteer). */
export const MIMIC_DOCAI_DEFAULT_FONT_SIZE_PX = 50;
/** Minimum shrink-to-fit floor for mimic Document AI overlays (review + Puppeteer). */
export const MIMIC_DOCAI_MIN_FONT_SIZE_PX = 24;
/** Default font for project / reference Instagram handle overlays. */
export const MIMIC_DOCAI_HANDLE_FONT_SIZE_PX = 25;

/** True when a layer carries the project handle or occupies a handle OCR slot. */
export function isMimicDocAiHandleLayer(
  role: string | null | undefined,
  text: string,
  projectHandle?: string | null
): boolean {
  const t = String(text ?? "").trim();
  if (isHandleTextBlock(role ?? null, t)) return true;
  if (looksLikeInstagramHandleText(t)) return true;
  const project = projectHandle ? formatInstagramHandleForCta(projectHandle) : "";
  if (project && formatInstagramHandleForCta(t) === project) return true;
  return false;
}
/** Target body size on 1080px canvas when white highlight backing is enabled. */
export const MIMIC_DOCAI_TEXT_BACK_BODY_FONT_PX = 50;
/** Boost applied to reference OCR font sizes for readable meme-trait overlays. */
export const MIMIC_DOCAI_TEXT_BACK_FONT_SCALE = 1.22;
/** Minimum readable size for full-bleed white-backed trait boxes (Puppeteer must not go below). */
export const MIMIC_DOCAI_TEXT_BACK_MIN_FONT_PX = 24;

/** Default ink for mimic Document AI overlays (readable on light plates + white backing). */
export const MIMIC_DOCAI_DEFAULT_TEXT_COLOR = "#000000";

/** Default semi-opaque pad behind mimic text layers (full-bleed / text-back mode). */
export const MIMIC_DEFAULT_TEXT_BACKING_BACKGROUND = "rgba(255,255,255,0.92)";

const MIMIC_TEXT_BACKING_ALPHA = 0.92;

/** Normalize reviewer/API color (#RRGGBB, #RRGGBBAA, rgba) for CSS `background`. */
export function formatMimicTextBackingBackground(color?: string | null): string {
  const raw = String(color ?? "").trim();
  if (!raw) return MIMIC_DEFAULT_TEXT_BACKING_BACKGROUND;
  if (/^rgba?\(/i.test(raw)) return raw;
  const hex = raw.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${MIMIC_TEXT_BACKING_ALPHA})`;
  }
  if (/^[0-9a-f]{8}$/i.test(hex)) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const a = parseInt(hex.slice(6, 8), 16) / 255;
    return `rgba(${r},${g},${b},${Number(a.toFixed(3))})`;
  }
  return MIMIC_DEFAULT_TEXT_BACKING_BACKGROUND;
}

/** Hex #RRGGBB for `<input type="color">` from a stored backing color. */
export function mimicTextBackingColorToHex(color?: string | null): string {
  const raw = String(color ?? "").trim();
  if (!raw) return "#ffffff";
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  const hex = raw.replace(/^#/, "");
  if (/^[0-9a-f]{6}$/i.test(hex)) return `#${hex.toLowerCase()}`;
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(0, 6).toLowerCase()}`;
  const rgba = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (rgba) {
    const toHex = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
    return `#${toHex(Number(rgba[1]))}${toHex(Number(rgba[2]))}${toHex(Number(rgba[3]))}`;
  }
  return "#ffffff";
}

function clampDocAiFontSizePx(size: number): number {
  if (!Number.isFinite(size)) return MIMIC_DOCAI_DEFAULT_FONT_SIZE_PX;
  return Math.max(MIMIC_DOCAI_MIN_FONT_SIZE_PX, Math.min(512, Math.round(size)));
}

export function clampDocAiTextBackFontSizePx(size: number): number {
  if (!Number.isFinite(size)) return MIMIC_DOCAI_TEXT_BACK_BODY_FONT_PX;
  return Math.max(MIMIC_DOCAI_TEXT_BACK_MIN_FONT_PX, Math.min(120, Math.round(size)));
}

/** Resolve layer color — always black for mimic reprint (OCR ink is often wrong on generated plates). */
export function resolveMimicDocAiLayerColor(_opts?: {
  refColor?: string | null;
  textBacking?: boolean;
}): string {
  return MIMIC_DOCAI_DEFAULT_TEXT_COLOR;
}

/** Keep glyphs inside the plate safe area (OCR boxes often touch image edges). */
export const MIMIC_DOCAI_CANVAS_SAFE_MARGIN_PX = 32;

/**
 * Full-bleed subject safe zone (normalized 0–1) — keep trait copy out of the center
 * where characters / focal art usually sit.
 */
export const MIMIC_FULL_BLEED_SUBJECT_ZONE = { x: 0.22, y: 0.26, w: 0.56, h: 0.48 };

export function bboxIntersectsFullBleedSubjectZone(
  bbox: { x: number; y: number; w: number; h: number },
  gap = 0.01
): boolean {
  const z = MIMIC_FULL_BLEED_SUBJECT_ZONE;
  const zx = z.x - gap;
  const zy = z.y - gap;
  const zw = z.w + gap * 2;
  const zh = z.h + gap * 2;
  return bbox.x < zx + zw && bbox.x + bbox.w > zx && bbox.y < zy + zh && bbox.y + bbox.h > zy;
}

export function docAiLayerSkipsCenterAvoid(ref: MimicTextBlock & { ref_text: string }, bucket: string): boolean {
  if (isPreserveReferenceDecorText(ref.ref_text, ref)) return true;
  if (isHandleTextBlock(ref.role, ref.ref_text) || looksLikeInstagramHandleText(ref.ref_text)) return true;
  if (bucket === "cta") return true;
  if (bucket === "headline" && ref.y < 0.18) return true;
  if (ref.y + ref.h > 0.86) return true;
  return false;
}

/** Push OCR bbox to the nearest quadrant outside the subject zone. */
export function nudgeBBoxAwayFromFullBleedSubjectZone(bbox: {
  x: number;
  y: number;
  w: number;
  h: number;
}): { x: number; y: number; w: number; h: number } {
  if (!bboxIntersectsFullBleedSubjectZone(bbox)) return bbox;

  const z = MIMIC_FULL_BLEED_SUBJECT_ZONE;
  const gap = 0.02;
  const cx = bbox.x + bbox.w / 2;
  const cy = bbox.y + bbox.h / 2;
  const zcx = z.x + z.w / 2;
  const zcy = z.y + z.h / 2;
  let { x, y, w, h } = bbox;

  if (cx <= zcx) {
    x = Math.max(0.02, z.x - w - gap);
  } else {
    x = Math.min(0.98 - w, z.x + z.w + gap);
  }
  if (cy <= zcy) {
    y = Math.max(0.02, z.y - h - gap);
  } else {
    y = Math.min(0.98 - h, z.y + z.h + gap);
  }

  x = Math.max(0.02, Math.min(0.98 - w, x));
  y = Math.max(0.02, Math.min(0.98 - h, y));
  return { x, y, w, h };
}

const CANVAS_HEIGHT = CAROUSEL_RENDER_HEIGHT_PX;

const HEADLINE_TIER_PX: Record<string, number> = {
  xs: 44,
  sm: 54,
  md: 68,
  lg: 80,
  xl: 92,
};

function aestheticSlideRecordsFromGuideline(vg: Record<string, unknown>): Record<string, unknown>[] {
  const aes =
    vg.aesthetic_analysis_json && typeof vg.aesthetic_analysis_json === "object" && !Array.isArray(vg.aesthetic_analysis_json)
      ? (vg.aesthetic_analysis_json as Record<string, unknown>)
      : vg;
  const slides = aes.slides;
  if (!Array.isArray(slides)) return [];
  return slides.map((raw) => asRecord(raw)).filter((x): x is Record<string, unknown> => x != null);
}

/** Nemotron slide index for vision rows (may differ from 1-based output index after promo/video drops). */
export function guidelineSlideIndexForMimicOutput(
  mimic: Partial<Pick<MimicPayloadV1, "reference_items" | "slide_plans">>,
  outputSlideIndex1Based: number
): number {
  const plan = mimic.slide_plans?.find((p) => p.slide_index === outputSlideIndex1Based);
  if (
    plan?.source_slide_index != null &&
    Number.isFinite(plan.source_slide_index) &&
    plan.source_slide_index > 0
  ) {
    return plan.source_slide_index;
  }

  const items = mimic.reference_items ?? [];
  if (items.length === 0) return outputSlideIndex1Based;

  const refIdx = plan?.reference_index ?? outputSlideIndex1Based;

  let item = items[outputSlideIndex1Based - 1] ?? null;
  if (plan?.reference_index != null) {
    item =
      items.find((r) => r.index === refIdx) ??
      (refIdx >= 1 && refIdx <= items.length ? items[refIdx - 1] : undefined) ??
      item;
  }

  const src = item?.source_slide_index;
  if (src != null && Number.isFinite(src) && src > 0) return src;
  return outputSlideIndex1Based;
}

function visualGuidelineSlideList(
  visualGuideline: Record<string, unknown> | null | undefined
): Record<string, unknown>[] {
  const vg = visualGuideline ?? {};
  const fromPackage = Array.isArray(vg.slides) ? vg.slides : [];
  const parsed = fromPackage
    .map((raw) => asRecord(raw))
    .filter((x): x is Record<string, unknown> => x != null);
  if (parsed.length > 0) return parsed;
  return aestheticSlideRecordsFromGuideline(vg);
}

/** Resolve reference OCR geometry when output index and archive source index diverge. */
function resolveRefSlideWithLayoutBlocksForMimic(
  mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans">,
  slideIndex1Based: number,
  _opts?: { totalSlides?: number }
): { refSlide: Record<string, unknown>; layoutBlocks: DocAiLayoutBlock[] } | null {
  const vg = mimic.visual_guideline ?? {};
  const lookupIdx = guidelineSlideIndexForMimicOutput(mimic, slideIndex1Based);
  let refSlide = slideGuidelineRecord(vg, slideIndex1Based, lookupIdx);
  if (refSlide) {
    const layoutBlocks = layoutBlocksForMimicSlideRender(refSlide);
    if (layoutBlocks.length > 0) return { refSlide, layoutBlocks };
  }

  const plan = mimic.slide_plans?.find((p) => p.slide_index === slideIndex1Based);
  const tryIndices = new Set<number>();
  if (lookupIdx > 0) tryIndices.add(lookupIdx);
  if (plan?.reference_index != null && plan.reference_index > 0) tryIndices.add(plan.reference_index);
  if (plan?.source_slide_index != null && plan.source_slide_index > 0) {
    tryIndices.add(plan.source_slide_index);
  }
  for (const item of mimic.reference_items ?? []) {
    if (item.index > 0) tryIndices.add(item.index);
    if (item.source_slide_index != null && item.source_slide_index > 0) {
      tryIndices.add(item.source_slide_index);
    }
  }

  for (const idx of tryIndices) {
    const candidate = slideGuidelineRecord(vg, slideIndex1Based, idx);
    if (!candidate) continue;
    const layoutBlocks = layoutBlocksForMimicSlideRender(candidate);
    if (layoutBlocks.length > 0) return { refSlide: candidate, layoutBlocks };
  }

  return refSlide ? { refSlide, layoutBlocks: [] } : null;
}

/** Last-resort editor/reprint boxes from reviewer copy when reference OCR lookup misses geometry. */
function buildSyntheticDocAiLayersFromLlmCopy(
  llmSlide: Record<string, unknown>,
  theme: { ink: string; body: string } | undefined,
  opts: { projectHandle?: string | null; textBacking: boolean; textBackingColor?: string | null; avoidCenterSubject?: boolean }
): MimicDocAiRenderTextLayer[] {
  const parsed = parseMimicTextBlocks(llmSlide.text_blocks);
  const lines = orderedLlmTextBlockLines(llmSlide);
  if (parsed.length === 0 && lines.length === 0) return [];

  const layers: MimicDocAiRenderTextLayer[] = [];
  const sources: DocAiLayoutBlock[] =
    parsed.length > 0
      ? parsed.map((b) => ({ ...b, ref_text: b.text }))
      : lines.map((text, i) => ({
          text,
          ref_text: text,
          role: i === 0 ? "headline" : looksLikeInstagramHandleText(text) ? "handle" : "body",
          x: 0.1,
          y: clamp01(0.1 + i * 0.16),
          w: 0.8,
          h: 0.1,
          align: "left" as const,
          font_size_px: null,
          font_weight: null,
          color_hex: null,
          font_family: null,
          source: "reviewer" as const,
        }));

  const projectHandle = opts.projectHandle ? formatInstagramHandleForCta(opts.projectHandle) : null;
  for (const ref of sources) {
    let text = ref.ref_text;
    if (projectHandle && (isHandleTextBlock(ref.role, text) || looksLikeInstagramHandleText(text))) {
      text = projectHandle;
    }
    pushDocAiRenderLayer(layers, ref, text, ref, {
      textBacking: opts.textBacking,
      textBackingColor: opts.textBackingColor,
      theme,
      forceMultiLine: text.includes("\n") || ref.ref_text.length > 48,
      avoidCenterSubject: opts.avoidCenterSubject,
      projectHandle: opts.projectHandle ?? null,
    });
  }
  return layers;
}

function slideGuidelineRecord(
  visualGuideline: Record<string, unknown> | null | undefined,
  slideIndex1Based: number,
  lookupSlideIndex?: number
): Record<string, unknown> | null {
  const lookupIdx = lookupSlideIndex ?? slideIndex1Based;
  const vg = visualGuideline ?? {};
  const fromPackage = Array.isArray(vg.slides) ? vg.slides : [];
  if (fromPackage.length > 0) {
    const match =
      fromPackage
        .map((raw) => asRecord(raw))
        .find((s) => s && Number(s.slide_index) === lookupIdx) ??
      asRecord(fromPackage[lookupIdx - 1]);
    if (match) return match;
  }
  const aesSlides = aestheticSlideRecordsFromGuideline(vg);
  if (aesSlides.length === 0) return null;
  return (
    aesSlides.find((s) => Number(s.slide_index) === lookupIdx) ??
    aesSlides[lookupIdx - 1] ??
    null
  );
}

function textBlockRegionForLayout(blocks: MimicTextBlock[]): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const xs = blocks.map((b) => b.x);
  const ys = blocks.map((b) => b.y);
  const x2 = blocks.map((b) => b.x + b.w);
  const y2 = blocks.map((b) => b.y + b.h);
  const pad = 0.02;
  const x0 = Math.min(...xs);
  const y0 = Math.min(...ys);
  const x1 = Math.max(...x2);
  const y1 = Math.max(...y2);
  return {
    x: clamp01(x0 - pad),
    y: clamp01(y0 - pad),
    w: clamp01(x1 - x0 + 2 * pad),
    h: clamp01(y1 - y0 + 2 * pad),
  };
}

/** Map Nemotron normalized text block boxes → flex or absolute overlay region. */
export function layoutAnchorFromTextBlocks(blocks: MimicTextBlock[]): MimicSlideLayoutPatch & {
  mimic_use_block_positioning?: boolean;
  mimic_text_x?: number;
  mimic_text_y?: number;
  mimic_text_w?: number;
} {
  const region = textBlockRegionForLayout(blocks);
  const title =
    blocks.find((b) => /title|headline|hook|cover/.test(b.role ?? "")) ?? blocks[0] ?? null;
  const anchorY = title ? title.y + title.h / 2 : region.y + region.h / 2;
  const anchorX = title ? title.x + title.w / 2 : region.x + region.w / 2;

  let mimic_page_justify = "flex-start";
  if (anchorY >= 0.58) mimic_page_justify = "flex-end";
  else if (anchorY >= 0.36 && anchorY <= 0.58) mimic_page_justify = "center";

  let mimic_text_align = "left";
  let mimic_page_align = "stretch";
  const alignHint = (title?.align ?? "").toLowerCase();
  if (alignHint === "center" || (anchorX >= 0.38 && anchorX <= 0.62)) {
    mimic_text_align = "center";
    mimic_page_align = "center";
  } else if (alignHint === "right" || anchorX >= 0.64) {
    mimic_text_align = "right";
    mimic_page_align = "flex-end";
  }

  return {
    mimic_page_justify,
    mimic_page_align,
    mimic_text_align,
    mimic_use_block_positioning: true,
    mimic_text_x: region.x,
    mimic_text_y: region.y,
    mimic_text_w: region.w,
  };
}

function deckHaystack(visualGuideline: Record<string, unknown> | null | undefined): string {
  const vg = visualGuideline ?? {};
  const parts: string[] = [];
  const dvs = asRecord(vg.deck_visual_system);
  if (dvs) {
    for (const key of ["repeated_template", "overall_aesthetic", "motion_or_energy"] as const) {
      const t = String(dvs[key] ?? "").trim();
      if (t) parts.push(t.toLowerCase());
    }
  }
  const consistency = String(vg.visual_consistency ?? "").trim();
  if (consistency) parts.push(consistency.toLowerCase());
  const blueprint = asRecord(vg.replication_blueprint);
  const steps = Array.isArray(blueprint?.steps_to_remake) ? blueprint!.steps_to_remake : [];
  for (const step of steps) {
    const t = String(step ?? "").trim();
    if (t) parts.push(t.toLowerCase());
  }
  return parts.join(" ");
}

export function isDarkCelestialDeck(visualGuideline: Record<string, unknown> | null | undefined): boolean {
  return isDarkVisualDeck(visualGuideline);
}

const DARK_DECK_RE =
  /\bdark\b|celestial|moody|noir|night|moon|eclipse|silhouette|monochrom|black\s*and\s*white|\bb&w\b|shadowy|dramatic|mysterious|midnight|low[\s-]?key|high[\s-]?contrast/;

export function hexRelativeLuminance(hex: string): number | null {
  const h = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const r = lin(parseInt(h.slice(0, 2), 16) / 255);
  const g = lin(parseInt(h.slice(2, 4), 16) / 255);
  const b = lin(parseInt(h.slice(4, 6), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function isDarkHexColor(hex: string): boolean {
  const lum = hexRelativeLuminance(hex);
  return lum != null && lum < 0.38;
}

export function isLightHexColor(hex: string): boolean {
  const lum = hexRelativeLuminance(hex);
  return lum != null && lum > 0.62;
}

/** Dark photo / moody decks — zodiac silhouettes, celestial, B&W reference carousels, etc. */
export function isDarkVisualDeck(visualGuideline: Record<string, unknown> | null | undefined): boolean {
  const vg = visualGuideline ?? {};
  if (DARK_DECK_RE.test(deckHaystack(vg))) return true;
  const slides = Array.isArray(vg.slides) ? vg.slides : [];
  for (const raw of slides) {
    const slide = asRecord(raw);
    const ct = asRecord(slide?.color_tokens);
    const bg = typeof ct?.background === "string" ? ct.background.trim() : "";
    if (bg && isDarkHexColor(bg)) return true;
  }
  return false;
}

export interface MimicCarouselTheme {
  paper: string;
  ink: string;
  body: string;
  text_shadow_headline: string;
  text_shadow_body: string;
}

export const MIMIC_LIGHT_ON_DARK_THEME: MimicCarouselTheme = {
  paper: "#0c0c0e",
  ink: "#f5f5f7",
  body: "#e8e8ed",
  text_shadow_headline: "0 2px 24px rgba(0,0,0,0.92), 0 0 2px rgba(0,0,0,0.8)",
  text_shadow_body: "0 1px 16px rgba(0,0,0,0.88), 0 0 1px rgba(0,0,0,0.7)",
};

export const MIMIC_DARK_ON_LIGHT_THEME: MimicCarouselTheme = {
  paper: "#fffef9",
  ink: "#1c1c1e",
  body: "#3a3a3c",
  text_shadow_headline: "0 1px 12px rgba(255,254,249,0.85)",
  text_shadow_body: "0 1px 10px rgba(255,254,249,0.8)",
};

function colorTokensFromSlide(slide: Record<string, unknown> | null): {
  background: string | null;
  primary_text: string | null;
  accent: string[] | null;
} | null {
  const ct = asRecord(slide?.color_tokens);
  if (!ct) return null;
  return {
    background: typeof ct.background === "string" ? ct.background : null,
    primary_text: typeof ct.primary_text === "string" ? ct.primary_text : null,
    accent: Array.isArray(ct.accent) ? ct.accent.map(String) : null,
  };
}

/**
 * Readable text palette for mimic `template_bg` compositing.
 * Defaults to light-on-dark when vision is ambiguous — Qwen plates are usually photo/dark frames.
 */
export function inferMimicCarouselTheme(
  visualGuideline: Record<string, unknown> | null | undefined
): MimicCarouselTheme {
  const vg = visualGuideline ?? {};
  const slides = Array.isArray(vg.slides) ? vg.slides : [];
  const hay = deckHaystack(vg);
  const lightPaperDeck = /cream|pastel|paper|white\s*background|light\s*background|off[\s-]?white|beige|parchment/.test(
    hay
  );

  let bgLum: number | null = null;
  let textLum: number | null = null;
  let paperHex = "";
  let inkHex = "";

  for (const raw of slides) {
    const slide = asRecord(raw);
    const tokens = colorTokensFromSlide(slide);
    if (!tokens) continue;
    const bg = (tokens.background ?? "").trim();
    const ink = (tokens.primary_text ?? "").trim();
    const accent = tokens.accent?.find((c) => /^#[0-9a-fA-F]{6}$/.test(c.trim())) ?? "";
    if (bg && /^#[0-9a-fA-F]{6}$/.test(bg)) {
      paperHex = bg;
      bgLum = hexRelativeLuminance(bg);
    }
    const textCandidate = ink || accent;
    if (textCandidate && /^#[0-9a-fA-F]{6}$/.test(textCandidate)) {
      inkHex = textCandidate;
      textLum = hexRelativeLuminance(textCandidate);
    }
    if (bgLum != null || textLum != null) break;
  }

  const darkDeck =
    isDarkVisualDeck(vg) || (bgLum != null && bgLum < 0.42) || (!lightPaperDeck && bgLum == null);

  if (!darkDeck && lightPaperDeck && bgLum != null && bgLum > 0.62) {
    return {
      ...MIMIC_DARK_ON_LIGHT_THEME,
      paper: paperHex || MIMIC_DARK_ON_LIGHT_THEME.paper,
      ink: inkHex && textLum != null && textLum < 0.45 ? inkHex : MIMIC_DARK_ON_LIGHT_THEME.ink,
      body: inkHex && textLum != null && textLum < 0.45 ? inkHex : MIMIC_DARK_ON_LIGHT_THEME.body,
    };
  }

  if (bgLum != null && textLum != null && bgLum < 0.42 && textLum < 0.42) {
    return { ...MIMIC_LIGHT_ON_DARK_THEME, paper: paperHex || MIMIC_LIGHT_ON_DARK_THEME.paper };
  }

  if (darkDeck) {
    const useVisionLightText = textLum != null && textLum > 0.62;
    return {
      ...MIMIC_LIGHT_ON_DARK_THEME,
      paper: paperHex || MIMIC_LIGHT_ON_DARK_THEME.paper,
      ink: useVisionLightText ? inkHex : MIMIC_LIGHT_ON_DARK_THEME.ink,
      body: useVisionLightText ? inkHex : MIMIC_LIGHT_ON_DARK_THEME.body,
    };
  }

  return MIMIC_DARK_ON_LIGHT_THEME;
}

export interface MimicSlideThemePatch {
  carousel_paper?: string;
  carousel_ink?: string;
  carousel_body?: string;
  carousel_text_shadow_headline?: string;
  carousel_text_shadow_body?: string;
}

/** Runtime palette override — injected by renderer after template compile (fixes contrast on Qwen plates). */
export function pickProjectBrandPaletteColors(brandAssets: ProjectBrandAssetRow[]): string[] {
  const palette = brandAssets.find((a) => a.kind === "palette");
  const colors = palette?.metadata_json?.colors;
  if (!Array.isArray(colors)) return [];
  return colors
    .map((c) => String(c ?? "").trim())
    .filter((c) => /^#[0-9a-fA-F]{6}$/.test(c));
}

/** Prefer project brand palette for slide paper/ink when vision tokens are missing. */
export function mergeProjectBrandPaletteIntoThemePatch(
  patch: MimicSlideThemePatch,
  brandAssets: ProjectBrandAssetRow[]
): MimicSlideThemePatch {
  const colors = pickProjectBrandPaletteColors(brandAssets);
  if (colors.length === 0) return patch;
  const paper = colors[0]!;
  const ink = colors.length > 1 ? colors[1]! : patch.carousel_ink;
  const body = colors.length > 2 ? colors[2]! : ink ?? patch.carousel_body;
  return {
    ...patch,
    carousel_paper: patch.carousel_paper && patch.carousel_paper !== "#fffef9" ? patch.carousel_paper : paper,
    carousel_ink: patch.carousel_ink ?? ink,
    carousel_body: patch.carousel_body ?? body,
  };
}

export function mimicSlideThemePatch(
  mimic: Pick<MimicPayloadV1, "visual_guideline">,
  brandAssets?: ProjectBrandAssetRow[],
  opts?: { useProjectBrandPalette?: boolean }
): MimicSlideThemePatch {
  const theme = inferMimicCarouselTheme(mimic.visual_guideline);
  const base: MimicSlideThemePatch = {
    carousel_paper: theme.paper,
    carousel_ink: theme.ink,
    carousel_body: theme.body,
    carousel_text_shadow_headline: theme.text_shadow_headline,
    carousel_text_shadow_body: theme.text_shadow_body,
  };
  if (opts?.useProjectBrandPalette && brandAssets?.length) {
    return mergeProjectBrandPaletteIntoThemePatch(base, brandAssets);
  }
  return base;
}

export function parseRelativeScaleHeadlinePx(raw: unknown, canvasHeight = CANVAS_HEIGHT): number | null {
  const s = String(raw ?? "").toLowerCase();
  if (!s.trim()) return null;
  const tierMatch = s.match(/\b(xs|sm|md|lg|xl)\b/);
  if (tierMatch) return HEADLINE_TIER_PX[tierMatch[1]!] ?? null;
  const pctMatch = s.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of\s*)?(?:slide|frame|canvas)/i);
  if (pctMatch) {
    const pct = Number(pctMatch[1]) / 100;
    if (Number.isFinite(pct) && pct > 0) {
      return Math.round(Math.min(120, Math.max(32, canvasHeight * pct)));
    }
  }
  return null;
}

export function parseBodyFontPxFromTypography(typography: Record<string, unknown>, headlinePx: number): number {
  const bodyGuess = String(typography.body_guess ?? "").toLowerCase();
  const rel = String(typography.relative_scale ?? "").toLowerCase();
  const combined = `${bodyGuess} ${rel}`;
  const tierMatch = combined.match(/\bbody[^a-z]*(xs|sm|md|lg|xl)\b|\b(xs|sm|md|lg|xl)\b[^a-z]*body/);
  if (tierMatch) {
    const tier = tierMatch[1] ?? tierMatch[2];
    const bodyTiers: Record<string, number> = { xs: 28, sm: 32, md: 38, lg: 44, xl: 50 };
    if (tier && bodyTiers[tier]) return bodyTiers[tier]!;
  }
  if (/fine\s*print|caption|small/.test(combined)) return 30;
  return Math.max(28, Math.min(48, Math.round(headlinePx * 0.55)));
}

export interface MimicSlideLayoutPatch {
  mimic_page_justify: string;
  mimic_page_align: string;
  mimic_text_align: string;
}

/** Map vision `text_placement` + deck cues → flex/text alignment for carousel_mimic_bg.hbs. */
export function mimicSlideLayoutPatch(
  visualGuideline: Record<string, unknown> | null | undefined,
  slideIndex1Based: number,
  lookupSlideIndex?: number
): MimicSlideLayoutPatch & {
  mimic_use_block_positioning?: boolean;
  mimic_text_x?: number;
  mimic_text_y?: number;
  mimic_text_w?: number;
} {
  const slide = slideGuidelineRecord(visualGuideline, slideIndex1Based, lookupSlideIndex);
  const blocks = slide ? parseMimicTextBlocks(slide.text_blocks) : [];
  if (blocks.length > 0) {
    return layoutAnchorFromTextBlocks(blocks);
  }

  const placement = slide ? textPlacementFromSlide(slide).toLowerCase() : "";
  const deck = deckHaystack(visualGuideline);
  const deckCentered = /centered text|center stack|text centrally|text over/.test(deck);

  if (/bottom|caption|footer|lower/.test(placement)) {
    return {
      mimic_page_justify: "flex-end",
      mimic_page_align: deckCentered ? "center" : "stretch",
      mimic_text_align: deckCentered ? "center" : "left",
    };
  }
  if (/top|upper|header/.test(placement)) {
    return {
      mimic_page_justify: "flex-start",
      mimic_page_align: deckCentered ? "center" : "stretch",
      mimic_text_align: deckCentered ? "center" : "left",
    };
  }
  if (/center|middle|band|stack/.test(placement) || deckCentered) {
    return {
      mimic_page_justify: "center",
      mimic_page_align: "center",
      mimic_text_align: "center",
    };
  }
  return {
    mimic_page_justify: "flex-start",
    mimic_page_align: "stretch",
    mimic_text_align: "left",
  };
}

export interface MimicSlideTypographyPatch {
  carousel_headline_font_px?: number;
  carousel_body_font_px?: number;
  carousel_cta_font_px?: number;
  mimic_page_justify?: string;
  mimic_page_align?: string;
  mimic_text_align?: string;
  /** When true, HBS places copy at Nemotron text_blocks region (not default top stack). */
  mimic_use_block_positioning?: boolean;
  mimic_text_x?: number;
  mimic_text_y?: number;
  mimic_text_w?: number;
}

/**
 * Derive reviewer/renderer typography + layout from top-performer vision analysis.
 * Applied per slide at render time (after Qwen background plates, before HBS composite).
 */
export function mimicSlideTypographyPatch(
  mimic: Pick<MimicPayloadV1, "visual_guideline"> &
    Partial<Pick<MimicPayloadV1, "reference_items" | "slide_plans">>,
  slideIndex1Based: number,
  totalSlides: number,
  opts?: { skipIfReviewerSet?: Record<string, unknown> }
): MimicSlideTypographyPatch {
  const vg = mimic.visual_guideline ?? {};
  const lookupIdx = guidelineSlideIndexForMimicOutput(mimic, slideIndex1Based);
  const slide = slideGuidelineRecord(vg, slideIndex1Based, lookupIdx);
  const typography = asRecord(slide?.typography);
  const layout = mimicSlideLayoutPatch(vg, slideIndex1Based, lookupIdx);
  const isCta = totalSlides > 1 && slideIndex1Based === totalSlides;
  const isCover = slideIndex1Based === 1;

  const blocks = slide ? parseMimicTextBlocks(slide.text_blocks) : [];
  const titleBlock = blocks.find((b) => /title|headline|hook/.test(b.role ?? "")) ?? blocks[0];
  const bodyBlock =
    blocks.find((b) => /body|subtitle|caption|paragraph/.test(b.role ?? "")) ??
    blocks.find((b) => b !== titleBlock);

  const headlineFromPx = Number(typography?.font_size_px_headline);
  const bodyFromPx = Number(typography?.font_size_px_body);

  const headlinePx =
    (titleBlock?.font_size_px != null ? titleBlock.font_size_px : null) ??
    (Number.isFinite(headlineFromPx) && headlineFromPx > 0 ? Math.round(headlineFromPx) : null) ??
    parseRelativeScaleHeadlinePx(typography?.relative_scale) ??
    parseRelativeScaleHeadlinePx(typography?.headline_guess) ??
    (isCta ? 72 : 68);

  const bodyPx =
    (bodyBlock?.font_size_px != null ? bodyBlock.font_size_px : null) ??
    (Number.isFinite(bodyFromPx) && bodyFromPx > 0 ? Math.round(bodyFromPx) : null) ??
    (typography ? parseBodyFontPxFromTypography(typography, headlinePx) : 38);

  const out: MimicSlideTypographyPatch = {
    ...layout,
    carousel_headline_font_px: isCover || !isCta ? headlinePx : undefined,
    carousel_body_font_px: !isCta ? bodyPx : undefined,
    carousel_cta_font_px: isCta ? headlinePx : undefined,
  };

  const skip = opts?.skipIfReviewerSet ?? {};
  for (const key of [
    "carousel_headline_font_px",
    "carousel_body_font_px",
    "carousel_cta_font_px",
    "mimic_page_justify",
    "mimic_page_align",
    "mimic_text_align",
    "mimic_use_block_positioning",
    "mimic_text_x",
    "mimic_text_y",
    "mimic_text_w",
  ] as const) {
    if (skip[key] != null && String(skip[key]).trim() !== "") {
      delete out[key];
    }
  }

  return out;
}

/** True when reference slides carry positioned text geometry for HTML/CSS overlay. */
export function mimicPayloadHasDocAiTextLayout(
  mimic: Pick<MimicPayloadV1, "visual_guideline">
): boolean {
  const vg = mimic.visual_guideline ?? {};
  const fromPackage = Array.isArray(vg.slides) ? vg.slides : [];
  const aesSlides = aestheticSlideRecordsFromGuideline(vg);
  const slides = fromPackage.length > 0 ? fromPackage : aesSlides;
  for (const raw of slides) {
    const slide = asRecord(raw);
    if (!slide) continue;
    if (slide.document_ai_ocr_v1) return true;
    if (parseMimicTextBlocks(slide.text_blocks).length > 0) return true;
  }
  return false;
}

export interface MimicDocAiRenderTextLayer {
  text: string;
  role: string;
  /** Normalized 0–1 (legacy consumers). */
  x_pct: number;
  y_pct: number;
  w_pct: number;
  h_pct: number;
  /** Absolute px on 1080×1350 render canvas. */
  x_px: number;
  y_px: number;
  w_px: number;
  h_px: number;
  layout_mode: "single_line" | "multi_line";
  layout_class: string;
  font_size_px: number | null;
  /** Document AI / Nemotron detected size on the reference slide. */
  ref_font_size_px: number | null;
  font_weight: number | null;
  color_hex: string | null;
  text_align: string;
  css_style: string;
  text_backing?: boolean;
  /** Source OCR norm bbox (for stack merge matching). */
  ref_x?: number;
  ref_y?: number;
  ref_w?: number;
  ref_h?: number;
  /** Top decor / handle — do not push away from center subject zone. */
  skip_center_avoid?: boolean;
}

function roleBucket(role: string | null): "headline" | "body" | "cta" | "other" {
  const r = (role ?? "").toLowerCase();
  if (/title|headline|hook|cover|kicker|subheadline/.test(r)) return "headline";
  if (/cta|handle/.test(r)) return "cta";
  if (/body|subtitle|caption|paragraph/.test(r)) return "body";
  return "other";
}

function webFontFamilyFromDetected(detected: string | null): string | null {
  if (!detected?.trim()) return null;
  const d = detected.trim().toUpperCase();
  if (d.includes("MONO")) return "ui-monospace, SFMono-Regular, Menlo, monospace";
  if (d.includes("SERIF") && !d.includes("SANS")) return "Georgia, 'Times New Roman', serif";
  if (d.includes("HAND") || d.includes("SCRIPT")) return "'Segoe Script', 'Brush Script MT', cursive";
  return "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
}

function cssFontWeight(raw: string | null): number | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  const n = Number(s);
  if (Number.isFinite(n) && n >= 100 && n <= 900) return Math.round(n / 100) * 100;
  if (s === "bold" || s === "700") return 700;
  if (s === "semibold" || s === "600") return 600;
  if (s === "medium" || s === "500") return 500;
  if (s === "regular" || s === "normal" || s === "400") return 400;
  return null;
}

function pct01(n: number): number {
  return Math.round(clamp01(n) * 10000) / 100;
}

function bboxNormToRenderPx(
  x: number,
  y: number,
  w: number,
  h: number,
  canvasW = CAROUSEL_RENDER_WIDTH_PX,
  canvasH = CAROUSEL_RENDER_HEIGHT_PX
): { x: number; y: number; w: number; h: number } {
  return {
    x: Math.round(clamp01(x) * canvasW),
    y: Math.round(clamp01(y) * canvasH),
    w: Math.max(1, Math.round(clamp01(w) * canvasW)),
    h: Math.max(1, Math.round(clamp01(h) * canvasH)),
  };
}

/** Map OCR norm bbox → render px with canvas safe margins and inner padding. */
export function docAiBBoxToRenderPx(
  x: number,
  y: number,
  w: number,
  h: number,
  opts?: { safeMarginPx?: number; innerPadPx?: number }
): { x: number; y: number; w: number; h: number } {
  const margin = opts?.safeMarginPx ?? MIMIC_DOCAI_CANVAS_SAFE_MARGIN_PX;
  const pad = opts?.innerPadPx ?? 4;
  const canvasW = CAROUSEL_RENDER_WIDTH_PX;
  const canvasH = CAROUSEL_RENDER_HEIGHT_PX;
  let px = bboxNormToRenderPx(x, y, w, h, canvasW, canvasH);

  px.x = Math.max(margin, px.x);
  px.y = Math.max(margin, px.y);
  const maxRight = canvasW - margin;
  const maxBottom = canvasH - margin;
  px.w = Math.max(12, Math.min(px.w, maxRight - px.x));
  px.h = Math.max(12, Math.min(px.h, maxBottom - px.y));

  if (px.w > pad * 4) {
    px.x += pad;
    px.w -= pad * 2;
  }
  if (px.h > pad * 4) {
    px.y += pad;
    px.h -= pad * 2;
  }
  return px;
}

type DocAiLayoutBlock = MimicTextBlock & { ref_text: string };

function normalizeOcrMatchText(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9+@#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function ocrTextMatchScore(blockText: string, ocrText: string): number {
  const a = normalizeOcrMatchText(blockText);
  const b = normalizeOcrMatchText(ocrText);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const ta = new Set(a.split(" ").filter(Boolean));
  const tb = new Set(b.split(" ").filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) {
    if (tb.has(t)) inter++;
  }
  return inter / Math.max(ta.size, tb.size);
}

function bboxFromOcrLayer(layer: Record<string, unknown>): { x: number; y: number; w: number; h: number } | null {
  const bbox = asRecord(layer.bbox_pct);
  if (
    bbox &&
    Number.isFinite(Number(bbox.x)) &&
    Number.isFinite(Number(bbox.y)) &&
    Number.isFinite(Number(bbox.w)) &&
    Number.isFinite(Number(bbox.h))
  ) {
    return {
      x: clamp01(Number(bbox.x)),
      y: clamp01(Number(bbox.y)),
      w: clamp01(Number(bbox.w)),
      h: clamp01(Number(bbox.h)),
    };
  }
  return null;
}

function mergeOcrLayerFieldsOntoBlock(block: MimicTextBlock, layer: Record<string, unknown>): DocAiLayoutBlock {
  const ocrText = String(layer.text ?? block.text ?? "").trim();
  const font = asRecord(layer.font);
  const fontPx = pickNum(font?.size_px);
  const ocrBox = bboxFromOcrLayer(layer);
  const box = ocrBox ?? { x: block.x, y: block.y, w: block.w, h: block.h };
  return {
    ...block,
    text: ocrText || block.text,
    ref_text: ocrText || block.text,
    x: box.x,
    y: box.y,
    w: box.w,
    h: box.h,
    align: String(layer.alignment ?? block.align ?? "").trim().toLowerCase() || block.align,
    font_size_px:
      fontPx != null && fontPx > 0 && fontPx < 400 ? Math.round(fontPx) : block.font_size_px,
    font_weight: font?.weight != null ? String(font.weight) : block.font_weight,
    color_hex:
      typeof font?.color_hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(font.color_hex)
        ? font.color_hex
        : block.color_hex,
    font_family:
      typeof font?.family_detected === "string" && font.family_detected.trim()
        ? font.family_detected.trim()
        : block.font_family,
    source: "document_ai",
  };
}

/** Match OCR text_layers to Nemotron text_blocks by text similarity — not array index. */
function mergeOcrLayersOntoLayoutBlocks(
  layoutBlocks: MimicTextBlock[],
  ocrLayers: unknown[]
): DocAiLayoutBlock[] {
  const used = new Set<number>();
  const minScore = 0.38;

  return layoutBlocks.map((block) => {
    let bestIdx = -1;
    let bestScore = minScore;
    for (let j = 0; j < ocrLayers.length; j++) {
      if (used.has(j)) continue;
      const layer = asRecord(ocrLayers[j]);
      if (!layer) continue;
      const score = ocrTextMatchScore(block.text, String(layer.text ?? ""));
      if (score > bestScore) {
        bestScore = score;
        bestIdx = j;
      }
    }
    if (bestIdx < 0) {
      return { ...block, ref_text: block.text };
    }
    used.add(bestIdx);
    return mergeOcrLayerFieldsOntoBlock(block, asRecord(ocrLayers[bestIdx])!);
  });
}

/** Prefer OCR `text_layers` geometry merged with Nemotron roles from `text_blocks`. */
function extractDocAiLayoutBlocks(refSlide: Record<string, unknown>): DocAiLayoutBlock[] {
  const parsed = parseMimicTextBlocks(refSlide.text_blocks);
  const docBlocks = parsed.filter((b) => b.source === "document_ai");
  const layoutBlocks = docBlocks.length > 0 ? docBlocks : parsed;
  if (layoutBlocks.length === 0) return [];

  const ocr = asRecord(refSlide.document_ai_ocr_v1);
  const ocrLayers = Array.isArray(ocr?.text_layers) ? ocr.text_layers : [];
  if (ocrLayers.length === 0) {
    return layoutBlocks.map((b) => ({ ...b, ref_text: b.text }));
  }

  return mergeOcrLayersOntoLayoutBlocks(layoutBlocks, ocrLayers);
}

function medianPositiveInt(nums: number[]): number | null {
  const sorted = nums.filter((n) => n > 0).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : Math.round((sorted[mid - 1]! + sorted[mid]!) / 2);
}

/** Even out per-line OCR font estimates inside one vertical stack (corner column). */
export function normalizeRefFontSizesPerStack(blocks: DocAiLayoutBlock[]): DocAiLayoutBlock[] {
  if (blocks.length < 2) return blocks;
  const stacks = groupDocAiBlocksIntoVerticalStacks(blocks);
  const medianByBlock = new WeakMap<DocAiLayoutBlock, number>();
  for (const stack of stacks) {
    if (stack.length < 2) continue;
    const sizes = stack
      .map((b) => b.font_size_px)
      .filter((n): n is number => n != null && n > 0);
    const med = medianPositiveInt(sizes);
    if (med == null) continue;
    const stackSize = clampDocAiFontSizePx(med);
    for (const b of stack) medianByBlock.set(b, stackSize);
  }
  return blocks.map((b) => {
    const med = medianByBlock.get(b);
    return med != null ? { ...b, font_size_px: med } : b;
  });
}

/** Blocks used for overlay mapping (filter chrome + collapse paragraphs). */
export function layoutBlocksForMimicSlideRender(
  refSlide: Record<string, unknown>
): DocAiLayoutBlock[] {
  return normalizeRefFontSizesPerStack(
    collapseParagraphCopyTargets(
      dropOcrContainerBoxes(filterOverlayLayoutBlocks(extractDocAiLayoutBlocks(refSlide)))
    )
  );
}

function isTemplateInstructionRefBlock(refText: string): boolean {
  return isTemplateInstructionText(refText);
}

/** Chat-mock decks split one title sentence across template line + "your {sign} friend". */
export function isChatMockTitlePair(
  upper: Pick<DocAiLayoutBlock, "ref_text" | "x" | "y" | "w" | "h">,
  lower: Pick<DocAiLayoutBlock, "ref_text" | "x" | "y" | "w" | "h">
): boolean {
  return isChatMockTitlePairBlocks(
    {
      text: upper.ref_text,
      role: null,
      x: upper.x,
      y: upper.y,
      w: upper.w,
      h: upper.h,
    },
    {
      text: lower.ref_text,
      role: null,
      x: lower.x,
      y: lower.y,
      w: lower.w,
      h: lower.h,
    }
  );
}

export { splitHeadlineForChatMockTitlePair } from "./mimic-copy-slots.js";

function docAiRefAcceptsDirectCopyLine(
  ref: Pick<DocAiLayoutBlock, "ref_text" | "role" | "x" | "y" | "w" | "h">
): boolean {
  if (isPreserveReferenceDecorText(ref.ref_text, ref)) return false;
  if (isHandleTextBlock(ref.role, ref.ref_text)) return false;
  if (isOverlayChromeReferenceText(ref.ref_text.trim(), roleBucket(ref.role))) return false;
  return true;
}

function isListicleMotherDecorText(text: string): boolean {
  return /^THE\s+.+\s+MOTHER$/i.test(String(text ?? "").trim());
}

function listicleDecorTitleFromLlmSlide(
  llmSlide: Record<string, unknown>,
  llmLines: { headline?: string | null },
  directLines: string[]
): string {
  if (Array.isArray(llmSlide.text_blocks)) {
    for (const item of llmSlide.text_blocks) {
      const rec = asRecord(item);
      if (!rec) continue;
      const role = String(rec.role ?? "").toLowerCase();
      const text = sanitizeMimicOverlayCopyText(rec.text);
      if ((role === "headline" || role === "title" || role === "hook") && text && isListicleMotherDecorText(text)) {
        return text;
      }
    }
  }
  const headline = llmLines.headline?.trim() || directLines[0]?.trim() || "";
  return headline && isListicleMotherDecorText(headline) ? headline : headline;
}

function isListicleMotherTemplateBgLayout(orderedRef: DocAiLayoutBlock[]): boolean {
  return (
    orderedRef.some((r) => isListicleMotherDecorText(r.ref_text)) &&
    orderedRef.some(
      (r) => isHandleTextBlock(r.role, r.ref_text) || looksLikeInstagramHandleText(r.ref_text)
    ) &&
    orderedRef.some((r) => docAiRefAcceptsDirectCopyLine(r))
  );
}

function bodyCopyForListicleMotherSlide(
  llmSlide: Record<string, unknown>,
  llmLines: LlmSlideCopyLines,
  directLines: string[]
): string {
  if (Array.isArray(llmSlide.text_blocks)) {
    for (const item of llmSlide.text_blocks) {
      const rec = asRecord(item);
      if (!rec) continue;
      if (String(rec.role ?? "").toLowerCase() !== "body") continue;
      const text = sanitizeMimicOverlayCopyText(rec.text);
      if (text && !looksLikeInstagramHandleText(text)) return text;
    }
  }
  const fromBodyLines = llmLines.bodyLines
    .filter((line) => line.trim() && !looksLikeInstagramHandleText(line))
    .join("\n")
    .trim();
  if (fromBodyLines) return fromBodyLines;
  for (const line of directLines) {
    const text = line.trim();
    if (!text || isListicleMotherDecorText(text) || looksLikeInstagramHandleText(text)) continue;
    return text;
  }
  return "";
}

function buildListicleMotherTemplateBgLayers(
  orderedRef: DocAiLayoutBlock[],
  llmSlide: Record<string, unknown>,
  llmLines: LlmSlideCopyLines,
  directLines: string[],
  theme: { ink: string; body: string } | undefined,
  opts: {
    projectHandle?: string | null;
    textBacking: boolean;
    textBackingColor?: string | null;
    avoidCenterSubject?: boolean;
  }
): MimicDocAiRenderTextLayer[] {
  const decorTitle = listicleDecorTitleFromLlmSlide(llmSlide, llmLines, directLines);
  const bodyText = bodyCopyForListicleMotherSlide(llmSlide, llmLines, directLines);
  const projectHandle = opts.projectHandle ? formatInstagramHandleForCta(opts.projectHandle) : null;
  const bodyRefs = orderedRef.filter((r) => docAiRefAcceptsDirectCopyLine(r));
  const bodyRef =
    bodyRefs.length > 0
      ? [...bodyRefs].sort((a, b) => b.w * b.h - a.w * a.h || a.y - b.y)[0]!
      : null;
  const layers: MimicDocAiRenderTextLayer[] = [];
  let bodyAssigned = false;

  for (const ref of orderedRef) {
    if (isListicleMotherDecorText(ref.ref_text)) {
      const text = decorTitle || ref.ref_text.trim();
      if (!text.trim()) continue;
      pushDocAiRenderLayer(layers, ref, text, ref, {
        textBacking: opts.textBacking,
        textBackingColor: opts.textBackingColor,
        theme,
        avoidCenterSubject: opts.avoidCenterSubject,
        projectHandle,
      });
      continue;
    }
    if (isHandleTextBlock(ref.role, ref.ref_text) || looksLikeInstagramHandleText(ref.ref_text)) {
      if (!projectHandle) continue;
      pushDocAiRenderLayer(layers, ref, projectHandle, ref, {
        textBacking: opts.textBacking,
        textBackingColor: opts.textBackingColor,
        theme,
        avoidCenterSubject: opts.avoidCenterSubject,
        projectHandle,
      });
      continue;
    }
    if (!bodyAssigned && bodyRef && ref === bodyRef && bodyText.trim()) {
      bodyAssigned = true;
      pushDocAiRenderLayer(layers, ref, bodyText, ref, {
        textBacking: opts.textBacking,
        textBackingColor: opts.textBackingColor,
        theme,
        avoidCenterSubject: opts.avoidCenterSubject,
        projectHandle,
      });
    }
  }

  layers.sort((a, b) => a.y_px - b.y_px || a.x_px - b.x_px);
  return normalizeDocAiRenderLayerFontSizes(layers, {
    textBacking: opts.textBacking,
    projectHandle: opts.projectHandle ?? null,
  });
}

function directMappingSkewsListicleBodySlots(
  orderedRef: DocAiLayoutBlock[],
  directLines: string[]
): boolean {
  if (directLines.length < 2) return false;
  const copyableCount = orderedRef.filter((r) => docAiRefAcceptsDirectCopyLine(r)).length;
  const hasHandle = orderedRef.some(
    (r) => isHandleTextBlock(r.role, r.ref_text) || looksLikeInstagramHandleText(r.ref_text)
  );
  const hasListicleDecor = orderedRef.some((r) => isListicleMotherDecorText(r.ref_text));
  return hasListicleDecor && hasHandle && copyableCount > 0 && directLines.length > copyableCount;
}

/** Map text_blocks[] lines onto OCR boxes by reading order (handles handle/decor gaps). */
export function buildDirectCopyAssignmentsByIndex(
  orderedRef: DocAiLayoutBlock[],
  directLines: string[]
): { useDirect: boolean; assignments: string[] } {
  const assignments = new Array<string>(orderedRef.length).fill("");
  if (directLines.length === 0) return { useDirect: false, assignments };

  const copyableIndices: number[] = [];
  for (let i = 0; i < orderedRef.length; i++) {
    if (docAiRefAcceptsDirectCopyLine(orderedRef[i]!)) copyableIndices.push(i);
  }

  if (directLines.length === orderedRef.length) {
    for (let i = 0; i < orderedRef.length; i++) {
      assignments[i] = directLines[i] ?? "";
    }
    return { useDirect: true, assignments };
  }

  if (copyableIndices.length === 0) return { useDirect: false, assignments };

  if (directLines.length === copyableIndices.length) {
    for (let j = 0; j < copyableIndices.length; j++) {
      assignments[copyableIndices[j]!] = directLines[j] ?? "";
    }
    return { useDirect: true, assignments };
  }

  if (directLines.length > copyableIndices.length && copyableIndices.length >= 1) {
    for (let j = 0; j < copyableIndices.length; j++) {
      assignments[copyableIndices[j]!] = directLines[j] ?? "";
    }
    return { useDirect: true, assignments };
  }

  if (directLines.length < copyableIndices.length && copyableIndices.length >= 1) {
    for (let j = 0; j < directLines.length; j++) {
      assignments[copyableIndices[j]!] = directLines[j] ?? "";
    }
    return { useDirect: true, assignments };
  }

  return { useDirect: false, assignments };
}

/**
 * Reference OCR often fragments one meme line into many boxes; reviewer `text_blocks[]`
 * carries the authoritative copy count. Keep decor/handle slots + one target per copy line.
 */
function shrinkOrderedRefToTextBlockLines(
  orderedRef: DocAiLayoutBlock[],
  directLines: string[]
): DocAiLayoutBlock[] | null {
  if (directLines.length === 0) return null;

  const preserved = orderedRef.filter(
    (r) =>
      isPreserveReferenceDecorText(r.ref_text, r) ||
      isHandleTextBlock(r.role, r.ref_text) ||
      looksLikeInstagramHandleText(r.ref_text)
  );
  const copyable = orderedRef.filter((r) => docAiRefAcceptsDirectCopyLine(r));
  if (copyable.length <= directLines.length) return null;

  const stacks = sortVerticalStacksForReadingOrder(groupDocAiBlocksIntoVerticalStacks(copyable));
  let picks = stacks.map((stack) =>
    stack.reduce((best, b) => (b.w * b.h >= best.w * best.h ? b : best), stack[0]!)
  );
  if (picks.length > directLines.length) {
    picks = picks.slice(0, directLines.length);
  } else if (picks.length < directLines.length) {
    const byReading = [...copyable].sort((a, b) => a.y - b.y || a.x - b.x || b.w * b.h - a.w * a.h);
    picks = byReading.slice(0, directLines.length);
  }

  const merged = [...preserved, ...picks];
  merged.sort((a, b) => a.y - b.y || a.x - b.x);
  return merged.length > 0 ? merged : null;
}

function dedupeDocAiRenderLayersByNormalizedText(
  layers: MimicDocAiRenderTextLayer[]
): MimicDocAiRenderTextLayer[] {
  if (layers.length <= 1) return layers;
  const out: MimicDocAiRenderTextLayer[] = [];
  const indexByKey = new Map<string, number>();

  for (const layer of layers) {
    const key = normalizeCopyChunkForLayerMatch(layer.text);
    if (key.length < 3) {
      out.push(layer);
      continue;
    }
    const prevIdx = indexByKey.get(key);
    if (prevIdx == null) {
      indexByKey.set(key, out.length);
      out.push(layer);
      continue;
    }
    const prev = out[prevIdx]!;
    if (layer.w_px * layer.h_px > prev.w_px * prev.h_px) {
      out[prevIdx] = layer;
    }
  }

  out.sort((a, b) => a.y_px - b.y_px || a.x_px - b.x_px);
  return out;
}

function textBlocksPreferDirectMapping(
  orderedRef: DocAiLayoutBlock[],
  directLines: string[],
  llmLines: LlmSlideCopyLines
): boolean {
  if (directLines.length === 0) return false;
  if (!orderedRefHasChatMockTitlePair(orderedRef)) return true;
  const headline = (llmLines.headline ?? directLines[0] ?? "").trim();
  if (/^Texting\s+(?:a|an|your)\s+/i.test(headline)) return false;
  if (directLines.length >= 2 && llmLines.bodyLines.length >= 1) return true;
  return directLines.length >= 3;
}

function orderedRefHasChatMockTitlePair(orderedRef: DocAiLayoutBlock[]): boolean {
  for (let i = 0; i < orderedRef.length - 1; i++) {
    const cur = orderedRef[i]!;
    const next = orderedRef[i + 1];
    if (
      next &&
      isTemplateInstructionText(cur.ref_text) &&
      isChatMockFriendSubtitle(next.ref_text) &&
      docAiBlocksAdjacentInStackStrict(cur, next)
    ) {
      return true;
    }
  }
  return false;
}

/** Pre-assign copy when chat-mock title is one sentence split across two OCR boxes. */
function buildRefBlockCopyAssignments(
  orderedRef: DocAiLayoutBlock[],
  llmLines: LlmSlideCopyLines,
  directLines: string[]
): string[] {
  const headline = (llmLines.headline ?? directLines[0] ?? "").trim();
  const bodyLines = [...llmLines.bodyLines];
  let bodyIdx = 0;
  const out = new Array<string>(orderedRef.length).fill("");

  for (let i = 0; i < orderedRef.length; i++) {
    const ref = orderedRef[i]!;
    const next = orderedRef[i + 1];

    if (isPreserveReferenceDecorText(ref.ref_text, ref)) {
      out[i] = ref.ref_text.trim();
      continue;
    }

    if (next && isChatMockTitlePair(ref, next)) {
      const split = splitHeadlineForChatMockTitlePair(headline, ref, next);
      out[i] = split.upper;
      out[i + 1] = split.lower;
      i++;
      continue;
    }

    if (isTemplateInstructionRefBlock(ref.ref_text) || roleBucket(ref.role) === "headline") {
      out[i] = headline;
      continue;
    }

    if (isChatMockFriendSubtitle(ref.ref_text)) continue;

    const bucket = roleBucket(ref.role);
    if (bucket === "cta" && bodyIdx < bodyLines.length - 1) {
      out[i] = bodyLines[bodyLines.length - 1] ?? "";
      bodyIdx = bodyLines.length;
      continue;
    }

    out[i] = bodyLines[bodyIdx++] ?? "";
  }

  return out;
}

export { filterOverlayLayoutBlocks, collapseParagraphCopyTargets } from "./mimic-docai-overlay-layout.js";

/** Bias larger vs raw OCR size_px — Puppeteer shrink-to-fit caps overflow afterward. */
export const DEFAULT_MIMIC_DOCAI_FONT_SCALE = 1.15;

/** Slightly conservative width estimate — lower ratio = less preemptive shrink for width. */
const DOC_AI_CHAR_WIDTH_RATIO = 0.48;

function inferDocAiFontSizeFromBBox(boxHPx: number, singleLine: boolean, lineCount: number): number {
  if (singleLine) return Math.max(MIMIC_DOCAI_MIN_FONT_SIZE_PX, Math.round(boxHPx * 0.9));
  return Math.max(MIMIC_DOCAI_MIN_FONT_SIZE_PX, Math.floor(boxHPx / (Math.max(1, lineCount) * 1.1)));
}

function medianRefFontPxFromBlocks(blocks: Array<Pick<DocAiLayoutBlock, "font_size_px">>): number | null {
  const sizes = blocks
    .map((b) => b.font_size_px)
    .filter((n): n is number => n != null && Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b);
  if (sizes.length === 0) return null;
  const mid = Math.floor(sizes.length / 2);
  return sizes.length % 2 === 1 ? sizes[mid]! : Math.round((sizes[mid - 1]! + sizes[mid]!) / 2);
}

/** Prefer the largest reference line size in a stack (meme traits should read bold). */
function stackRefFontPxFromBlocks(blocks: Array<Pick<DocAiLayoutBlock, "font_size_px">>): number | null {
  const sizes = blocks
    .map((b) => b.font_size_px)
    .filter((n): n is number => n != null && Number.isFinite(n) && n > 0);
  if (sizes.length === 0) return null;
  const median = medianRefFontPxFromBlocks(blocks);
  const peak = Math.max(...sizes);
  const blended = Math.round(Math.max(median ?? 0, peak * 0.92));
  return blended > 0 ? blended : null;
}

/** Estimate initial font size before Puppeteer shrink-to-fit. */
export function estimateDocAiFitFontSizePx(opts: {
  text: string;
  refText: string;
  refFontPx: number | null;
  boxWPx: number;
  boxHPx: number;
  singleLine?: boolean;
  fontScale?: number;
  textBacking?: boolean;
  role?: string | null;
  projectHandle?: string | null;
}): number {
  const lineCount = Math.max(1, opts.text.split(/\n/).filter((l) => l.trim()).length);
  const newLen = Math.max(1, opts.text.trim().length);

  if (isMimicDocAiHandleLayer(opts.role ?? null, opts.text, opts.projectHandle)) {
    return clampDocAiFontSizePx(MIMIC_DOCAI_HANDLE_FONT_SIZE_PX);
  }

  if (opts.textBacking) {
    const base =
      opts.refFontPx != null && opts.refFontPx > 0
        ? clampDocAiTextBackFontSizePx(opts.refFontPx)
        : MIMIC_DOCAI_TEXT_BACK_BODY_FONT_PX;
    return clampDocAiTextBackFontSizePx(Math.round(base * MIMIC_DOCAI_TEXT_BACK_FONT_SCALE));
  }

  const fontScale =
    opts.fontScale != null && Number.isFinite(opts.fontScale) && opts.fontScale > 0
      ? opts.fontScale
      : DEFAULT_MIMIC_DOCAI_FONT_SCALE;
  const refLen = Math.max(1, opts.refText.trim().length);
  const maxByHeight = Math.max(MIMIC_DOCAI_MIN_FONT_SIZE_PX, Math.round(opts.boxHPx * 0.96));
  const inferredFromBox = inferDocAiFontSizeFromBBox(opts.boxHPx, Boolean(opts.singleLine), lineCount);

  let size =
    opts.refFontPx != null && opts.refFontPx > 0
      ? clampDocAiFontSizePx(opts.refFontPx)
      : inferredFromBox;
  // Document AI size_px often under-reports — prefer filling the bbox height.
  size = Math.max(size, inferredFromBox);
  size = Math.min(size, maxByHeight);
  size = clampDocAiFontSizePx(size);

  if (opts.singleLine) {
    const approxWidth = newLen * size * DOC_AI_CHAR_WIDTH_RATIO;
    if (approxWidth > opts.boxWPx) {
      size = Math.floor(opts.boxWPx / (newLen * DOC_AI_CHAR_WIDTH_RATIO));
    }
    size = Math.round(size * fontScale);
    size = Math.min(size, maxByHeight);
    return clampDocAiFontSizePx(size);
  }

  if (newLen > refLen) {
    size = clampDocAiFontSizePx(Math.round(size * (refLen / newLen)));
  }

  const maxByLineHeight = Math.floor(opts.boxHPx / (lineCount * 1.1));
  if (maxByLineHeight >= MIMIC_DOCAI_MIN_FONT_SIZE_PX) {
    size = Math.min(size, maxByLineHeight);
  }

  const approxCharW = size * DOC_AI_CHAR_WIDTH_RATIO;
  const charsPerLine = Math.max(1, Math.floor(opts.boxWPx / approxCharW));
  const wrappedLines = Math.max(lineCount, Math.ceil(newLen / charsPerLine));
  const maxByWrap = Math.floor(opts.boxHPx / (wrappedLines * 1.1));
  if (maxByWrap >= MIMIC_DOCAI_MIN_FONT_SIZE_PX) {
    size = Math.min(size, maxByWrap);
  }

  size = Math.round(size * fontScale);
  size = Math.min(size, maxByHeight);
  return clampDocAiFontSizePx(size);
}

export function buildDocAiLayerCssStyle(opts: {
  px: { x: number; y: number; w: number; h: number };
  text: string;
  refText: string;
  refFontPx: number | null;
  fontWeight: number | null;
  color: string | null;
  fontFamily: string | null;
  textAlign: string;
  singleLine: boolean;
  textBacking?: boolean;
  textBackingColor?: string | null;
  role?: string | null;
  projectHandle?: string | null;
}): { css_style: string; font_size_px: number; layout_mode: "single_line" | "multi_line"; layout_class: string } {
  const fontSize = estimateDocAiFitFontSizePx({
    text: opts.text,
    refText: opts.refText,
    refFontPx: opts.refFontPx,
    boxWPx: opts.px.w,
    boxHPx: opts.px.h,
    singleLine: opts.singleLine,
    textBacking: opts.textBacking,
    role: opts.role,
    projectHandle: opts.projectHandle,
  });
  const lineCount = Math.max(1, opts.text.split(/\n/).filter((l) => l.trim()).length);
  const lineHeight = opts.singleLine
    ? Math.min(1.15, Math.max(0.92, opts.px.h / fontSize))
    : Math.min(1.4, Math.max(1.02, opts.px.h / (fontSize * lineCount)));

  const cssParts = [
    `left:${opts.px.x}px`,
    `top:${opts.px.y}px`,
    `width:${opts.px.w}px`,
    `height:${opts.px.h}px`,
    `font-size:${fontSize}px`,
    `line-height:${lineHeight.toFixed(3)}`,
    `text-align:${opts.textAlign}`,
  ];

  if (opts.singleLine) {
    const justify =
      opts.textAlign === "center" ? "center" : opts.textAlign === "right" ? "flex-end" : "flex-start";
    if (opts.textBacking) {
      cssParts.push("white-space:nowrap", "overflow:visible", `justify-content:${justify}`);
    } else {
      cssParts.push(
        "white-space:nowrap",
        "overflow:hidden",
        "text-overflow:ellipsis",
        `justify-content:${justify}`
      );
    }
  } else {
    cssParts.push(
      "white-space:pre-wrap",
      "overflow-wrap:break-word",
      "word-break:normal",
      "overflow:visible"
    );
  }

  if (opts.textBacking) {
    cssParts.push("display:inline-block", "vertical-align:top");
    cssParts.push(
      `background:${formatMimicTextBackingBackground(opts.textBackingColor)}`,
      "padding:3px 8px",
      "border-radius:4px",
      "box-decoration-break:clone",
      "-webkit-box-decoration-break:clone"
    );
  }

  if (opts.fontWeight) cssParts.push(`font-weight:${opts.fontWeight}`);
  cssParts.push(`color:${resolveMimicDocAiLayerColor({ refColor: opts.color, textBacking: opts.textBacking })}`);
  if (opts.fontFamily) cssParts.push(`font-family:${opts.fontFamily}`);

  const layout_mode = opts.singleLine ? "single_line" : "multi_line";
  const layout_class = opts.singleLine ? "mimic-docai-layer--single-line" : "mimic-docai-layer--multi-line";

  return { css_style: cssParts.join(";"), font_size_px: fontSize, layout_mode, layout_class };
}

function horizontalOverlapRatio(
  a: Pick<MimicTextBlock, "x" | "w">,
  b: Pick<MimicTextBlock, "x" | "w">
): number {
  const a1 = a.x;
  const a2 = a.x + a.w;
  const b1 = b.x;
  const b2 = b.x + b.w;
  const overlap = Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
  const union = Math.max(a2, b2) - Math.min(a1, b1);
  return union > 0 ? overlap / union : 0;
}

function blockCenterX(b: Pick<MimicTextBlock, "x" | "w">): number {
  return b.x + b.w / 2;
}

export function docAiBlocksShareVerticalStack(
  a: Pick<MimicTextBlock, "x" | "w">,
  b: Pick<MimicTextBlock, "x" | "w">
): boolean {
  if (horizontalOverlapRatio(a, b) >= 0.35) return true;
  return Math.abs(blockCenterX(a) - blockCenterX(b)) < 0.1;
}

/** True when two reference lines share a vertical text column (stacked phrases). */
export function docAiBlocksAdjacentInStack(
  a: Pick<MimicTextBlock, "x" | "y" | "w" | "h">,
  b: Pick<MimicTextBlock, "x" | "y" | "w" | "h">
): boolean {
  return blocksVerticallyNestedOrAdjacent(a, b);
}

/** Tighter adjacency for chat-mock title pairs (two-line headline). */
export function docAiBlocksAdjacentInStackStrict(
  a: Pick<MimicTextBlock, "x" | "y" | "w" | "h">,
  b: Pick<MimicTextBlock, "x" | "y" | "w" | "h">
): boolean {
  if (!docAiBlocksShareVerticalStack(a, b)) return false;
  const gap = b.y - (a.y + a.h);
  return gap >= -0.015 && gap < 0.06;
}

/** Union bbox for a vertical OCR stack (cluster = one sentence block). */
export function docAiStackUnionBBox(
  stack: Array<Pick<MimicTextBlock, "x" | "y" | "w" | "h">>
): { x: number; y: number; w: number; h: number } {
  const x1 = Math.min(...stack.map((b) => b.x));
  const y1 = Math.min(...stack.map((b) => b.y));
  const x2 = Math.max(...stack.map((b) => b.x + b.w));
  const y2 = Math.max(...stack.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: Math.max(0.02, x2 - x1), h: Math.max(0.02, y2 - y1) };
}

/** Prefer upper-left multi-line corner stacks for meme hook remainders (e.g. flirt / slumber hooks). */
export function hookStyleBodyStackIndex(stacks: DocAiLayoutBlock[][]): number | null {
  if (stacks.length === 0) return null;
  let bestIdx: number | null = null;
  let bestScore = -1;
  for (let i = 0; i < stacks.length; i++) {
    const stack = stacks[i]!;
    const yMin = Math.min(...stack.map((b) => b.y));
    const xMin = Math.min(...stack.map((b) => b.x));
    let score = 0;
    if (yMin < 0.58) score += 6;
    if (xMin < 0.42) score += 8;
    if (stack.length >= 2 && stack.length <= 4) score += stack.length * 3;
    else if (stack.length === 1 && yMin < 0.5) score += 2;
    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }
  if (bestIdx != null) return bestIdx;
  let leftMost: number | null = null;
  let minX = 1;
  for (let i = 0; i < stacks.length; i++) {
    const stack = stacks[i]!;
    const yMin = Math.min(...stack.map((b) => b.y));
    const xMin = Math.min(...stack.map((b) => b.x));
    if (yMin < 0.58 && xMin < minX) {
      minX = xMin;
      leftMost = i;
    }
  }
  return leftMost;
}

/** Map body copy-slot index → spatial stack index for headline remainder routing. */
export function bodyStackIndexForHeadlineRemainder(
  stacks: DocAiLayoutBlock[][],
  transcript: string,
  headlineRemainder: string | null | undefined,
  orderedRef: Array<Pick<DocAiLayoutBlock, "ref_text" | "role" | "x" | "y" | "w" | "h">>
): number | null {
  if (stacks.length === 0) return null;
  if (!String(headlineRemainder ?? "").trim()) return null;
  const pseudoSlots = stacks.map((stack, slot_index) => ({
    slot_index,
    llm_field: "body",
    block_texts: stack.map((b) => b.ref_text),
    reference_text: stack.map((b) => b.ref_text).join(" "),
  }));
  const idx = bodySlotIndexForHeadlineRemainder(pseudoSlots, transcript, headlineRemainder, orderedRef);
  if (idx != null) return idx;
  if (headlineRemainder?.trim()) return hookStyleBodyStackIndex(stacks);
  return null;
}

/** Sentence-aware body normalization for stack assignment (replaces naive line chunking). */
export function normalizeBodyLinesForStackCount(bodyLines: string[], stackCount: number): string[] {
  return semanticBodyCopyForStacks(bodyLines, stackCount);
}

/**
 * Assign LLM body lines to spatial stacks (one render cluster per stack).
 * When there are enough lines, each OCR micro-line in a stack gets one LLM line (joined at render).
 */
export function assignBodyLinesToSpatialStacks(
  stacks: DocAiLayoutBlock[][],
  bodyLines: string[],
  opts?: {
    headlineRemainder?: string | null;
    remainderStackIndex?: number | null;
  }
): { stackTexts: string[]; consumedBodyLines: number } {
  const remainderIdx = opts?.remainderStackIndex ?? -1;
  const bodyStackIndices: number[] = [];
  for (let i = 0; i < stacks.length; i++) {
    if (i !== remainderIdx) bodyStackIndices.push(i);
  }

  const refCounts = bodyStackIndices.map((i) => stacks[i]!.length);
  const totalRefs = refCounts.reduce((a, b) => a + b, 0);
  const units = bodyLinesToSemanticUnits(bodyLines);
  const stackTexts = new Array<string>(stacks.length).fill("");

  if (remainderIdx >= 0 && opts?.headlineRemainder?.trim()) {
    stackTexts[remainderIdx] = opts.headlineRemainder.trim();
  }

  if (units.length === totalRefs && totalRefs > 0 && bodyStackIndices.length > 0) {
    const work = [...units];
    for (const si of bodyStackIndices) {
      const take = stacks[si]!.length;
      const chunk = work.splice(0, take);
      const merged = bodyLinesToSemanticUnits(chunk);
      stackTexts[si] = merged.length <= 1 ? (merged[0] ?? "") : merged.join("\n");
    }
  } else if (bodyStackIndices.length > 0) {
    const fitted =
      units.length === bodyStackIndices.length
        ? units
        : fitSemanticUnitsToStackCount(units, bodyStackIndices.length);
    for (let j = 0; j < bodyStackIndices.length; j++) {
      stackTexts[bodyStackIndices[j]!] = fitted[j] ?? "";
    }
  }

  const repaired = repairDanglingStackTexts(stackTexts, stacks, {
    skipIndices: remainderIdx >= 0 ? [remainderIdx] : undefined,
  });
  for (let i = 0; i < stackTexts.length; i++) {
    if (i === remainderIdx && opts?.headlineRemainder?.trim()) {
      stackTexts[i] = repaired[i]?.trim() ? repaired[i]! : opts.headlineRemainder.trim();
    } else {
      stackTexts[i] = repaired[i] ?? stackTexts[i] ?? "";
    }
  }

  const assignedBodyStacks = bodyStackIndices.filter((si) => stackTexts[si]?.trim()).length;
  const consumedBodyLines =
    assignedBodyStacks >= bodyStackIndices.length && bodyStackIndices.length > 0
      ? bodyLines.length
      : Math.min(bodyLines.length, assignedBodyStacks);
  return { stackTexts, consumedBodyLines };
}

function maxFontSizeForDocAiBox(
  boxWPx: number,
  boxHPx: number,
  lineCount: number,
  singleLine: boolean
): number {
  if (singleLine) return Math.max(MIMIC_DOCAI_MIN_FONT_SIZE_PX, Math.round(boxHPx * 0.85));
  const lines = Math.max(1, lineCount);
  return Math.max(MIMIC_DOCAI_MIN_FONT_SIZE_PX, Math.floor(boxHPx / (lines * 1.15)));
}

/** Stretch OCR highlight boxes before render so copy is not trapped in collapsed OCR bboxes. */
function expandDocAiBoxForTextContent(
  bbox: { x: number; y: number; w: number; h: number },
  text: string,
  fontSizePx: number,
  singleLine: boolean
): { x: number; y: number; w: number; h: number } {
  const margin = 32;
  const padX = 24;
  const padY = 16;
  const charW = fontSizePx * 0.52;
  const lineH = fontSizePx * 1.22;
  const trimmed = text.trim();
  if (!trimmed) return bbox;
  const lineParts = trimmed.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const lines = singleLine ? 1 : Math.max(1, lineParts.length);
  const longestLine = singleLine
    ? trimmed.replace(/\n/g, " ")
    : lineParts.reduce((a, b) => (b.length > a.length ? b : a), lineParts[0] ?? "");
  const xPx = bbox.x * CAROUSEL_RENDER_WIDTH_PX;
  const yPx = bbox.y * CAROUSEL_RENDER_HEIGHT_PX;
  const maxWNorm = (CAROUSEL_RENDER_WIDTH_PX - margin - xPx) / CAROUSEL_RENDER_WIDTH_PX;
  const maxHNorm = (CAROUSEL_RENDER_HEIGHT_PX - margin - yPx) / CAROUSEL_RENDER_HEIGHT_PX;
  const needWNorm = (longestLine.length * charW + padX) / CAROUSEL_RENDER_WIDTH_PX;
  const needHNorm = (lines * lineH + padY) / CAROUSEL_RENDER_HEIGHT_PX;
  const minW = Math.min(maxWNorm, Math.max(bbox.w, needWNorm));
  const minH = Math.min(maxHNorm, Math.max(bbox.h, needHNorm));
  return { ...bbox, w: minW, h: minH };
}

function pushDocAiRenderLayer(
  layers: MimicDocAiRenderTextLayer[],
  ref: DocAiLayoutBlock,
  text: string,
  bbox: { x: number; y: number; w: number; h: number },
  opts: {
    textBacking: boolean;
    textBackingColor?: string | null;
    theme?: { ink: string; body: string };
    forceSingleLine?: boolean;
    forceMultiLine?: boolean;
    refFontPxOverride?: number | null;
    avoidCenterSubject?: boolean;
    projectHandle?: string | null;
  }
): void {
  const trimmed = sanitizeMimicOverlayCopyText(text);
  if (!trimmed) return;

  const bucket = roleBucket(ref.role);
  const skipCenterAvoid = docAiLayerSkipsCenterAvoid(ref, bucket);
  let renderBBox = bbox;
  if (opts.avoidCenterSubject && !skipCenterAvoid) {
    renderBBox = nudgeBBoxAwayFromFullBleedSubjectZone(bbox);
  }
  const color = resolveMimicDocAiLayerColor({
    refColor:
      ref.color_hex ??
      (bucket === "headline" || bucket === "cta" ? opts.theme?.ink : opts.theme?.body) ??
      null,
    textBacking: opts.textBacking,
  });
  const fontWeight = cssFontWeight(ref.font_weight);
  const textAlign =
    ref.align && ref.align !== "unknown" ? ref.align : bucket === "cta" ? "center" : "left";
  const fontFamily = webFontFamilyFromDetected(ref.font_family);
  const lineCount = Math.max(1, trimmed.split(/\n/).filter((l) => l.trim()).length);
  const boxWPx = renderBBox.w * CAROUSEL_RENDER_WIDTH_PX;
  const singleLinePreview = opts.textBacking
    ? preferSingleLineTextBackLayer(trimmed, boxWPx, {
        forceSingleLine: opts.forceSingleLine,
        forceMultiLine: opts.forceMultiLine || lineCount > 1,
      })
    : opts.forceMultiLine || lineCount > 1
      ? false
      : opts.forceSingleLine || (bucket === "headline" && !trimmed.includes("\n"))
        ? true
        : shouldRenderDocAiLayerSingleLine(ref.ref_text, trimmed, boxWPx, renderBBox.h * CAROUSEL_RENDER_HEIGHT_PX);
  if (opts.textBacking) {
    const estFont = ref.font_size_px && ref.font_size_px > 0 ? clampDocAiTextBackFontSizePx(ref.font_size_px) : MIMIC_DOCAI_TEXT_BACK_BODY_FONT_PX;
    renderBBox = expandDocAiBoxForTextContent(renderBBox, trimmed, estFont, singleLinePreview);
  }
  const px = docAiBBoxToRenderPx(renderBBox.x, renderBBox.y, renderBBox.w, renderBBox.h);
  const singleLine = singleLinePreview;
  const refFontPx =
    opts.refFontPxOverride != null && opts.refFontPxOverride > 0
      ? clampDocAiFontSizePx(opts.refFontPxOverride)
      : ref.font_size_px != null && ref.font_size_px > 0
        ? clampDocAiFontSizePx(ref.font_size_px)
        : ref.font_size_px;
  const isHandleLayer = isMimicDocAiHandleLayer(ref.role ?? bucket, trimmed, opts.projectHandle);
  const layerRole = isHandleLayer ? "handle" : ref.role ?? bucket;
  const styled = buildDocAiLayerCssStyle({
    px,
    text: trimmed,
    refText: ref.ref_text,
    refFontPx,
    fontWeight,
    color,
    fontFamily,
    textAlign,
    singleLine,
    textBacking: opts.textBacking,
    textBackingColor: opts.textBackingColor,
    role: ref.role ?? bucket,
    projectHandle: opts.projectHandle,
  });
  const maxFit = maxFontSizeForDocAiBox(px.w, px.h, lineCount, singleLine);
  const fontSize = isHandleLayer
    ? clampDocAiFontSizePx(MIMIC_DOCAI_HANDLE_FONT_SIZE_PX)
    : opts.textBacking
      ? clampDocAiTextBackFontSizePx(styled.font_size_px)
      : clampDocAiFontSizePx(Math.min(styled.font_size_px, maxFit));
  const css = styled.css_style.replace(/font-size:\d+px/, `font-size:${fontSize}px`);

  layers.push({
    text: trimmed,
    role: layerRole,
    x_pct: pct01(renderBBox.x),
    y_pct: pct01(renderBBox.y),
    w_pct: pct01(renderBBox.w),
    h_pct: pct01(renderBBox.h),
    x_px: px.x,
    y_px: px.y,
    w_px: px.w,
    h_px: px.h,
    layout_mode: singleLine ? "single_line" : "multi_line",
    layout_class: singleLine ? "mimic-docai-layer--single-line" : "mimic-docai-layer--multi-line",
    font_size_px: fontSize,
    ref_font_size_px: refFontPx ?? ref.font_size_px,
    font_weight: fontWeight,
    color_hex: color,
    text_align: textAlign,
    css_style: css,
    text_backing: opts.textBacking,
    ref_x: ref.x,
    ref_y: ref.y,
    ref_w: ref.w,
    ref_h: ref.h,
    skip_center_avoid: skipCenterAvoid,
  });
}

/**
 * Cluster body lines into vertical stacks (e.g. top-left phrase block, top-right phrase block).
 * Column-first, then chain adjacent lines — matches mimic-copy-slots grouping.
 */
export function groupDocAiBlocksIntoVerticalStacks(blocks: DocAiLayoutBlock[]): DocAiLayoutBlock[][] {
  const columns: DocAiLayoutBlock[][] = [];
  for (const block of blocks) {
    let placed = false;
    for (const column of columns) {
      if (docAiBlocksShareVerticalStack(block, column[0]!)) {
        column.push(block);
        placed = true;
        break;
      }
    }
    if (!placed) columns.push([block]);
  }

  const stacks: DocAiLayoutBlock[][] = [];
  for (const column of columns) {
    column.sort((a, b) => a.y - b.y || a.x - b.x);
    let current: DocAiLayoutBlock[] = [];
    for (const block of column) {
      if (current.length === 0) {
        current.push(block);
        continue;
      }
      const prev = current[current.length - 1]!;
      if (docAiBlocksAdjacentInStack(prev, block)) {
        current.push(block);
      } else {
        stacks.push(current);
        current = [block];
      }
    }
    if (current.length > 0) stacks.push(current);
  }
  return stacks;
}

/** Merge tiny single-line OCR orphans into the nearest vertical neighbor stack. */
function mergeOrphanSingleBlockStacks(stacks: DocAiLayoutBlock[][]): DocAiLayoutBlock[][] {
  if (stacks.length <= 1) return stacks;
  const working = stacks.map((s) => [...s]);
  const drop = new Set<number>();
  for (let i = 0; i < working.length; i++) {
    if (drop.has(i)) continue;
    const stack = working[i]!;
    if (stack.length !== 1) continue;
    const block = stack[0]!;
    if (block.ref_text.split(/\s+/).length > 3) continue;
    for (let j = 0; j < working.length; j++) {
      if (i === j || drop.has(j)) continue;
      const other = working[j]!;
      if (other.length === 0) continue;
      const anchor = other[0]!;
      const gap = block.y - (anchor.y + anchor.h);
      if (docAiBlocksShareVerticalStack(block, anchor) && gap >= -0.03 && gap < 0.14) {
        other.push(block);
        other.sort((a, b) => a.y - b.y || a.x - b.x);
        drop.add(i);
        break;
      }
    }
  }
  return working.filter((_, i) => !drop.has(i));
}

function isBodyStackMergeBlock(block: DocAiLayoutBlock): boolean {
  const bucket = roleBucket(block.role);
  if (bucket === "headline") return false;
  if (isHandleTextBlock(block.role, block.ref_text)) return false;
  if (isPreserveReferenceDecorText(block.ref_text, block)) return false;
  return bucket === "body" || bucket === "cta";
}

function bodyBlocksFromOrderedRef(orderedRef: DocAiLayoutBlock[]): DocAiLayoutBlock[] {
  return orderedRef.filter(isBodyStackMergeBlock);
}

function sortVerticalStacksForReadingOrder(stacks: DocAiLayoutBlock[][]): DocAiLayoutBlock[][] {
  return [...stacks].sort((a, b) => {
    const ay = Math.min(...a.map((x) => x.y));
    const by = Math.min(...b.map((x) => x.y));
    if (Math.abs(ay - by) > 0.035) return ay - by;
    const ax = Math.min(...a.map((x) => x.x));
    const bx = Math.min(...b.map((x) => x.x));
    return ax - bx;
  });
}

/**
 * Reference block order for mapping LLM lines: headline → each vertical stack top-to-bottom → handles.
 */
export function orderDocAiBlocksForLlmCopyMapping(blocks: DocAiLayoutBlock[]): DocAiLayoutBlock[] {
  const headlines: DocAiLayoutBlock[] = [];
  const handles: DocAiLayoutBlock[] = [];
  const body: DocAiLayoutBlock[] = [];

  for (const block of blocks) {
    if (isHandleTextBlock(block.role, block.ref_text)) {
      handles.push(block);
    } else if (roleBucket(block.role) === "headline") {
      headlines.push(block);
    } else if (roleBucket(block.role) === "cta") {
      handles.push(block);
    } else {
      body.push(block);
    }
  }

  const sortPos = (a: DocAiLayoutBlock, b: DocAiLayoutBlock) => a.y - b.y || a.x - b.x;
  headlines.sort(sortPos);
  handles.sort(sortPos);

  const stacks = sortVerticalStacksForReadingOrder(groupDocAiBlocksIntoVerticalStacks(body));
  const bodyOrdered = stacks.flatMap((stack) => [...stack].sort(sortPos));

  return [...headlines, ...bodyOrdered, ...handles];
}

function layerMatchesRefNorm(
  layer: MimicDocAiRenderTextLayer,
  ref: DocAiLayoutBlock,
  tolerance = 0.012
): boolean {
  if (layer.ref_x == null || layer.ref_y == null) return false;
  return (
    Math.abs(layer.ref_x - ref.x) <= tolerance &&
    Math.abs(layer.ref_y - ref.y) <= tolerance &&
    Math.abs(layer.ref_w! - ref.w) <= tolerance * 2 &&
    Math.abs(layer.ref_h! - ref.h) <= tolerance * 2
  );
}

/**
 * Merge fragmented copy inside one vertical stack into a single multi-line layer
 * (top-to-bottom reading order) so sentences are not clipped across micro-boxes.
 */
export function consolidateDocAiRenderLayersInVerticalStacks(
  layers: MimicDocAiRenderTextLayer[],
  orderedRef: DocAiLayoutBlock[],
  opts?: { textBacking?: boolean; textBackingColor?: string | null; projectHandle?: string | null }
): MimicDocAiRenderTextLayer[] {
  if (layers.length <= 1) return layers;
  const stacks = sortVerticalStacksForReadingOrder(
    groupDocAiBlocksIntoVerticalStacks(bodyBlocksFromOrderedRef(orderedRef))
  );
  const consumed = new Set<MimicDocAiRenderTextLayer>();
  const merged: MimicDocAiRenderTextLayer[] = [];

  const findLayer = (ref: DocAiLayoutBlock): MimicDocAiRenderTextLayer | null => {
    for (const layer of layers) {
      if (consumed.has(layer)) continue;
      if (layerMatchesRefNorm(layer, ref)) return layer;
    }
    return null;
  };

  for (const stack of stacks) {
    const mergeStack = stack.length >= 2 && stack.every(isBodyStackMergeBlock);

    if (!mergeStack) {
      for (const ref of stack) {
        const layer = findLayer(ref);
        if (layer) {
          merged.push(layer);
          consumed.add(layer);
        }
      }
      continue;
    }

    const stackLayers: MimicDocAiRenderTextLayer[] = [];
    for (const ref of stack) {
      const layer = findLayer(ref);
      if (layer) stackLayers.push(layer);
    }
    if (stackLayers.length === 0) continue;

    const rawTexts = stackLayers.map((l) => l.text.trim()).filter(Boolean);
    const uniqueTexts = [...new Set(rawTexts)];
    if (uniqueTexts.length === 0) {
      for (const l of stackLayers) consumed.add(l);
      continue;
    }

    const text = uniqueTexts.length === 1 ? uniqueTexts[0]! : rawTexts.join("\n");

    if (uniqueTexts.length === 1 && stackLayers.length === 1 && stack.length === 1) {
      merged.push(stackLayers[0]!);
      consumed.add(stackLayers[0]!);
      continue;
    }

    const yTop = Math.min(...stack.map((b) => b.y));
    const yBottom = Math.max(...stack.map((b) => b.y + b.h));
    const xLeft = Math.min(...stack.map((b) => b.x));
    const xRight = Math.max(...stack.map((b) => b.x + b.w));
    const anchor = stack[0]!;
    const unionPx = docAiBBoxToRenderPx(xLeft, yTop, xRight - xLeft, yBottom - yTop);
    const singleLine =
      opts?.textBacking && text.includes("\n")
        ? false
        : shouldRenderDocAiLayerSingleLine(
            stack.map((b) => b.ref_text).join(" "),
            text,
            unionPx.w,
            unionPx.h
          );
    const styled = buildDocAiLayerCssStyle({
      px: unionPx,
      text,
      refText: stack.map((b) => b.ref_text).join(" "),
      refFontPx:
        anchor.font_size_px != null && anchor.font_size_px > 0
          ? clampDocAiFontSizePx(anchor.font_size_px)
          : anchor.font_size_px,
      fontWeight: stackLayers[0]!.font_weight,
      color: stackLayers[0]!.color_hex,
      fontFamily: null,
      textAlign: stackLayers[0]!.text_align,
      singleLine,
      textBacking: opts?.textBacking,
      textBackingColor: opts?.textBackingColor,
      role: stackLayers[0]!.role,
      projectHandle: opts?.projectHandle,
    });

    merged.push({
      ...stackLayers[0]!,
      text,
      x_pct: pct01(xLeft),
      y_pct: pct01(yTop),
      w_pct: pct01(xRight - xLeft),
      h_pct: pct01(yBottom - yTop),
      x_px: unionPx.x,
      y_px: unionPx.y,
      w_px: unionPx.w,
      h_px: unionPx.h,
      layout_mode: styled.layout_mode,
      layout_class: styled.layout_class,
      font_size_px: styled.font_size_px,
      css_style: styled.css_style,
      text_backing: opts?.textBacking ?? false,
    });
    for (const l of stackLayers) consumed.add(l);
  }

  for (const layer of layers) {
    if (!consumed.has(layer)) merged.push(layer);
  }

  merged.sort((a, b) => a.y_px - b.y_px || a.x_px - b.x_px);
  return normalizeDocAiRenderLayerFontSizes(merged, opts);
}

function layerLooksLikeDecorTitle(layer: MimicDocAiRenderTextLayer): boolean {
  return isPreserveReferenceDecorText(layer.text, {
    role: layer.role,
    x: layer.ref_x ?? 0,
    y: layer.ref_y ?? 0,
    w: layer.ref_w ?? 0,
    h: layer.ref_h ?? 0,
  });
}

/** Even out body/handle font sizes so corner micro-OCR boxes do not render illegibly small. */
export function normalizeDocAiRenderLayerFontSizes(
  layers: MimicDocAiRenderTextLayer[],
  opts?: { textBacking?: boolean; projectHandle?: string | null }
): MimicDocAiRenderTextLayer[] {
  return layers.map((layer) => {
    if (isMimicDocAiHandleLayer(layer.role, layer.text, opts?.projectHandle)) {
      const handlePx = clampDocAiFontSizePx(MIMIC_DOCAI_HANDLE_FONT_SIZE_PX);
      if (layer.font_size_px === handlePx) return layer;
      const css = layer.css_style.replace(/font-size:\d+px/, `font-size:${handlePx}px`);
      return { ...layer, font_size_px: handlePx, css_style: css };
    }
    if (layerLooksLikeDecorTitle(layer)) return layer;
    if (roleBucket(layer.role) === "headline") return layer;
    const lineCount = Math.max(1, layer.text.split(/\n/).filter((l) => l.trim()).length);
    const singleLine = layer.layout_mode === "single_line";
    const refTarget =
      layer.ref_font_size_px != null && layer.ref_font_size_px > 0
        ? clampDocAiFontSizePx(layer.ref_font_size_px)
        : opts?.textBacking
          ? MIMIC_DOCAI_TEXT_BACK_BODY_FONT_PX
          : MIMIC_DOCAI_DEFAULT_FONT_SIZE_PX;
    const current = clampDocAiFontSizePx(layer.font_size_px ?? MIMIC_DOCAI_DEFAULT_FONT_SIZE_PX);
    const boostedTarget = opts?.textBacking
      ? clampDocAiTextBackFontSizePx(Math.round(refTarget * MIMIC_DOCAI_TEXT_BACK_FONT_SCALE))
      : refTarget;
    const maxFit = maxFontSizeForDocAiBox(layer.w_px, layer.h_px, lineCount, singleLine);
    const next = opts?.textBacking
      ? clampDocAiTextBackFontSizePx(Math.max(current, boostedTarget))
      : clampDocAiFontSizePx(Math.min(Math.max(current, MIMIC_DOCAI_MIN_FONT_SIZE_PX), maxFit));
    if (next === layer.font_size_px) return layer;

    const css = layer.css_style.replace(/font-size:\d+px/, `font-size:${next}px`);
    return { ...layer, font_size_px: next, css_style: css };
  });
}

function splitBodyLineForRefBlock(
  text: string,
  ref: DocAiLayoutBlock,
  nextInStack: DocAiLayoutBlock | null
): { current: string; remainder: string } {
  const trimmed = String(text ?? "").trim();
  if (!trimmed || !nextInStack) return { current: trimmed, remainder: "" };

  const refLen = Math.max(1, ref.ref_text.trim().length);
  const maxChars = Math.max(refLen, Math.floor(refLen * 1.15));
  if (trimmed.length <= maxChars) return { current: trimmed, remainder: "" };

  const slice = trimmed.slice(0, maxChars + 1);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > Math.floor(maxChars * 0.45)) {
    return {
      current: trimmed.slice(0, lastSpace).trim(),
      remainder: trimmed.slice(lastSpace).trim(),
    };
  }
  return {
    current: trimmed.slice(0, maxChars).trim(),
    remainder: trimmed.slice(maxChars).trim(),
  };
}

type LlmSlideCopyLines = {
  headline: string | null;
  bodyLines: string[];
};

function referenceHandlesFromSlide(slide: Record<string, unknown>): string[] {
  const handles = new Set<string>();
  if (Array.isArray(slide.text_blocks)) {
    for (const item of slide.text_blocks) {
      const rec = asRecord(item);
      if (!rec) continue;
      const text = String(rec.text ?? "").trim();
      if (!text) continue;
      if (isHandleTextBlock(String(rec.role ?? ""), text)) {
        handles.add(formatInstagramHandleForCta(text));
      } else {
        for (const h of collectInstagramHandlesFromText(text)) handles.add(h);
      }
    }
  }
  return [...handles].filter(Boolean);
}

/** Truncated or sparse `text_blocks[]` should not override richer headline/body fields. */
export function mimicSlideTextBlocksLookUnreliable(slide: Record<string, unknown>): boolean {
  const blocks = slide.text_blocks;
  if (!Array.isArray(blocks) || blocks.length === 0) return false;
  const body = String(slide.body ?? "").trim();
  for (const item of blocks) {
    const t = String(asRecord(item)?.text ?? "");
    if (t.includes("…") || t.includes("...")) return true;
  }
  let headlineBlockCount = 0;
  let blockBodyLen = 0;
  for (const item of blocks) {
    const rec = asRecord(item);
    if (!rec) continue;
    const role = String(rec.role ?? "");
    const text = String(rec.text ?? "").trim();
    if (!text) continue;
    if (roleBucket(role) === "headline") headlineBlockCount += 1;
    else if (!isHandleTextBlock(role, text)) blockBodyLen += text.length;
  }
  if (headlineBlockCount > 1) return true;
  if (body.length > 40 && blockBodyLen < body.length * 0.45) {
    let nonEmptyBlockCount = 0;
    for (const item of blocks) {
      const text = String(asRecord(item)?.text ?? "").trim();
      if (text) nonEmptyBlockCount += 1;
    }
    // Review UI body often concatenates lines; per-OCR text_blocks[] is authoritative when present.
    if (nonEmptyBlockCount >= 2) return false;
    return true;
  }
  return false;
}

/** Flatten slide copy into ordered lines (one per reference bbox in column stacks). */
export function expandLlmLinesForDocAiMapping(
  slide: Record<string, unknown>,
  opts?: {
    referenceHandles?: string[];
    projectHandle?: string | null;
    /** When true, drop @handle lines from body — handle bbox gets project handle at render. */
    layoutHasHandleBlock?: boolean;
  }
): LlmSlideCopyLines {
  const refHandles = [...new Set([...referenceHandlesFromSlide(slide), ...(opts?.referenceHandles ?? [])])];
  const projectHandle = opts?.projectHandle ? formatInstagramHandleForCta(opts.projectHandle) : null;

  const cleanBodyLine = (raw: string): string | null => {
    let t = substituteReferenceHandlesInText(String(raw ?? "").trim(), refHandles, projectHandle);
    if (opts?.layoutHasHandleBlock && looksLikeInstagramHandleText(t)) return null;
    return t || null;
  };

  if (
    Array.isArray(slide.text_blocks) &&
    slide.text_blocks.length > 0 &&
    !mimicSlideTextBlocksLookUnreliable(slide)
  ) {
    const headlines: string[] = [];
    const bodyLines: string[] = [];
    for (const item of slide.text_blocks) {
      const rec = asRecord(item);
      if (!rec) continue;
      const text = String(rec.text ?? "").trim();
      if (!text) continue;
      const bucket = roleBucket(String(rec.role ?? ""));
      const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
      if (bucket === "headline") {
        for (const line of lines.length > 0 ? lines : [text]) {
          const h = substituteReferenceHandlesInText(line, refHandles, projectHandle);
          if (h) headlines.push(h);
        }
      } else if (isHandleTextBlock(String(rec.role ?? ""), text)) {
        continue;
      } else {
        for (const line of lines.length > 0 ? lines : [text]) {
          const cleaned = cleanBodyLine(line);
          if (cleaned) bodyLines.push(cleaned);
        }
      }
    }
    const headline = headlines.length > 0 ? headlines.join(" ").replace(/\s+/g, " ").trim() : null;
    const bodyField = substituteReferenceHandlesInText(
      String(slide.body ?? slide.subtitle ?? "").trim(),
      refHandles,
      projectHandle
    );
    const headlineField = substituteReferenceHandlesInText(
      String(slide.headline ?? slide.title ?? "").trim(),
      refHandles,
      projectHandle
    ).replace(/\s+/g, " ").trim();
    const mergedHeadline = headline || headlineField || null;
    let nonEmptyBlockCount = 0;
    for (const item of slide.text_blocks) {
      const text = String(asRecord(item)?.text ?? "").trim();
      if (text) nonEmptyBlockCount += 1;
    }
    if (nonEmptyBlockCount >= 2) {
      return { headline: mergedHeadline, bodyLines };
    }
    if (bodyField) {
      for (const line of bodyField.split(/\n/).map((l) => l.trim()).filter(Boolean)) {
        const cleaned = cleanBodyLine(line);
        if (cleaned && !bodyLines.includes(cleaned)) bodyLines.push(cleaned);
      }
    }
    return { headline: mergedHeadline, bodyLines };
  }

  const cover = asRecord(slide.cover_slide);
  const cta = asRecord(slide.cta_slide);
  let headline = substituteReferenceHandlesInText(
    String(slide.headline ?? slide.title ?? cover?.headline ?? slide.cover ?? slide.intro_title ?? "").trim(),
    refHandles,
    projectHandle
  );
  headline = headline.replace(/\s+/g, " ").trim();
  const strippedHeadline = stripLeadingInstagramHandle(headline, refHandles);
  if (strippedHeadline.handle) headline = strippedHeadline.remainder;
  let body = substituteReferenceHandlesInText(
    String(slide.body ?? slide.subtitle ?? cover?.body ?? slide.cover_subtitle ?? slide.cta_text ?? cta?.body ?? "").trim(),
    refHandles,
    projectHandle
  );
  const bodyLines: string[] = [];
  for (const line of body.split(/\n/).map((l) => l.trim()).filter(Boolean)) {
    const cleaned = cleanBodyLine(line);
    if (cleaned) bodyLines.push(cleaned);
  }
  const ctaSub = String(cta?.sub ?? slide.cta_handle ?? cta?.handle ?? "").trim();
  if (ctaSub) {
    const cleaned = cleanBodyLine(ctaSub);
    if (cleaned) bodyLines.push(cleaned);
  }

  return { headline: headline || null, bodyLines };
}

/** Reference OCR/Nemotron layout blocks for a slide (px + normalized bbox). Used by overlay lab + QA. */
export function referenceDocAiLayoutBlocksForMimicSlide(
  mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans">,
  slideIndex1Based: number
): Array<{
  text: string;
  role: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  x_px: number;
  y_px: number;
  w_px: number;
  h_px: number;
  font_size_px: number | null;
  color_hex: string | null;
}> {
  const resolved = resolveRefSlideWithLayoutBlocksForMimic(mimic, slideIndex1Based);
  if (!resolved || resolved.layoutBlocks.length === 0) return [];
  return resolved.layoutBlocks.map((b) => {
    const px = bboxNormToRenderPx(b.x, b.y, b.w, b.h);
    return {
      text: b.ref_text,
      role: b.role,
      x: b.x,
      y: b.y,
      w: b.w,
      h: b.h,
      x_px: px.x,
      y_px: px.y,
      w_px: px.w,
      h_px: px.h,
      font_size_px: b.font_size_px,
      color_hex: b.color_hex,
    };
  });
}

function orderedLlmTextBlockLines(slide: Record<string, unknown>): string[] {
  if (!Array.isArray(slide.text_blocks)) return [];
  const lines: string[] = [];
  for (const item of slide.text_blocks) {
    const rec = asRecord(item);
    if (!rec) continue;
    const text = sanitizeMimicOverlayCopyText(rec.text);
    if (!text) continue;
    if (isOverlayChromeReferenceText(text, roleBucket(String(rec.role ?? "")))) continue;
    lines.push(text);
  }
  return lines;
}

/** Stack-first render: one layer per spatial cluster (zodiac quadrant / column). */
function buildMimicDocAiStackRenderLayers(
  orderedRef: DocAiLayoutBlock[],
  llmLines: LlmSlideCopyLines,
  transcript: string,
  theme: { ink: string; body: string } | undefined,
  opts: { projectHandle?: string | null; textBacking: boolean; textBackingColor?: string | null; avoidCenterSubject?: boolean }
): MimicDocAiRenderTextLayer[] {
  const textBacking = opts.textBacking;
  const textBackingColor = opts.textBackingColor;
  const avoidCenterSubject = Boolean(opts.avoidCenterSubject);
  const projectHandle = opts.projectHandle ? formatInstagramHandleForCta(opts.projectHandle) : null;
  const decorSplit = splitHeadlineWithPreservedDecorTitle(llmLines.headline ?? "", orderedRef);
  const headlineRemainder = decorSplit?.remainder?.trim() || null;

  const bodyBlocks: DocAiLayoutBlock[] = [];
  const tailBlocks: DocAiLayoutBlock[] = [];

  for (const ref of orderedRef) {
    if (isPreserveReferenceDecorText(ref.ref_text, ref)) continue;
    if (isHandleTextBlock(ref.role, ref.ref_text) || looksLikeInstagramHandleText(ref.ref_text)) {
      tailBlocks.push(ref);
      continue;
    }
    if (roleBucket(ref.role) === "cta") {
      tailBlocks.push(ref);
      continue;
    }
    if (roleBucket(ref.role) === "headline" && ref.y < 0.22) continue;
    bodyBlocks.push(ref);
  }

  const bodyStacks = sortVerticalStacksForReadingOrder(
    mergeOrphanSingleBlockStacks(groupDocAiBlocksIntoVerticalStacks(bodyBlocks))
  );
  const remainderStackIdx = bodyStackIndexForHeadlineRemainder(
    bodyStacks,
    transcript,
    headlineRemainder,
    orderedRef
  );
  const { stackTexts, consumedBodyLines } = assignBodyLinesToSpatialStacks(bodyStacks, llmLines.bodyLines, {
    headlineRemainder,
    remainderStackIndex: remainderStackIdx,
  });
  const tailBodyLines = llmLines.bodyLines.slice(consumedBodyLines);

  const layers: MimicDocAiRenderTextLayer[] = [];

  for (const ref of orderedRef) {
    if (!isPreserveReferenceDecorText(ref.ref_text, ref)) continue;
    pushDocAiRenderLayer(layers, ref, ref.ref_text.trim(), ref, {
      textBacking,
      textBackingColor,
      theme,
      forceSingleLine: true,
      avoidCenterSubject,
      projectHandle,
    });
  }

  for (let si = 0; si < bodyStacks.length; si++) {
    const text = stackTexts[si]?.trim();
    if (!text) continue;
    const stack = bodyStacks[si]!;
    const union = docAiStackUnionBBox(stack);
    const anchor = stack[0]!;
    const stackRefFont = stackRefFontPxFromBlocks(stack);
    pushDocAiRenderLayer(layers, anchor, text, union, {
      textBacking,
      textBackingColor,
      theme,
      forceMultiLine: true,
      refFontPxOverride: stackRefFont,
      avoidCenterSubject,
      projectHandle,
    });
  }

  const handleTailBlocks = tailBlocks.filter(
    (b) => isHandleTextBlock(b.role, b.ref_text) || looksLikeInstagramHandleText(b.ref_text)
  );
  const primaryHandleRef =
    handleTailBlocks.length > 0
      ? [...handleTailBlocks].sort((a, b) => b.y - a.y || b.x - a.x)[0]!
      : [...tailBlocks].sort((a, b) => b.y - a.y || b.x - a.x)[0] ?? null;

  let tailIdx = 0;
  for (const ref of tailBlocks) {
    const isHandleSlot =
      isHandleTextBlock(ref.role, ref.ref_text) || looksLikeInstagramHandleText(ref.ref_text);
    if (isHandleSlot && primaryHandleRef && ref !== primaryHandleRef) {
      continue;
    }
    let text = "";
    if (isHandleSlot && projectHandle) {
      text = projectHandle;
    } else {
      text = tailBodyLines[tailIdx++] ?? "";
    }
    if (!text.trim()) continue;
    pushDocAiRenderLayer(layers, ref, text, ref, {
      textBacking,
      textBackingColor,
      theme,
      avoidCenterSubject,
      projectHandle,
    });
  }

  layers.sort((a, b) => a.y_px - b.y_px || a.x_px - b.x_px);
  return normalizeDocAiRenderLayerFontSizes(layers, { textBacking, projectHandle });
}

/** Place LLM copy that did not fit any reference OCR box into stacked synthetic layers. */
function appendLeftoverLlmCopyAsSyntheticLayers(
  layers: MimicDocAiRenderTextLayer[],
  leftoverLines: string[],
  orderedRef: DocAiLayoutBlock[],
  opts: {
    textBacking: boolean;
    textBackingColor?: string | null;
    theme?: { ink: string; body: string };
    avoidCenterSubject?: boolean;
    projectHandle?: string | null;
  }
): void {
  const lines = leftoverLines.map((l) => sanitizeMimicOverlayCopyText(l)).filter(Boolean);
  if (lines.length === 0) return;

  const bodyRefs = orderedRef.filter(
    (r) =>
      roleBucket(r.role) === "body" &&
      !isHandleTextBlock(r.role, r.ref_text) &&
      !isPreserveReferenceDecorText(r.ref_text, r)
  );
  const anchor =
    bodyRefs.length > 0
      ? [...bodyRefs].sort((a, b) => b.y - a.y || b.x - a.x)[0]!
      : [...orderedRef].sort((a, b) => b.y - a.y || b.x - a.x).find(
          (r) => !isPreserveReferenceDecorText(r.ref_text, r)
        ) ?? null;
  if (!anchor) return;

  let yNorm = clamp01(anchor.y + anchor.h + 0.02);
  for (const line of lines) {
    const bbox = {
      x: anchor.x,
      y: yNorm,
      w: Math.min(0.92 - anchor.x, Math.max(anchor.w, 0.55)),
      h: 0.08,
    };
    const ref: DocAiLayoutBlock = {
      ...anchor,
      text: line,
      ref_text: line,
      role: "body",
      x: bbox.x,
      y: bbox.y,
      w: bbox.w,
      h: bbox.h,
    };
    pushDocAiRenderLayer(layers, ref, line, bbox, {
      textBacking: opts.textBacking,
      textBackingColor: opts.textBackingColor,
      theme: opts.theme,
      forceSingleLine: true,
      avoidCenterSubject: opts.avoidCenterSubject,
      projectHandle: opts.projectHandle ?? null,
    });
    yNorm = clamp01(bbox.y + bbox.h + 0.02);
  }
}

/**
 * Map Document AI reference geometry to LLM copy as absolute px layers on the 1080×1350 canvas.
 * Puppeteer performs a second shrink-to-fit pass (see services/renderer/server.js).
 */
export function buildMimicDocAiRenderTextLayers(
  mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans">,
  slideIndex1Based: number,
  llmSlide: Record<string, unknown>,
  theme?: { ink: string; body: string },
  opts?: {
    projectHandle?: string | null;
    textBacking?: boolean;
    textBackingColor?: string | null;
    avoidCenterSubject?: boolean;
    totalSlides?: number;
  }
): MimicDocAiRenderTextLayer[] {
  const textBacking = Boolean(opts?.textBacking);
  const textBackingColor = opts?.textBackingColor;
  const avoidCenterSubject = Boolean(opts?.avoidCenterSubject);
  const resolved = resolveRefSlideWithLayoutBlocksForMimic(mimic, slideIndex1Based, {
    totalSlides: opts?.totalSlides,
  });
  if (!resolved || resolved.layoutBlocks.length === 0) {
    return buildSyntheticDocAiLayersFromLlmCopy(llmSlide, theme, {
      projectHandle: opts?.projectHandle ?? null,
      textBacking,
      textBackingColor,
      avoidCenterSubject,
    });
  }
  const { refSlide, layoutBlocks } = resolved;

  let orderedRef = orderDocAiBlocksForLlmCopyMapping(layoutBlocks);
  const refHandles = new Set<string>();
  for (const b of layoutBlocks) {
    if (isHandleTextBlock(b.role, b.ref_text)) {
      const h = formatInstagramHandleForCta(b.ref_text);
      if (h) refHandles.add(h);
    }
    for (const h of collectInstagramHandlesFromText(b.ref_text)) refHandles.add(h);
  }
  for (const h of referenceHandlesFromSlide(refSlide)) refHandles.add(h);
  for (const h of collectInstagramHandlesFromText(String(refSlide.on_screen_text_transcript ?? ""))) {
    refHandles.add(h);
  }
  for (const key of ["headline", "title", "body", "subtitle", "kicker"] as const) {
    for (const h of collectInstagramHandlesFromText(String(llmSlide[key] ?? ""))) refHandles.add(h);
  }
  const refHandlesArr = [...refHandles];
  const llmLines = expandLlmLinesForDocAiMapping(llmSlide, {
    referenceHandles: refHandlesArr,
    projectHandle: opts?.projectHandle ?? null,
    layoutHasHandleBlock: orderedRef.some((r) => isHandleTextBlock(r.role, r.ref_text)),
  });
  const directLines = orderedLlmTextBlockLines(llmSlide);
  const transcript = String(refSlide.on_screen_text_transcript ?? "").trim();
  let directCopy = buildDirectCopyAssignmentsByIndex(orderedRef, directLines);
  let useDirectMapping =
    directCopy.useDirect &&
    textBlocksPreferDirectMapping(orderedRef, directLines, llmLines) &&
    !directMappingSkewsListicleBodySlots(orderedRef, directLines);

  if (directLines.length > 0 && !useDirectMapping) {
    const shrunk = shrinkOrderedRefToTextBlockLines(orderedRef, directLines);
    if (shrunk) {
      orderedRef = orderDocAiBlocksForLlmCopyMapping(shrunk);
      directCopy = buildDirectCopyAssignmentsByIndex(orderedRef, directLines);
      useDirectMapping =
        directCopy.useDirect &&
        textBlocksPreferDirectMapping(orderedRef, directLines, llmLines) &&
        !directMappingSkewsListicleBodySlots(orderedRef, directLines);
    }
  }

  if (isListicleMotherTemplateBgLayout(orderedRef)) {
    const listicleLayers = buildListicleMotherTemplateBgLayers(
      orderedRef,
      llmSlide,
      llmLines,
      directLines,
      theme,
      {
        projectHandle: opts?.projectHandle ?? null,
        textBacking,
        textBackingColor,
        avoidCenterSubject,
      }
    );
    if (listicleLayers.length > 0) {
      return dedupeDocAiRenderLayersByNormalizedText(listicleLayers);
    }
  }

  const persistedSlots = parseCopySlotsFromSlide(refSlide);
  const copySlots = useDirectMapping ? [] : persistedSlots;

  if (copySlots.length === 0 && !useDirectMapping && directLines.length === 0) {
    const bodyOnly = orderedRef.filter(
      (r) =>
        !isPreserveReferenceDecorText(r.ref_text, r) &&
        !isHandleTextBlock(r.role, r.ref_text) &&
        roleBucket(r.role) !== "cta" &&
        !(roleBucket(r.role) === "headline" && r.y < 0.22)
    );
    const bodyStacksPreview = groupDocAiBlocksIntoVerticalStacks(bodyOnly);
    const totalBodyRefs = bodyOnly.length;
    const useStackRender =
      !orderedRefHasChatMockTitlePair(orderedRef) &&
      (bodyStacksPreview.length >= 2 || totalBodyRefs >= 4);

    if (useStackRender) {
      return dedupeDocAiRenderLayersByNormalizedText(
        buildMimicDocAiStackRenderLayers(orderedRef, llmLines, transcript, theme, {
          projectHandle: opts?.projectHandle ?? null,
          textBacking,
          textBackingColor,
          avoidCenterSubject,
        })
      );
    }
  }
  const preassignedFromSlots =
    copySlots.length > 0 && !useDirectMapping
      ? assignLlmCopyUsingCopySlots(orderedRef, copySlots, llmLines, directLines, { transcript })
      : null;
  const hasChatMockTitlePair = !preassignedFromSlots && !useDirectMapping && orderedRefHasChatMockTitlePair(orderedRef);
  const preassigned =
    preassignedFromSlots ??
    (hasChatMockTitlePair ? buildRefBlockCopyAssignments(orderedRef, llmLines, directLines) : null);
  const bodyQueue = [...llmLines.bodyLines];
  const hasHeadlineSlot = orderedRef.some((r) => roleBucket(r.role) === "headline");
  let headlinePending =
    !useDirectMapping &&
    directLines.length <= 1 &&
    llmLines.headline &&
    !hasHeadlineSlot &&
    llmLines.bodyLines.length === 0
      ? llmLines.headline
      : null;
  const projectHandle = opts?.projectHandle ? formatInstagramHandleForCta(opts.projectHandle) : null;
  const editableBodyRefs = orderedRef.filter(
    (r) =>
      roleBucket(r.role) === "body" &&
      !isHandleTextBlock(r.role, r.ref_text) &&
      !isPreserveReferenceDecorText(r.ref_text, r)
  );
  const soloBodyRef = !useDirectMapping && editableBodyRefs.length === 1;
  const soloBodyCopy = soloBodyRef
    ? llmLines.bodyLines.filter((l) => l.trim() && !looksLikeInstagramHandleText(l)).join("\n")
    : "";
  const layers: MimicDocAiRenderTextLayer[] = [];
  let headlinePrefixAssigned = false;
  const listicleDecorTitle = listicleDecorTitleFromLlmSlide(llmSlide, llmLines, directLines);

  for (let i = 0; i < orderedRef.length; i++) {
    const ref = orderedRef[i]!;
    const nextRef = orderedRef[i + 1] ?? null;
    const nextInStack =
      !useDirectMapping &&
      nextRef &&
      roleBucket(ref.role) !== "headline" &&
      !isHandleTextBlock(ref.role, ref.ref_text) &&
      docAiBlocksAdjacentInStack(ref, nextRef)
        ? nextRef
        : null;

    let text = "";
    if (isPreserveReferenceDecorText(ref.ref_text, ref)) {
      text = isListicleMotherDecorText(ref.ref_text)
        ? listicleDecorTitle || ref.ref_text.trim()
        : ref.ref_text.trim();
    } else if (useDirectMapping) {
      if (isHandleTextBlock(ref.role, ref.ref_text) && projectHandle) {
        text = projectHandle;
      } else {
        text = directCopy.assignments[i] ?? "";
        if (!text.trim()) continue;
      }
    } else if (
      !headlinePrefixAssigned &&
      llmLines.headline &&
      referenceTextMatchesLlmHeadline(ref.ref_text, llmLines.headline, ref)
    ) {
      text = llmLines.headline;
      headlinePrefixAssigned = true;
      headlinePending = null;
    } else if (preassigned) {
      text = preassigned[i] ?? "";
      if (!text.trim() && isHandleTextBlock(ref.role, ref.ref_text) && projectHandle) {
        text = projectHandle;
      }
    } else if (isHandleTextBlock(ref.role, ref.ref_text) && projectHandle) {
      text = projectHandle;
    } else if (isTemplateInstructionRefBlock(ref.ref_text)) {
      text = llmLines.headline ?? headlinePending ?? "";
      headlinePending = null;
    } else if (roleBucket(ref.role) === "headline") {
      text = llmLines.headline ?? bodyQueue.shift() ?? "";
      if (llmLines.headline) headlinePending = null;
    } else if (headlinePending && !isHandleTextBlock(ref.role, ref.ref_text)) {
      text = headlinePending;
      headlinePending = null;
    } else if (soloBodyRef && editableBodyRefs[0] === ref && soloBodyCopy) {
      text = soloBodyCopy;
      bodyQueue.length = 0;
    } else if (projectHandle && bodyQueue[0] && looksLikeInstagramHandleText(bodyQueue[0]!)) {
      text = projectHandle;
      bodyQueue.shift();
    } else {
      let candidate = bodyQueue.shift() ?? "";
      if (candidate && nextInStack) {
        const split = splitBodyLineForRefBlock(candidate, ref, nextInStack);
        text = split.current;
        if (split.remainder) bodyQueue.unshift(split.remainder);
      } else {
        text = candidate;
      }
    }

    if (projectHandle) {
      if (refHandlesArr.length > 0) {
        text = substituteReferenceHandlesInText(text, refHandlesArr, projectHandle);
      }
      if (looksLikeInstagramHandleText(text) || isHandleTextBlock(ref.role, ref.ref_text)) {
        text = projectHandle;
      }
    }
    if (!text.trim()) continue;

    const bucket = roleBucket(ref.role);
    const color = resolveMimicDocAiLayerColor({
      refColor:
        ref.color_hex ??
        (bucket === "headline" || bucket === "cta" ? theme?.ink : theme?.body) ??
        null,
      textBacking,
    });
    const fontWeight = cssFontWeight(ref.font_weight);
    const textAlign =
      ref.align && ref.align !== "unknown" ? ref.align : bucket === "cta" ? "center" : "left";
    const fontFamily = webFontFamilyFromDetected(ref.font_family);
    const skipCenterAvoid = docAiLayerSkipsCenterAvoid(ref, bucket);
    let renderBBox =
      avoidCenterSubject && !skipCenterAvoid
        ? nudgeBBoxAwayFromFullBleedSubjectZone(ref)
        : ref;
    const boxWPx = renderBBox.w * CAROUSEL_RENDER_WIDTH_PX;
    const boxHPx = renderBBox.h * CAROUSEL_RENDER_HEIGHT_PX;
    const singleLinePreview = textBacking
      ? preferSingleLineTextBackLayer(text, boxWPx)
      : bucket === "headline" && !text.includes("\n")
        ? true
        : shouldRenderDocAiLayerSingleLine(ref.ref_text, text, boxWPx, boxHPx);
    if (textBacking) {
      const estFont =
        ref.font_size_px != null && ref.font_size_px > 0
          ? clampDocAiTextBackFontSizePx(ref.font_size_px)
          : MIMIC_DOCAI_TEXT_BACK_BODY_FONT_PX;
      renderBBox = expandDocAiBoxForTextContent(renderBBox, text, estFont, singleLinePreview);
    }
    const px = docAiBBoxToRenderPx(renderBBox.x, renderBBox.y, renderBBox.w, renderBBox.h);
    const singleLine = singleLinePreview;
    const isHandleLayer = isMimicDocAiHandleLayer(ref.role ?? bucket, text, projectHandle);
    const styled = buildDocAiLayerCssStyle({
      px,
      text,
      refText: ref.ref_text,
      refFontPx:
        ref.font_size_px != null && ref.font_size_px > 0
          ? clampDocAiFontSizePx(ref.font_size_px)
          : ref.font_size_px,
      fontWeight,
      color,
      fontFamily,
      textAlign,
      singleLine,
      textBacking,
      textBackingColor,
      role: ref.role ?? bucket,
      projectHandle,
    });
    const fontSizePx = isHandleLayer
      ? clampDocAiFontSizePx(MIMIC_DOCAI_HANDLE_FONT_SIZE_PX)
      : styled.font_size_px;
    const cssStyle =
      fontSizePx === styled.font_size_px
        ? styled.css_style
        : styled.css_style.replace(/font-size:\d+px/, `font-size:${fontSizePx}px`);

    layers.push({
      text,
      role: ref.role ?? bucket,
      x_pct: pct01(renderBBox.x),
      y_pct: pct01(renderBBox.y),
      w_pct: pct01(renderBBox.w),
      h_pct: pct01(renderBBox.h),
      x_px: px.x,
      y_px: px.y,
      w_px: px.w,
      h_px: px.h,
      layout_mode: styled.layout_mode,
      layout_class: styled.layout_class,
      font_size_px: fontSizePx,
      ref_font_size_px: ref.font_size_px,
      font_weight: fontWeight,
      color_hex: color,
      text_align: textAlign,
      css_style: cssStyle,
      text_backing: textBacking,
      ref_x: ref.x,
      ref_y: ref.y,
      ref_w: ref.w,
      ref_h: ref.h,
      skip_center_avoid: skipCenterAvoid,
    });
  }

  const leftoverLines: string[] = [];
  if (headlinePending?.trim()) leftoverLines.push(headlinePending.trim());
  for (const line of bodyQueue) {
    const trimmed = String(line ?? "").trim();
    if (trimmed) leftoverLines.push(trimmed);
  }
  const shouldAppendLeftovers =
    leftoverLines.length > 0 &&
    (directLines.length > 0
      ? layers.length < directLines.length
      : !mimicDocAiLayersCoverLlmCopy(layers, llmSlide));
  if (shouldAppendLeftovers) {
    appendLeftoverLlmCopyAsSyntheticLayers(layers, leftoverLines, orderedRef, {
      textBacking,
      textBackingColor,
      theme,
      avoidCenterSubject,
      projectHandle: opts?.projectHandle ?? null,
    });
  }

  return dedupeDocAiRenderLayersByNormalizedText(
    consolidateDocAiRenderLayersInVerticalStacks(layers, orderedRef, {
      textBacking,
      textBackingColor,
      projectHandle: opts?.projectHandle ?? null,
    })
  );
}

function normalizeCopyChunkForLayerMatch(s: string): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** True when at least one LLM copy chunk appears on a rendered DocAI layer. */
export function mimicDocAiLayersCoverLlmCopy(
  layers: Pick<MimicDocAiRenderTextLayer, "text">[],
  llmSlide: Record<string, unknown>
): boolean {
  const lines = expandLlmLinesForDocAiMapping(llmSlide);
  const chunks = [lines.headline, ...lines.bodyLines]
    .map((c) => normalizeCopyChunkForLayerMatch(String(c ?? "")))
    .filter((c) => c.length >= 3);
  if (chunks.length === 0) return true;
  const layerTexts = layers
    .map((l) => normalizeCopyChunkForLayerMatch(l.text))
    .filter((t) => t.length >= 3);
  if (layerTexts.length === 0) return false;
  return chunks.some((chunk) => layerTexts.some((lt) => lt.includes(chunk) || chunk.includes(lt)));
}
