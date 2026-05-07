export interface NormalizedSlide {
  index: number;
  type: "cover" | "body" | "cta";
  headline: string;
  body: string;
  handle: string;
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

    const textFrom = (o: Record<string, unknown>) => {
      const headline = HEADLINE_KEYS.map((k) => o[k]).find((v) => v != null && String(v).trim());
      const body = BODY_KEYS.map((k) => o[k]).find((v) => v != null && String(v).trim());
      return { headline: String(headline ?? "").trim(), body: String(body ?? "").trim() };
    };

    const slidesArray = Array.isArray(parsed) ? parsed : (parsed as CarouselSlidesPayload).slides;

    if (Array.isArray(slidesArray) && slidesArray.length > 0) {
      const raw: CarouselSlidesPayload = Array.isArray(parsed)
        ? ({ slides: slidesArray } as CarouselSlidesPayload)
        : (parsed as CarouselSlidesPayload);
      for (let i = 0; i < slidesArray.length; i++) {
        const s = slidesArray[i] as Record<string, unknown>;
        const { headline, body } = textFrom(s);
        const type = i === 0 ? "cover" : i === slidesArray.length - 1 ? "cta" : "body";
        const ex = extrasFromSlideObject(s);
        const handleRaw = String(s.handle ?? s.cta_handle ?? "");
        slides.push({
          index: index++,
          type,
          headline,
          body,
          handle: type === "cta" ? handleFromSlideFields(body, handleRaw) : handleRaw,
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
      const { headline, body } = textFrom(obj);
      slides.push({ index: index++, type: "body", headline, body, handle: "" });
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
    out.cover_slide = mergeExtras(
      { ...(out.cover_slide ?? {}), headline: cover.headline || undefined, body: cover.body || undefined },
      cover.extras
    );
    out.cover = cover.headline || undefined;
    out.cover_subtitle = cover.body || undefined;
    out.intro_title = cover.headline || undefined;
  }
  if (bodySlides.length) {
    out.body_slides = bodySlides.map((s) =>
      mergeExtras({ headline: s.headline || undefined, body: s.body || undefined }, s.extras)
    );
  }
  if (cta) {
    const hl = cta.headline?.trim() ?? "";
    const bd = cta.body?.trim() ?? "";
    out.cta_slide = mergeExtras(
      {
        ...(out.cta_slide ?? {}),
        headline: hl || undefined,
        body: bd || undefined,
        handle: cta.handle?.trim() || undefined,
      },
      cta.extras
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
      base.headline = cur.headline || undefined;
      base.body = cur.body || undefined;
      if (cur.handle?.trim()) base.handle = cur.handle.trim();
      else delete base.handle;
      return mergeExtras(base, cur.extras);
    });
  }

  return out;
}
