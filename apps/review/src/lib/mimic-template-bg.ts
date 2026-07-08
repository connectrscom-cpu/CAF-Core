import type { NormalizedSlide } from "@/lib/carousel-slides";
import { formatMimicProjectHandle, mimicSlideFieldsFromTextBlocks, type MimicTextBlock } from "@/lib/carousel-slides";
import {
  isListicleBodyInvertedLlmCopy,
  looksLikeInstagramHandleLine,
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

/** CTA handle on slide — project handle wins over LLM/OCR fragments like "@signand". */
export function resolveTemplateBgHandleDisplayText(
  slideHandle: string,
  mappedHandle: string,
  projectHandle: string
): string {
  const project = formatMimicProjectHandle(projectHandle);
  const fromSlide = formatMimicProjectHandle(slideHandle) || slideHandle.trim();
  const mapped = formatMimicProjectHandle(mappedHandle) || mappedHandle.trim();
  const norm = (h: string) => h.replace(/^@+/, "").toLowerCase();

  if (project) {
    const slideNorm = fromSlide ? norm(fromSlide) : "";
    const projectNorm = norm(project);
    if (!slideNorm || slideNorm === projectNorm || projectNorm.startsWith(slideNorm)) {
      return project;
    }
    return fromSlide;
  }

  if (fromSlide) return fromSlide;
  return mapped;
}

export function resolveMimicTemplateBgEditorFieldsForSlide(
  slide: NormalizedSlide,
  slideIndex1Based: number,
  totalSlides: number,
  projectHandle?: string
): MimicTemplateBgEditorField[] {
  const fields = resolveMimicTemplateBgEditorFields(slide, slideIndex1Based, totalSlides);
  if (!projectHandle?.trim()) return fields;
  return fields.map((f) =>
    f.role === "handle"
      ? { ...f, text: resolveTemplateBgHandleDisplayText(slide.handle, f.text, projectHandle) }
      : f
  );
}

/** Pull substantive CTA body copy from slide rows / blocks when top-level body is empty. */
function resolveCtaSlideBodySource(slide: NormalizedSlide, headline: string, handle: string): string {
  let body = slide.body.trim();
  if (body) return body;

  if (slide.text_blocks?.length) {
    const fromBlocks = slide.text_blocks
      .filter((b) => {
        const role = b.role.toLowerCase();
        return role === "body" || role === "subtitle" || role === "cta";
      })
      .map((b) => b.text.trim())
      .filter((t) => t && !looksLikeInstagramHandleLine(t) && t !== headline.trim());
    if (fromBlocks.length > 0) return fromBlocks.join("\n\n");
  }

  if (slide.on_slide_lines?.length) {
    const hl = headline.trim();
    const h = handle.trim();
    const lines = slide.on_slide_lines.map((l) => l.trim()).filter(Boolean);
    const middle = lines.filter((l) => l !== hl && l !== h && !looksLikeInstagramHandleLine(l));
    if (middle.length > 0) return middle.join("\n");
  }

  return "";
}

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
    const fromBlocks = ctaEditorFieldsFromSlideBlocks(slide, handle);
    if (fromBlocks) return fromBlocks;

    const ctaText = String(slide.extras?.cta ?? slide.extras?.cta_text ?? "").trim();
    const ctaBody = resolveCtaSlideBodySource(slide, headline, handle);
    const mapped = resolveTemplateBgCtaOnScreenCopy({
      headline,
      body: ctaBody || body,
      cta: ctaText,
      handle,
      kicker: String(slide.extras?.kicker ?? "").trim(),
      slide_title: String(slide.extras?.slide_title ?? "").trim(),
    });
    if (mapped.listicle_style) {
      let title = mapped.headline;
      let message = mapped.body;
      if (title === message && message.length > 60) {
        const shortTitle =
          (ctaText && ctaText !== message ? ctaText : "") ||
          (headline && headline !== message ? headline : "") ||
          (message.includes("\n") ? message.split("\n")[0]!.trim() : "");
        if (shortTitle && shortTitle !== message) title = shortTitle;
      }
      const fields: MimicTemplateBgEditorField[] = [
        { key: "headline", label: "CTA title", role: "headline", text: title },
        { key: "body", label: "CTA message", role: "body", text: message },
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

/** Stable CTA editor fields from persisted text_blocks (skips LLM re-mapping after user edits). */
export function ctaEditorFieldsFromSlideBlocks(
  slide: NormalizedSlide,
  handle: string
): MimicTemplateBgEditorField[] | null {
  const blocks = slide.text_blocks ?? [];
  const headlineText = blocks.find((b) => b.role === "headline")?.text?.trim() ?? "";
  const bodyText =
    blocks
      .find((b) => {
        const role = b.role.toLowerCase();
        return role === "body" || role === "subtitle" || role === "cta";
      })
      ?.text?.trim() ?? "";
  const handleText = blocks.find((b) => b.role === "handle")?.text?.trim() ?? handle.trim();
  if (!headlineText && !bodyText) return null;

  const fields: MimicTemplateBgEditorField[] = [];
  if (headlineText) {
    fields.push({ key: "headline", label: "CTA title", role: "headline", text: headlineText });
  }
  if (bodyText) {
    fields.push({ key: "body", label: "CTA message", role: "body", text: bodyText });
  }
  fields.push({ key: "handle", label: "Handle", role: "handle", text: handleText });
  return fields;
}

function buildCtaSlideFromEditedFields(
  slide: NormalizedSlide,
  title: string,
  bodyText: string,
  handleText: string
): NormalizedSlide {
  const text_blocks: MimicTextBlock[] = [];
  const t = title.trim();
  const b = bodyText.trim();
  const h = handleText.trim();
  if (t) text_blocks.push({ role: "headline", text: t });
  if (b) text_blocks.push({ role: "body", text: b });
  if (h) text_blocks.push({ role: "handle", text: h });
  return {
    ...slide,
    headline: t,
    body: b,
    handle: h,
    text_blocks,
    on_slide_lines: text_blocks.map((block) => block.text).filter(Boolean),
    extras: {
      ...(slide.extras ?? {}),
      ...(t ? { cta: t, cta_text: t } : {}),
    },
  };
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
    if (slot === "cta") {
      next = {
        ...next,
        headline: text,
        extras: { ...(next.extras ?? {}), cta: text, cta_text: text },
      };
    } else if (inverted) {
      next = { ...next, extras: { ...(next.extras ?? {}), slide_title: text } };
    } else {
      next = { ...next, headline: text };
    }
  } else if (fieldKey === "body") {
    if (slot === "cta") {
      next = { ...next, body: text };
    } else {
      next = inverted ? { ...next, headline: text } : { ...next, body: text };
    }
  } else if (fieldKey === "subtitle") {
    next = {
      ...next,
      body: text,
      extras: { ...(next.extras ?? {}), cover_subtitle: text },
    };
  } else if (fieldKey === "handle") {
    next = { ...next, handle: text };
  }

  if (slot === "cta") {
    return buildCtaSlideFromEditedFields(next, next.headline, next.body, next.handle);
  }

  const fields = resolveMimicTemplateBgEditorFields(next, slideIndex1Based, totalSlides);
  const text_blocks: MimicTextBlock[] = fields.map((f) => ({ role: f.role, text: f.text }));
  const derived = mimicSlideFieldsFromTextBlocks(text_blocks);
  const invertedAfter =
    slot === "body" &&
    isListicleBodyInvertedLlmCopy(
      next.headline.trim(),
      next.body.trim(),
      String(next.extras?.kicker ?? kicker).trim()
    );

  if (invertedAfter) {
    return {
      ...next,
      text_blocks,
      on_slide_lines: fields.map((f) => f.text).filter((t) => t.length > 0),
    };
  }

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
  const bodyField = fields.find((f) => f.key === "body")?.text ?? "";
  const handleField = fields.find((f) => f.key === "handle")?.text ?? slide.handle;
  return {
    ...slide,
    text_blocks,
    on_slide_lines: derived.on_slide_lines,
    headline: fields.find((f) => f.key === "headline")?.text ?? derived.headline,
    body:
      slot === "cover"
        ? subtitle
        : slot === "cta"
          ? bodyField || derived.body
          : bodyField || derived.body,
    handle: handleField,
    ...(slot === "cover" && subtitle
      ? { extras: { ...(slide.extras ?? {}), cover_subtitle: subtitle } }
      : {}),
    ...(slot === "cta" && bodyField
      ? {
          extras: {
            ...(slide.extras ?? {}),
            ...(fields.find((f) => f.key === "headline")?.text
              ? { cta: fields.find((f) => f.key === "headline")!.text }
              : {}),
          },
        }
      : {}),
  };
}

export function normalizeMimicTemplateBgSlides(slides: NormalizedSlide[]): NormalizedSlide[] {
  const total = slides.length;
  return slides.map((slide, i) => normalizeMimicTemplateBgSlide(slide, i + 1, total));
}

/** LLM slide row scoped to cover / body / CTA slot for template_bg DocAI text mapping (matches Core pipeline). */
export { templateBgLlmSlideForDocAi } from "@caf-core-carousel/mimic-template-bg-copy";
