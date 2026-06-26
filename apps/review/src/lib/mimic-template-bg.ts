import type { NormalizedSlide } from "@/lib/carousel-slides";
import { mimicSlideFieldsFromTextBlocks, type MimicTextBlock } from "@/lib/carousel-slides";
import {
  isListicleBodyInvertedLlmCopy,
  resolveTemplateBgBodyOnScreenCopy,
  resolveTemplateBgCtaOnScreenCopy,
  templateBgLlmSlideForDocAi,
  templateBgSlotForSlideIndex,
} from "@caf-core-carousel/mimic-template-bg-copy";

export type MimicTemplateBgSlot = "cover" | "body" | "cta";

export function isMimicTemplateBgMode(mimicV1: Record<string, unknown> | null | undefined): boolean {
  return String(mimicV1?.mode ?? "").trim() === "template_bg";
}

/** Cover / listicle body / deck CTA slot for a 1-based output slide index. */
export function templateBgSlotForSlide(slideIndex1Based: number, totalSlides: number): MimicTemplateBgSlot {
  return templateBgSlotForSlideIndex(slideIndex1Based, totalSlides);
}

/** All output slide indices (1-based) for a template_bg slot — middle slides share one background plate. */
export function templateBgSlideIndicesForSlot(slot: MimicTemplateBgSlot, totalSlides: number): number[] {
  if (totalSlides < 1) return [];
  if (totalSlides === 1) return slot === "body" ? [1] : [];
  if (slot === "cover") return [1];
  if (slot === "cta") return [totalSlides];
  if (totalSlides <= 2) return [];
  return Array.from({ length: totalSlides - 2 }, (_, i) => i + 2);
}

export type MimicTemplateBgEditorField = {
  key: "headline" | "body" | "subtitle" | "handle";
  label: string;
  role: MimicTextBlock["role"];
  text: string;
};

/** Listicle editor fields — headline + body (cover may add subtitle; CTA adds handle). */
export function resolveMimicTemplateBgEditorFields(
  slide: NormalizedSlide,
  slideIndex1Based: number,
  totalSlides: number
): MimicTemplateBgEditorField[] {
  const slot = templateBgSlotForSlide(slideIndex1Based, totalSlides);
  let headline = slide.headline.trim();
  let body = slide.body.trim();
  const handle = slide.handle.trim();

  if ((!headline || !body) && slide.text_blocks?.length) {
    const blocks = slide.text_blocks;
    if (!headline) {
      headline =
        blocks.find((b) => b.role === "headline" || /headline|title|hook/i.test(b.role))?.text?.trim() ??
        blocks[0]?.text?.trim() ??
        "";
    }
    if (!body) {
      const bodyBlocks = blocks.filter(
        (b) => b.role === "body" || b.role === "subtitle" || (!/headline|title|handle|cta/i.test(b.role) && b.text.trim())
      );
      body = bodyBlocks
        .map((b) => b.text.trim())
        .filter(Boolean)
        .join("\n\n");
    }
  }

  const subtitle = String(slide.extras?.cover_subtitle ?? "").trim() || (slot === "cover" ? body : "");

  if (slot === "cover") {
    const fields: MimicTemplateBgEditorField[] = [
      { key: "headline", label: "Headline", role: "headline", text: headline },
    ];
    fields.push({
      key: "subtitle",
      label: "Subtitle",
      role: "body",
      text: subtitle,
    });
    return fields;
  }

  if (slot === "cta") {
    const ctaText = String(slide.extras?.cta ?? "").trim();
    const mapped = resolveTemplateBgCtaOnScreenCopy({
      headline,
      body,
      cta: ctaText,
      handle,
      kicker: String(slide.extras?.kicker ?? "").trim(),
      slide_title: String(slide.extras?.slide_title ?? "").trim(),
    });
    if (mapped.listicle_style) {
      const fields: MimicTemplateBgEditorField[] = [
        { key: "headline", label: "Headline", role: "headline", text: mapped.headline },
        { key: "body", label: "Body", role: "body", text: mapped.body },
      ];
      if (mapped.handle) {
        fields.push({ key: "handle", label: "Handle", role: "handle", text: mapped.handle });
      }
      return fields;
    }
    return [
      { key: "headline", label: "CTA headline", role: "headline", text: mapped.headline },
      { key: "handle", label: "Handle", role: "handle", text: mapped.handle },
    ];
  }

  const kicker = String(slide.extras?.kicker ?? "").trim();
  const slideTitle = String(slide.extras?.slide_title ?? "").trim();
  const onScreen = resolveTemplateBgBodyOnScreenCopy({
    headline,
    body,
    kicker,
    slide_title: slideTitle,
  });
  if (onScreen.inverted) {
    return [
      { key: "headline", label: "Title", role: "headline", text: onScreen.headline },
      { key: "body", label: "Body", role: "body", text: onScreen.body },
    ];
  }

  return [
    { key: "headline", label: "Headline", role: "headline", text: onScreen.headline },
    { key: "body", label: "Body", role: "body", text: onScreen.body },
  ];
}

export function applyMimicTemplateBgFieldEdit(
  slide: NormalizedSlide,
  slideIndex1Based: number,
  totalSlides: number,
  fieldKey: MimicTemplateBgEditorField["key"],
  text: string
): NormalizedSlide {
  const slot = templateBgSlotForSlide(slideIndex1Based, totalSlides);
  let next: NormalizedSlide = { ...slide };
  const kicker = String(slide.extras?.kicker ?? "").trim();
  const inverted =
    slot === "body" &&
    isListicleBodyInvertedLlmCopy(slide.headline.trim(), slide.body.trim(), kicker);

  if (fieldKey === "headline") {
    next = inverted
      ? { ...next, extras: { ...(next.extras ?? {}), slide_title: text } }
      : { ...next, headline: text };
  } else if (fieldKey === "body") {
    next = inverted ? { ...next, headline: text } : { ...next, body: text };
  } else if (fieldKey === "subtitle") {
    next = {
      ...next,
      body: text,
      extras: { ...(next.extras ?? {}), cover_subtitle: text },
    };
  } else if (fieldKey === "handle") {
    next = { ...next, handle: text };
    if (slot === "cta") {
      const cta = resolveTemplateBgCtaOnScreenCopy({
        headline: next.headline,
        body: next.body,
        handle: text,
        kicker: String(next.extras?.kicker ?? "").trim(),
        slide_title: String(next.extras?.slide_title ?? "").trim(),
      });
      if (!cta.listicle_style) {
        next = { ...next, body: text };
      }
    }
  }

  const fields = resolveMimicTemplateBgEditorFields(next, slideIndex1Based, totalSlides);
  const text_blocks: MimicTextBlock[] = fields.map((f) => ({ role: f.role, text: f.text }));
  const derived = mimicSlideFieldsFromTextBlocks(text_blocks);
  return {
    ...next,
    text_blocks,
    on_slide_lines: derived.on_slide_lines,
    headline: derived.headline || next.headline,
    body: derived.body || next.body,
  };
}

/** Strip OCR-cluster text_blocks — template_bg copy is headline/body on the slide row. */
export function normalizeMimicTemplateBgSlide(
  slide: NormalizedSlide,
  slideIndex1Based: number,
  totalSlides: number
): NormalizedSlide {
  const fields = resolveMimicTemplateBgEditorFields(slide, slideIndex1Based, totalSlides);
  const text_blocks: MimicTextBlock[] = fields.map((f) => ({ role: f.role, text: f.text }));
  const derived = mimicSlideFieldsFromTextBlocks(text_blocks);
  const slot = templateBgSlotForSlide(slideIndex1Based, totalSlides);
  const subtitle = fields.find((f) => f.key === "subtitle")?.text ?? "";
  return {
    ...slide,
    text_blocks,
    on_slide_lines: derived.on_slide_lines,
    headline: fields.find((f) => f.key === "headline")?.text ?? derived.headline,
    body:
      slot === "cover"
        ? subtitle
        : fields.find((f) => f.key === "body")?.text ?? derived.body,
    handle: fields.find((f) => f.key === "handle")?.text ?? slide.handle,
    ...(slot === "cover" && subtitle
      ? { extras: { ...(slide.extras ?? {}), cover_subtitle: subtitle } }
      : {}),
  };
}

export function normalizeMimicTemplateBgSlides(slides: NormalizedSlide[]): NormalizedSlide[] {
  const total = slides.length;
  return slides.map((slide, i) => normalizeMimicTemplateBgSlide(slide, i + 1, total));
}

/** LLM slide row scoped to cover / body / CTA slot for template_bg DocAI text mapping (matches Core pipeline). */
export { templateBgLlmSlideForDocAi } from "@caf-core-carousel/mimic-template-bg-copy";
