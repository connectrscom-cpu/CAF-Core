export interface NormalizedSlide {
  index: number;
  type: "cover" | "body" | "cta";
  headline: string;
  body: string;
  handle: string;
}

export interface CarouselSlidesPayload {
  cover_slide?: { headline?: string; title?: string; heading?: string; body?: string; text?: string; content?: string };
  body_slides?: Array<{ headline?: string; title?: string; heading?: string; body?: string; text?: string; content?: string }>;
  cta_slide?: { body?: string; handle?: string };
  cover?: string;
  cover_subtitle?: string;
  intro_title?: string;
  cta_text?: string;
  cta_handle?: string;
  slides?: Array<{ headline?: string; title?: string; heading?: string; body?: string; text?: string; content?: string }>;
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
        slides.push({ index: index++, type, headline, body, handle: String(s.handle ?? s.cta_handle ?? "") });
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
    slides.push({ index: index++, type: "cta", headline: "", body: String((raw.cta_text as string) ?? cta.body ?? cta.text ?? ""), handle: String((raw.cta_handle as string) ?? (cta.handle as string) ?? "") });

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

  if (cover) {
    out.cover_slide = { headline: cover.headline || undefined, body: cover.body || undefined };
    out.cover = cover.headline || undefined;
    out.cover_subtitle = cover.body || undefined;
    out.intro_title = cover.headline || undefined;
  }
  if (bodySlides.length) {
    out.body_slides = bodySlides.map((s) => ({ headline: s.headline || undefined, body: s.body || undefined }));
  }
  if (cta) {
    out.cta_slide = { body: cta.body || undefined, handle: cta.handle || undefined };
    out.cta_text = cta.body || undefined;
    out.cta_handle = cta.handle || undefined;
  }
  return out;
}
