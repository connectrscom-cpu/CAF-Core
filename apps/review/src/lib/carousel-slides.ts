import { sanitizeMimicOverlayCopyText } from "../../../../src/domain/mimic-overlay-copy";

export type MimicTextBlock = {
  role: string;
  text: string;
};

export interface NormalizedSlide {
  index: number;
  type: "cover" | "body" | "cta";
  headline: string;
  body: string;
  handle: string;
  /** Per OCR/overlay box — preferred editor shape for mimic carousels. */
  text_blocks?: MimicTextBlock[];
  /** Flat copy lines (legacy); kept in sync with `text_blocks[].text`. */
  on_slide_lines?: string[];
  /** Optional microcopy / template slot fields (kicker, tag, note, etc.). */
  extras?: Record<string, string>;
}

/** Pixel overrides merged into `generated_output.render` for carousel rework + PNG render. */
export const CAROUSEL_TYPOGRAPHY_PAYLOAD_KEYS = [
  "carousel_headline_font_px",
  "carousel_body_font_px",
  "carousel_kicker_font_px",
  "carousel_cta_font_px",
  "carousel_handle_font_px",
] as const;

export type CarouselTypographyPayloadKey = (typeof CAROUSEL_TYPOGRAPHY_PAYLOAD_KEYS)[number];

/** Append reviewer typography to the slide JSON blob (alongside `slides` / deck shape). */
export function mergeCarouselTypographyIntoPayload(
  payload: CarouselSlidesPayload,
  fields: Partial<Record<CarouselTypographyPayloadKey, string>>
): void {
  for (const k of CAROUSEL_TYPOGRAPHY_PAYLOAD_KEYS) {
    const raw = fields[k]?.trim() ?? "";
    if (!raw) {
      delete (payload as Record<string, unknown>)[k];
      continue;
    }
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) (payload as Record<string, unknown>)[k] = Math.round(n);
    else delete (payload as Record<string, unknown>)[k];
  }
}

/** Build numeric typography patch for Core reprint / render APIs from edit-panel fields. */
export function buildCarouselRenderTypographyPatch(
  fontScale: string,
  pxFields: Partial<Record<CarouselTypographyPayloadKey, string>>
): Record<string, number> {
  const payload: CarouselSlidesPayload = {};
  const fs = Number(fontScale);
  if (Number.isFinite(fs) && fs > 0) payload.font_scale = Math.min(1.25, Math.max(0.75, fs));
  mergeCarouselTypographyIntoPayload(payload, {
    carousel_headline_font_px: pxFields.carousel_headline_font_px ?? "",
    carousel_body_font_px: pxFields.carousel_body_font_px ?? "",
    carousel_kicker_font_px: pxFields.carousel_kicker_font_px ?? "",
    carousel_cta_font_px: pxFields.carousel_cta_font_px ?? "",
    carousel_handle_font_px: pxFields.carousel_handle_font_px ?? "",
  });
  const patch: Record<string, number> = {};
  for (const k of CAROUSEL_TYPOGRAPHY_PAYLOAD_KEYS) {
    const v = (payload as Record<string, unknown>)[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) patch[k] = v;
  }
  if (typeof payload.font_scale === "number") patch.font_scale = payload.font_scale;
  return patch;
}

/** Read reviewer / persisted typography from Core job `generation_payload.generated_output.render`. */
export function readCarouselTypographyFromFullJob(fullJob: Record<string, unknown> | null | undefined): Record<
  CarouselTypographyPayloadKey,
  string
> {
  const empty = (): Record<CarouselTypographyPayloadKey, string> => ({
    carousel_headline_font_px: "",
    carousel_body_font_px: "",
    carousel_kicker_font_px: "",
    carousel_cta_font_px: "",
    carousel_handle_font_px: "",
  });
  if (!fullJob) return empty();
  const gp = fullJob.generation_payload as Record<string, unknown> | undefined;
  const gen = (gp?.generated_output as Record<string, unknown>) ?? {};
  const render = (gen.render as Record<string, unknown>) ?? {};
  const pick = (k: CarouselTypographyPayloadKey): string => {
    const v = render[k];
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return String(Math.round(v));
    if (typeof v === "string" && v.trim()) {
      const n = Number(v);
      return Number.isFinite(n) && n > 0 ? String(Math.round(n)) : "";
    }
    return "";
  };
  return {
    carousel_headline_font_px: pick("carousel_headline_font_px"),
    carousel_body_font_px: pick("carousel_body_font_px"),
    carousel_kicker_font_px: pick("carousel_kicker_font_px"),
    carousel_cta_font_px: pick("carousel_cta_font_px"),
    carousel_handle_font_px: pick("carousel_handle_font_px"),
  };
}

export interface CarouselSlidesPayload {
  carousel_headline_font_px?: number;
  carousel_body_font_px?: number;
  carousel_kicker_font_px?: number;
  carousel_cta_font_px?: number;
  carousel_handle_font_px?: number;
  font_scale?: number;
  cover_slide?: {
    headline?: string;
    title?: string;
    heading?: string;
    body?: string;
    text?: string;
    content?: string;
    [k: string]: unknown;
  };
  body_slides?: Array<{
    headline?: string;
    title?: string;
    heading?: string;
    body?: string;
    text?: string;
    content?: string;
    [k: string]: unknown;
  }>;
  cta_slide?: { body?: string; handle?: string; [k: string]: unknown };
  cover?: string;
  cover_subtitle?: string;
  intro_title?: string;
  cta_text?: string;
  cta_handle?: string;
  slides?: Array<{ [k: string]: unknown }>;
  [key: string]: unknown;
}

export function createSyntheticSlides(count: number): NormalizedSlide[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    type: "body" as const,
    headline: "",
    body: "",
    handle: "",
  }));
}

const HEADLINE_KEYS = [
  "headline",
  "title",
  "heading",
  "slide_headline",
  "slide headline",
  "hook",
  "hook_line",
  "slide_hook",
  "main_title",
  "hero",
  "Headline",
  "Title",
  "Heading",
];
const BODY_KEYS = [
  "body",
  "text",
  "content",
  "slide_body",
  "slide body",
  "caption",
  "subtitle",
  "main_copy",
  "slide_copy",
  "description",
  "supporting_copy",
  "deck",
  "Body",
  "Text",
  "Content",
];

const EXTRA_KEYS = [
  "kicker",
  "note",
  "tag",
  "badge",
  "eyebrow",
  "brand_word",
  // alternate naming used by some templates/packs
  "footer",
  "short_footer_line",
  "follow_line",
  "swipe_label",
  "end_label",
  "label_left",
  "label_right",
  "label_bottom",
  "panel_title",
  "panel_body",
  // UI alias some users expect; renderer templates generally use `site_bar`
  "bottom_bar_text",
  "site_bar",
  "site_bar_cta",
] as const;

function extrasFromSlideObject(o: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of EXTRA_KEYS) {
    const v = o[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

function handleFromSlideFields(body: string, existing: string): string {
  const h = existing.trim();
  if (h) return h;
  const m = body.match(/@([a-z0-9_.]{2,})/i);
  return m ? `@${m[1]}` : "";
}

function cleanOverlayCopy(raw: unknown): string {
  return sanitizeMimicOverlayCopyText(raw);
}

function looksLikeHandleLine(text: string): boolean {
  return /^@[a-z0-9_.]{2,}$/i.test(text.trim());
}

function isHeadlineRoleToken(role: string): boolean {
  return /headline|title|hook|cover|kicker|subheadline/i.test(role);
}

function rowsToMimicTextBlocks(rows: Record<string, unknown>[]): MimicTextBlock[] {
  return rows
    .map((r) => ({
      role: String(r.role ?? "body").trim().toLowerCase() || "body",
      text: cleanOverlayCopy(r.text),
    }))
    .filter((b) => b.text);
}

/** Human label for a mimic text block in the review editor (OCR role when available). */
export function mimicTextBlockEditorLabel(block: MimicTextBlock, index: number, total: number): string {
  if (block.role === "handle" || looksLikeHandleLine(block.text)) return "Handle";
  if (isHeadlineRoleToken(block.role)) return "Headline";
  const ocrRole = String(block.role ?? "body").trim().toLowerCase();
  if (ocrRole && ocrRole !== "body" && ocrRole !== "cta") {
    return ocrRole.charAt(0).toUpperCase() + ocrRole.slice(1);
  }
  return total <= 1 ? "On-slide text" : `Text block ${index + 1}`;
}

/** Derive headline/body/on_slide_lines from ordered text blocks. */
export function mimicSlideFieldsFromTextBlocks(blocks: MimicTextBlock[]): {
  headline: string;
  body: string;
  on_slide_lines: string[];
} {
  const cleaned = blocks.map((b) => ({ ...b, text: b.text.trim() })).filter((b) => b.text);
  const on_slide_lines = cleaned.map((b) => b.text);
  const headline = cleaned
    .filter((b) => isHeadlineRoleToken(b.role))
    .map((b) => b.text)
    .join(" ")
    .trim();
  const body = cleaned
    .filter((b) => {
      const role = b.role.toLowerCase();
      return role !== "handle" && !isHeadlineRoleToken(role);
    })
    .map((b) => b.text)
    .join("\n")
    .trim();
  return { headline, body, on_slide_lines };
}

/** Blocks to show in mimic review UI — one entry per overlay box / sentence line. */
export function resolveMimicTextBlocksForSlide(slide: NormalizedSlide): MimicTextBlock[] {
  if (slide.text_blocks?.length) {
    return slide.text_blocks.map((b) => ({ role: b.role || "body", text: b.text }));
  }
  if (slide.on_slide_lines?.length) {
    return slide.on_slide_lines.map((text, i) => {
      const t = text.trim();
      let role = "body";
      if (looksLikeHandleLine(t)) role = "handle";
      else if (i === 0 && slide.headline.trim() && t === slide.headline.trim()) role = "headline";
      else if (/headline|title|hook/i.test(String(slide.type))) role = i === 0 ? "headline" : "body";
      return { role, text: t };
    });
  }
  const blocks: MimicTextBlock[] = [];
  if (slide.headline.trim()) blocks.push({ role: "headline", text: slide.headline.trim() });
  for (const line of slide.body.split("\n").map((l) => l.trim()).filter(Boolean)) {
    blocks.push({ role: looksLikeHandleLine(line) ? "handle" : "body", text: line });
  }
  if (blocks.length === 0) blocks.push({ role: "body", text: "" });
  return blocks;
}

function asSlideRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
}

/** Document AI overlay boxes from mimic `visual_guideline` for one slide (1-based index). */
export function ocrTextBlocksFromVisualGuideline(
  visualGuideline: Record<string, unknown> | null | undefined,
  slideIndex1Based: number
): MimicTextBlock[] {
  if (!visualGuideline) return [];
  const slides = Array.isArray(visualGuideline.slides) ? visualGuideline.slides : [];
  if (slides.length === 0) return [];
  const match =
    slides.map((s) => asSlideRecord(s)).find((s) => s && Number(s.slide_index) === slideIndex1Based) ??
    asSlideRecord(slides[slideIndex1Based - 1]);
  if (!match) return [];
  const tb = Array.isArray(match.text_blocks) ? match.text_blocks : [];
  if (tb.length === 0) return [];
  return rowsToMimicTextBlocks(
    tb
      .map((item) => asSlideRecord(item))
      .filter(Boolean) as Record<string, unknown>[]
  );
}

/** Align slide copy to OCR box count/roles when `text_blocks[]` is missing or mismatched. */
export function enrichMimicSlideWithOcrBlocks(
  slide: NormalizedSlide,
  ocrBlocks: MimicTextBlock[]
): NormalizedSlide {
  if (ocrBlocks.length === 0) return slide;
  const existing = slide.text_blocks?.filter((b) => b.text.trim()) ?? [];
  if (existing.length === ocrBlocks.length && existing.length > 0) {
    return slide;
  }
  const copyLines = (
    slide.on_slide_lines?.map((l) => cleanOverlayCopy(l)).filter(Boolean) ??
    resolveMimicTextBlocksForSlide(slide)
      .map((b) => b.text.trim())
      .filter(Boolean)
  ).slice();
  if (slide.handle.trim() && !copyLines.some((l) => l === slide.handle.trim())) {
    copyLines.push(slide.handle.trim());
  }
  const text_blocks = ocrBlocks.map((ocr, i) => ({
    role: ocr.role || "body",
    text: copyLines[i]?.trim() || ocr.text || "",
  }));
  const fields = mimicSlideFieldsFromTextBlocks(text_blocks);
  const handleFromBlocks = text_blocks.find((b) => b.role === "handle" || looksLikeHandleLine(b.text))?.text;
  return {
    ...slide,
    text_blocks,
    on_slide_lines: fields.on_slide_lines,
    headline: fields.headline,
    body: fields.body,
    handle: handleFromBlocks?.trim() || slide.handle.trim(),
  };
}

export function enrichMimicSlidesFromVisualGuideline(
  slides: NormalizedSlide[],
  visualGuideline: Record<string, unknown> | null | undefined
): NormalizedSlide[] {
  if (!visualGuideline) return slides;
  return slides.map((slide, i) =>
    enrichMimicSlideWithOcrBlocks(slide, ocrTextBlocksFromVisualGuideline(visualGuideline, i + 1))
  );
}

/** Sync `text_blocks[]` from reviewer lines while preserving roles/metadata when counts match. */
export function syncSlideTextBlocksFromNormalized(
  base: Record<string, unknown>,
  slide: NormalizedSlide
): Record<string, unknown> {
  const editorBlocks = slide.text_blocks?.map((b) => ({
    role: b.role || "body",
    text: cleanOverlayCopy(b.text),
  })).filter((b) => b.text);

  const lines =
    editorBlocks?.map((b) => b.text) ??
    slide.on_slide_lines?.map((l) => cleanOverlayCopy(l)).filter(Boolean) ??
    slide.body
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  if (lines.length === 0) {
    const next = { ...base };
    next.headline = slide.headline.trim() || undefined;
    next.body = slide.body.trim() || undefined;
    if (slide.handle.trim()) next.handle = slide.handle.trim();
    else delete next.handle;
    return next;
  }

  const existingTb = Array.isArray(base.text_blocks) ? base.text_blocks : [];
  const existingRows = existingTb
    .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
    .filter(Boolean) as Record<string, unknown>[];

  const text_blocks =
    editorBlocks && editorBlocks.length > 0
      ? editorBlocks.map((b, i) => {
          const prev = existingRows[i];
          return { ...(prev ?? {}), role: b.role || String(prev?.role ?? "body"), text: b.text };
        })
      : lines.map((line, i) => {
          const prev = existingRows[i];
          const prevRole = String(prev?.role ?? "").trim().toLowerCase();
          let role = prevRole;
          if (!role) {
            if (looksLikeHandleLine(line)) role = "handle";
            else if (slide.headline.trim() && line === slide.headline.trim()) role = "headline";
            else role = "body";
          }
          return { ...(prev ?? {}), role, text: line };
        });

  const derived = mimicSlideFieldsFromTextBlocks(
    text_blocks.map((r) => ({
      role: String(r.role ?? "body"),
      text: cleanOverlayCopy(r.text),
    }))
  );

  const next: Record<string, unknown> = {
    ...base,
    text_blocks,
    headline: derived.headline || slide.headline.trim() || undefined,
    body: derived.body || slide.body.trim() || undefined,
  };
  if (slide.handle.trim()) next.handle = slide.handle.trim();
  else delete next.handle;
  return next;
}

function textFromSlideObject(o: Record<string, unknown>): {
  headline: string;
  body: string;
  on_slide_lines: string[];
  text_blocks: MimicTextBlock[];
} {
  const tb = Array.isArray(o.text_blocks) ? o.text_blocks : [];
  if (tb.length > 0) {
    const rows = tb
      .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : null))
      .filter(Boolean) as Record<string, unknown>[];
    const text_blocks = rowsToMimicTextBlocks(rows);
    const on_slide_lines = text_blocks.map((b) => b.text);
    const { headline, body } = mimicSlideFieldsFromTextBlocks(text_blocks);
    if (headline || body || on_slide_lines.length > 0) {
      return { headline, body, on_slide_lines, text_blocks };
    }
  }

  const headline = cleanOverlayCopy(HEADLINE_KEYS.map((k) => o[k]).find((v) => v != null && String(v).trim()));
  const body = cleanOverlayCopy(BODY_KEYS.map((k) => o[k]).find((v) => v != null && String(v).trim()));
  const on_slide_lines = [headline, ...body.split("\n").map((l) => l.trim()).filter(Boolean)].filter(Boolean);
  const text_blocks: MimicTextBlock[] = on_slide_lines.map((text, i) => ({
    role: looksLikeHandleLine(text) ? "handle" : i === 0 && headline && text === headline ? "headline" : "body",
    text,
  }));
  return { headline, body, on_slide_lines, text_blocks };
}

export function parseSlidesFromJson(json: string | undefined): {
  slides: NormalizedSlide[];
  raw: CarouselSlidesPayload | null;
} {
  if (!json?.trim()) return { slides: [], raw: null };
  try {
    let parsed: unknown = JSON.parse(json);
    if (typeof parsed === "string" && parsed.trim()) {
      try { parsed = JSON.parse(parsed); } catch { /* keep as string */ }
    }
    const slides: NormalizedSlide[] = [];
    let index = 0;

    const textFrom = textFromSlideObject;

    const slidesArray = Array.isArray(parsed) ? parsed : (parsed as CarouselSlidesPayload).slides;

    if (Array.isArray(slidesArray) && slidesArray.length > 0) {
      const raw: CarouselSlidesPayload = Array.isArray(parsed)
        ? ({ slides: slidesArray } as CarouselSlidesPayload)
        : (parsed as CarouselSlidesPayload);
      for (let i = 0; i < slidesArray.length; i++) {
        const s = slidesArray[i] as Record<string, unknown>;
        const { headline, body, on_slide_lines, text_blocks } = textFrom(s);
        const type = i === 0 ? "cover" : i === slidesArray.length - 1 ? "cta" : "body";
        const ex = extrasFromSlideObject(s);
        const handleRaw = String(s.handle ?? s.cta_handle ?? "");
        slides.push({
          index: index++,
          type,
          headline,
          body,
          handle: type === "cta" ? handleFromSlideFields(body, handleRaw) : handleRaw,
          ...(text_blocks.length > 0 ? { text_blocks, on_slide_lines } : {}),
          extras: Object.keys(ex).length ? ex : undefined,
        });
      }
      return { slides, raw };
    }

    const raw = parsed as CarouselSlidesPayload;
    const cover = (raw.cover_slide ?? {}) as Record<string, unknown>;
    const coverHeadline = (raw.cover as string) ?? (cover.headline ?? cover.title ?? cover.heading ?? raw.intro_title) ?? "";
    const coverBody = (raw.cover_subtitle as string) ?? (cover.body ?? cover.text ?? cover.content) ?? "";
    slides.push({ index: index++, type: "cover", headline: String(coverHeadline ?? ""), body: String(coverBody ?? ""), handle: "" });

    const bodySlides = Array.isArray(raw.body_slides) ? raw.body_slides : [];
    for (const s of bodySlides) {
      const obj = s as Record<string, unknown>;
      const { headline, body, on_slide_lines, text_blocks } = textFrom(obj);
      slides.push({
        index: index++,
        type: "body",
        headline,
        body,
        handle: "",
        ...(text_blocks.length > 0 ? { text_blocks, on_slide_lines } : {}),
      });
    }

    const cta = (raw.cta_slide ?? {}) as Record<string, unknown>;
    const ctaTf = textFrom(cta);
    const ctaBody = String((raw.cta_text as string) ?? ctaTf.body ?? cta.body ?? cta.text ?? "");
    const ctaHl = String(ctaTf.headline ?? "").trim();
    const ctaHandleRaw = String((raw.cta_handle as string) ?? (cta.handle as string) ?? "");
    slides.push({
      index: index++,
      type: "cta",
      headline: ctaHl,
      body: ctaBody,
      handle: handleFromSlideFields(ctaBody, ctaHandleRaw),
    });

    return { slides, raw };
  } catch {
    return { slides: [], raw: null };
  }
}


export function buildSlidesJson(slides: NormalizedSlide[], raw: CarouselSlidesPayload | null): CarouselSlidesPayload {
  const out: CarouselSlidesPayload = raw ? { ...raw } : {};
  const cover = slides.find((s) => s.type === "cover");
  const bodySlides = slides.filter((s) => s.type === "body");
  const cta = slides.find((s) => s.type === "cta");

  const mergeExtras = (base: Record<string, unknown>, extras: Record<string, string> | undefined): Record<string, unknown> => {
    if (!extras) return base;
    const next: Record<string, unknown> = { ...base };
    for (const [k, v] of Object.entries(extras)) {
      const t = String(v ?? "").trim();
      if (t) next[k] = t;
      else delete next[k];
    }
    return next;
  };

  if (cover) {
    out.cover_slide = syncSlideTextBlocksFromNormalized(
      mergeExtras(
        { ...(out.cover_slide ?? {}), headline: cover.headline || undefined, body: cover.body || undefined },
        cover.extras
      ) as Record<string, unknown>,
      cover
    );
    out.cover = cover.headline || undefined;
    out.cover_subtitle = cover.body || undefined;
    out.intro_title = cover.headline || undefined;
  }
  if (bodySlides.length) {
    out.body_slides = bodySlides.map((s) =>
      syncSlideTextBlocksFromNormalized(
        mergeExtras({ headline: s.headline || undefined, body: s.body || undefined }, s.extras) as Record<
          string,
          unknown
        >,
        s
      )
    );
  }
  if (cta) {
    const hl = cta.headline?.trim() ?? "";
    const bd = cta.body?.trim() ?? "";
    out.cta_slide = syncSlideTextBlocksFromNormalized(
      mergeExtras(
        {
          ...(out.cta_slide ?? {}),
          headline: hl || undefined,
          body: bd || undefined,
          handle: cta.handle?.trim() || undefined,
        },
        cta.extras
      ) as Record<string, unknown>,
      cta
    );
    // Root `cta_text`: large headline when split from body; else whole CTA line for legacy single-field decks.
    out.cta_text = hl || bd || undefined;
    out.cta_handle = cta.handle?.trim() || undefined;
  }

  // If the raw payload was already a flat `slides[]` deck, keep those objects in sync so extra
  // slot fields persist through the review → export flow.
  if (Array.isArray(out.slides) && out.slides.length === slides.length) {
    out.slides = out.slides.map((orig, i) => {
      const cur = slides[i]!;
      const base: Record<string, unknown> =
        orig && typeof orig === "object" && !Array.isArray(orig) ? { ...(orig as Record<string, unknown>) } : {};
      return syncSlideTextBlocksFromNormalized(
        mergeExtras(
          {
            ...base,
            headline: cur.headline || undefined,
            body: cur.body || undefined,
            ...(cur.handle?.trim() ? { handle: cur.handle.trim() } : {}),
          },
          cur.extras
        ) as Record<string, unknown>,
        cur
      );
    });
  }

  return out;
}
