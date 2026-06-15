import type { NormalizedSlide } from "@/lib/carousel-slides";
import { mimicSlideFieldsFromTextBlocks, type MimicTextBlock } from "@/lib/carousel-slides";

export type MimicTemplateBgSlot = "cover" | "body" | "cta";

export function isMimicTemplateBgMode(mimicV1: Record<string, unknown> | null | undefined): boolean {
  return String(mimicV1?.mode ?? "").trim() === "template_bg";
}

/** Cover / listicle body / deck CTA slot for a 1-based output slide index. */
export function templateBgSlotForSlide(slideIndex1Based: number, totalSlides: number): MimicTemplateBgSlot {
  if (totalSlides <= 1) return "body";
  if (slideIndex1Based <= 1) return "cover";
  if (slideIndex1Based >= totalSlides) return "cta";
  return "body";
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
    return [
      { key: "headline", label: "CTA headline", role: "headline", text: headline },
      { key: "handle", label: "Handle", role: "handle", text: handle || body },
    ];
  }

  return [
    { key: "headline", label: "Headline", role: "headline", text: headline },
    { key: "body", label: "Body", role: "body", text: body },
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

  if (fieldKey === "headline") {
    next = { ...next, headline: text };
  } else if (fieldKey === "body") {
    next = { ...next, body: text };
  } else if (fieldKey === "subtitle") {
    next = {
      ...next,
      body: text,
      extras: { ...(next.extras ?? {}), cover_subtitle: text },
    };
  } else if (fieldKey === "handle") {
    next = {
      ...next,
      handle: text,
      ...(slot === "cta" ? { body: text } : {}),
    };
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
export function templateBgLlmSlideForDocAi(
  slideIndex1Based: number,
  totalSlides: number,
  rawLlmSlide: Record<string, unknown>
): Record<string, unknown> {
  const slot = templateBgSlotForSlide(slideIndex1Based, totalSlides);
  const headline = String(rawLlmSlide.headline ?? rawLlmSlide.title ?? "").trim();
  const body = String(rawLlmSlide.body ?? "").trim();
  const subtitle = String(
    rawLlmSlide.subtitle ?? rawLlmSlide.cover_subtitle ?? rawLlmSlide.kicker ?? ""
  ).trim();
  const cta = String(rawLlmSlide.cta ?? rawLlmSlide.cta_text ?? "").trim();
  const handle = String(rawLlmSlide.handle ?? rawLlmSlide.cta_handle ?? "").trim();

  if (slot === "cover") {
    return {
      ...rawLlmSlide,
      headline,
      title: headline,
      body: subtitle || (body && headline ? "" : body),
      cover_subtitle: subtitle || body,
      subtitle: subtitle || body,
    };
  }
  if (slot === "cta") {
    const ctaHeadline = cta || headline;
    const ctaBody = handle || body || subtitle;
    return {
      ...rawLlmSlide,
      headline: ctaHeadline,
      body: ctaBody,
      cta: ctaHeadline,
      cta_text: ctaHeadline,
      handle: ctaBody,
      cta_handle: ctaBody,
    };
  }
  return {
    ...rawLlmSlide,
    headline,
    body: body || subtitle,
  };
}
