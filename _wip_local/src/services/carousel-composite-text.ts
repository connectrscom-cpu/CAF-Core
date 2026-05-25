/**
 * Word-wrap and SVG text blocks for carousel composite rendering.
 * Layout mirrors carousel_mimic_bg.hbs vertical stack inside padded page area.
 */

import type {
  CarouselCompositeLayoutSpec,
  CarouselCompositeSlideRole,
  CarouselCompositeTextStyle,
  CarouselCompositeTheme,
} from "../domain/carousel-composite-layout.js";

export function escapeXmlText(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Approximate avg char width as fraction of font size (Inter-like sans). */
function avgCharWidthFactor(fontSizePx: number, fontWeight: number): number {
  const base = fontWeight >= 700 ? 0.52 : 0.48;
  return base * (fontSizePx / 72);
}

export function wrapTextToLines(text: string, maxWidthPx: number, fontSizePx: number, fontWeight: number): string[] {
  const raw = String(text ?? "").trim();
  if (!raw) return [];
  const paragraphs = raw.split(/\r?\n/);
  const lines: string[] = [];
  const charW = avgCharWidthFactor(fontSizePx, fontWeight);
  const maxChars = Math.max(8, Math.floor(maxWidthPx / (fontSizePx * charW)));

  for (const para of paragraphs) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    let cur = "";
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (next.length > maxChars && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
  }
  return lines;
}

function shrinkFontToFit(
  text: string,
  style: CarouselCompositeTextStyle,
  maxWidthPx: number,
  maxHeightPx: number,
  minFontPx: number
): { fontSizePx: number; lines: string[] } {
  let size = style.fontSizePx;
  while (size >= minFontPx) {
    const lines = wrapTextToLines(text, maxWidthPx, size, style.fontWeight);
    const lineH = size * style.lineHeight;
    const totalH = lines.length * lineH;
    const longest = lines.reduce((m, l) => Math.max(m, l.length), 0);
    const estW = longest * size * avgCharWidthFactor(size, style.fontWeight);
    if (totalH <= maxHeightPx && estW <= maxWidthPx * 1.05) {
      return { fontSizePx: size, lines };
    }
    size -= 2;
  }
  const lines = wrapTextToLines(text, maxWidthPx, minFontPx, style.fontWeight);
  return { fontSizePx: minFontPx, lines };
}

export interface CompositeSlideTextInput {
  role: CarouselCompositeSlideRole;
  headline: string;
  body: string;
}

export function buildCompositeSlideSvgOverlay(
  layout: CarouselCompositeLayoutSpec,
  theme: CarouselCompositeTheme,
  input: CompositeSlideTextInput
): string {
  const roleSpec = layout.roles[input.role];
  const w = layout.canvas_width;
  const h = layout.canvas_height;
  const contentW = w - layout.padding_x * 2;
  const contentH = h - layout.padding_y * 2;
  const x = layout.padding_x;
  let y = layout.padding_y;

  const blocks: string[] = [];
  const shadow = layout.text_shadow_rgba;

  const addBlock = (
    lines: string[],
    fontSizePx: number,
    fontWeight: number,
    lineHeight: number,
    fill: string,
    letterSpacingEm?: number
  ) => {
    if (lines.length === 0) return;
    const lh = fontSizePx * lineHeight;
    const ls = letterSpacingEm != null ? ` letter-spacing="${letterSpacingEm}em"` : "";
    for (const line of lines) {
      blocks.push(
        `<text x="${x}" y="${y + fontSizePx}" font-family="${escapeXmlText(layout.font_family)}" font-size="${fontSizePx}" font-weight="${fontWeight}" fill="${fill}"${ls} style="text-shadow: 0 1px 12px ${shadow};">${escapeXmlText(line)}</text>`
      );
      y += lh;
    }
  };

  const headlineBudget = Math.floor(contentH * (input.role === "cta" ? 0.45 : 0.42));
  const bodyBudget = contentH - (y - layout.padding_y) - headlineBudget;

  if (input.headline.trim()) {
    const hs = roleSpec.headline;
    const fit = shrinkFontToFit(input.headline.trim(), hs, contentW, headlineBudget, Math.max(28, hs.fontSizePx - 24));
    addBlock(
      fit.lines,
      fit.fontSizePx,
      hs.fontWeight,
      hs.lineHeight,
      theme.ink,
      hs.letterSpacingEm
    );
    if (roleSpec.body.marginTopPx) y += roleSpec.body.marginTopPx;
  }

  if (input.body.trim()) {
    const bs = roleSpec.body;
    const remaining = layout.padding_y + contentH - y;
    const fit = shrinkFontToFit(input.body.trim(), bs, contentW, Math.max(remaining, bodyBudget), Math.max(22, bs.fontSizePx - 16));
    addBlock(fit.lines, fit.fontSizePx, bs.fontWeight, bs.lineHeight, theme.body);
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${blocks.join("")}</svg>`;
}

/** Extract headline/body for a slide from buildSlideRenderContext output. */
export function compositeTextFromRenderContext(
  ctx: Record<string, unknown>,
  slideIndex1Based: number,
  totalSlides: number
): CompositeSlideTextInput {
  const role =
    slideIndex1Based === 1
      ? "cover"
      : slideIndex1Based === totalSlides && totalSlides > 1
        ? "cta"
        : "body";

  if (role === "cover") {
    const cs = ctx.cover_slide as Record<string, unknown> | undefined;
    const headline = String(ctx.cover ?? cs?.headline ?? ctx.headline ?? "").trim();
    const body = String(ctx.cover_subtitle ?? cs?.body ?? ctx.body ?? "").trim();
    return { role, headline, body };
  }

  if (role === "cta") {
    const ctaSlide = ctx.cta_slide as Record<string, unknown> | undefined;
    const headline = String(ctx.cta_text ?? ctaSlide?.body ?? ctx.headline ?? "").trim();
    const sub = String(ctaSlide?.sub ?? ctx.cta_handle ?? ctx.body ?? "").trim();
    return { role, headline, body: sub };
  }

  const bodySlides = Array.isArray(ctx.body_slides) ? ctx.body_slides : [];
  const flatSlides = Array.isArray(ctx.slides) ? ctx.slides : [];
  const bodyIdx = slideIndex1Based - 2;
  const slide =
    (bodySlides[bodyIdx] as Record<string, unknown> | undefined) ??
    (flatSlides[slideIndex1Based - 1] as Record<string, unknown> | undefined) ??
    {};
  const headline = String(slide.headline ?? ctx.headline ?? "").trim();
  const body = String(slide.body ?? ctx.body ?? "").trim();
  return { role: "body", headline, body };
}
