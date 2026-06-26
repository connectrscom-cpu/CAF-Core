/**
 * template_bg listicle body slides often store the long paragraph in `headline`
 * and a short hook in `body`, while OCR geometry expects a short decor title
 * (e.g. "THE ARIES MOTHER") in the headline slot and the paragraph in body.
 */

export type TemplateBgBodyOnScreenCopy = {
  headline: string;
  body: string;
  /** True when LLM fields were remapped for on-screen slots. */
  inverted: boolean;
};

/** Derive zodiac-style decor title from kicker text ("Aries Mother Traits" → "THE ARIES MOTHER"). */
export function listicleDecorTitleFromKicker(kicker: string): string {
  const k = kicker.trim();
  if (!k) return "";
  const mother = k.match(/^([A-Za-z][A-Za-z'-]*)\s+Mother\b/i);
  if (mother) return `THE ${mother[1]!.toUpperCase()} MOTHER`;
  const mom = k.match(/\b([A-Za-z][A-Za-z'-]*)\s+mom\b/i);
  if (mom) return `THE ${mom[1]!.toUpperCase()} MOTHER`;
  return "";
}

/** Derive decor title from inverted paragraph copy ("The Aries Mom is…" → "THE ARIES MOTHER"). */
export function listicleDecorTitleFromParagraph(text: string): string {
  const t = text.trim();
  if (!t) return "";
  const mother = t.match(/^The\s+([A-Za-z][A-Za-z'-]*)\s+Mother\b/i);
  if (mother) return `THE ${mother[1]!.toUpperCase()} MOTHER`;
  const mom = t.match(/^The\s+([A-Za-z][A-Za-z'-]*)\s+Mom\b/i);
  if (mom) return `THE ${mom[1]!.toUpperCase()} MOTHER`;
  return "";
}

export function looksLikeInstagramHandleLine(text: string): boolean {
  return /^@[a-z0-9_.]{2,}$/i.test(text.trim());
}

/** Heuristic: LLM put the paragraph in `headline` and a short line in `body`. */
export function isListicleBodyInvertedLlmCopy(headline: string, body: string, kicker: string): boolean {
  const h = headline.trim();
  const b = body.trim();
  if (!h) return false;
  if (h.length > 100 && b.length < h.length * 0.65) return true;
  if (h.length > 60 && listicleDecorTitleFromKicker(kicker)) return true;
  if (h.length > 80 && (looksLikeInstagramHandleLine(b) || b.length < 80)) return true;
  return false;
}

export function resolveTemplateBgBodyOnScreenCopy(raw: {
  headline?: string;
  body?: string;
  kicker?: string;
  slide_title?: string;
}): TemplateBgBodyOnScreenCopy {
  const headline = String(raw.headline ?? "").trim();
  const body = String(raw.body ?? "").trim();
  const kicker = String(raw.kicker ?? "").trim();
  const slideTitle = String(raw.slide_title ?? "").trim();

  if (!isListicleBodyInvertedLlmCopy(headline, body, kicker)) {
    return { headline, body: body || kicker, inverted: false };
  }

  const decorTitle =
    slideTitle ||
    listicleDecorTitleFromKicker(kicker) ||
    listicleDecorTitleFromParagraph(headline) ||
    (headline.length <= 56 && !headline.includes("\n") ? headline : "");

  let bodyText = headline;
  if (body && !looksLikeInstagramHandleLine(body) && body !== decorTitle) {
    const hook = body.trim();
    if (hook && !bodyText.toLowerCase().includes(hook.slice(0, 32).toLowerCase())) {
      bodyText = `${hook}\n\n${bodyText}`;
    }
  }

  return {
    headline: decorTitle,
    body: bodyText,
    inverted: true,
  };
}

export type TemplateBgCtaOnScreenCopy = {
  headline: string;
  body: string;
  handle: string;
  /** Zodiac/listicle CTA with title + paragraph (vs simple follow + @handle). */
  listicle_style: boolean;
};

/** Map CTA slide LLM fields to on-screen headline / body / handle slots. */
export function resolveTemplateBgCtaOnScreenCopy(raw: {
  headline?: string;
  body?: string;
  cta?: string;
  cta_text?: string;
  handle?: string;
  cta_handle?: string;
  kicker?: string;
  slide_title?: string;
}): TemplateBgCtaOnScreenCopy {
  const headline = String(raw.headline ?? "").trim();
  const body = String(raw.body ?? "").trim();
  const cta = String(raw.cta ?? raw.cta_text ?? "").trim();
  const handle = String(raw.handle ?? raw.cta_handle ?? "").trim();
  const ctaHeadline = cta || headline;
  const bodyIsHandle = looksLikeInstagramHandleLine(body);
  const hasSubstantiveBody = body.length > 0 && !bodyIsHandle;

  if (hasSubstantiveBody) {
    const onScreen = resolveTemplateBgBodyOnScreenCopy({
      headline: ctaHeadline,
      body,
      kicker: String(raw.kicker ?? "").trim(),
      slide_title: String(raw.slide_title ?? "").trim(),
    });
    return {
      headline: onScreen.headline,
      body: onScreen.body,
      handle,
      listicle_style: true,
    };
  }

  return {
    headline: ctaHeadline,
    body: "",
    handle: handle || (bodyIsHandle ? body : ""),
    listicle_style: false,
  };
}

export type TemplateBgSlot = "cover" | "body" | "cta";

/** Cover / listicle body / deck CTA slot for a 1-based output slide index. */
export function templateBgSlotForSlideIndex(
  slideIndex1Based: number,
  totalSlides: number
): TemplateBgSlot {
  if (totalSlides <= 1) return "body";
  if (slideIndex1Based <= 1) return "cover";
  if (slideIndex1Based >= totalSlides) return "cta";
  return "body";
}

/**
 * Reference archive slide index for template_bg OCR geometry (cover / body / CTA).
 * Lightweight mirror of mimic-template-library slot mapping — avoids import cycles.
 */
export function templateBgReferenceSlideIndex(
  slot: TemplateBgSlot,
  referenceSlideCount: number
): number {
  const n = Math.max(1, Math.floor(referenceSlideCount) || 1);
  if (slot === "cover") return 1;
  if (slot === "cta") return n;
  return n >= 3 ? Math.ceil(n / 2) : Math.min(2, n);
}

/**
 * Collapse LLM slide rows to one headline + body (+ handle on CTA) for template_bg DocAI mapping.
 * Prevents per-sentence `text_blocks[]` from spawning one OCR box per line.
 */
export function templateBgLlmSlideForDocAi(
  slideIndex1Based: number,
  totalSlides: number,
  rawLlmSlide: Record<string, unknown>
): Record<string, unknown> {
  const slot = templateBgSlotForSlideIndex(slideIndex1Based, totalSlides);
  const headline = String(rawLlmSlide.headline ?? rawLlmSlide.title ?? "").trim();
  const body = String(rawLlmSlide.body ?? "").trim();
  const subtitle = String(
    rawLlmSlide.subtitle ?? rawLlmSlide.cover_subtitle ?? rawLlmSlide.kicker ?? ""
  ).trim();
  const handle = String(rawLlmSlide.handle ?? rawLlmSlide.cta_handle ?? "").trim();

  if (slot === "cover") {
    const coverBody = subtitle || body;
    const text_blocks = [
      ...(headline ? [{ role: "headline", text: headline }] : []),
      ...(coverBody ? [{ role: "body", text: coverBody }] : []),
    ];
    return {
      ...rawLlmSlide,
      headline,
      title: headline,
      body: coverBody,
      cover_subtitle: subtitle || body,
      subtitle: subtitle || body,
      ...(text_blocks.length > 0 ? { text_blocks } : {}),
    };
  }
  if (slot === "cta") {
    const ctaText = String(rawLlmSlide.cta ?? rawLlmSlide.cta_text ?? "").trim();
    const mapped = resolveTemplateBgCtaOnScreenCopy({
      headline,
      body,
      cta: ctaText,
      handle,
      kicker: String(rawLlmSlide.kicker ?? "").trim(),
      slide_title: String(rawLlmSlide.slide_title ?? "").trim(),
    });
    const ctaHeadline = ctaText || headline;
    if (mapped.listicle_style) {
      const text_blocks = [
        ...(mapped.headline ? [{ role: "headline", text: mapped.headline }] : []),
        ...(mapped.body ? [{ role: "body", text: mapped.body }] : []),
        ...(mapped.handle ? [{ role: "handle", text: mapped.handle }] : []),
      ];
      return {
        ...rawLlmSlide,
        headline: mapped.headline,
        body: mapped.body,
        cta: ctaHeadline,
        cta_text: ctaHeadline,
        handle: mapped.handle,
        cta_handle: mapped.handle,
        ...(text_blocks.length > 0 ? { text_blocks } : {}),
      };
    }
    const text_blocks = [
      ...(mapped.headline ? [{ role: "headline", text: mapped.headline }] : []),
      ...(mapped.handle ? [{ role: "handle", text: mapped.handle }] : []),
    ];
    return {
      ...rawLlmSlide,
      headline: mapped.headline,
      body: mapped.handle,
      cta: mapped.headline,
      cta_text: mapped.headline,
      handle: mapped.handle,
      cta_handle: mapped.handle,
      ...(text_blocks.length > 0 ? { text_blocks } : {}),
    };
  }
  const kicker = String(rawLlmSlide.kicker ?? "").trim();
  const slideTitle = String(rawLlmSlide.slide_title ?? "").trim();
  const onScreen = resolveTemplateBgBodyOnScreenCopy({
    headline,
    body,
    kicker: kicker || subtitle,
    slide_title: slideTitle,
  });
  const text_blocks = [
    ...(onScreen.headline ? [{ role: "headline", text: onScreen.headline }] : []),
    ...(onScreen.body ? [{ role: "body", text: onScreen.body }] : []),
  ];
  return {
    ...rawLlmSlide,
    headline: onScreen.headline,
    body: onScreen.body,
    ...(text_blocks.length > 0 ? { text_blocks } : {}),
  };
}
