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
