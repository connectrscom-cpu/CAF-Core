import type { MimicMode } from "../domain/mimic-payload.js";

export function buildMimicImageFullPrompt(opts?: { onImageCopy?: string | null }): string {
  const copy = String(opts?.onImageCopy ?? "").trim();
  const parts = [
    "Recreate this image's visual design only: composition, layout, color grade, background, and decorative elements.",
    "Preserve framing, spacing, and design energy.",
    "Remove all original on-image text from the reference.",
  ];
  if (copy) {
    parts.push(
      `Replace on-image text with this new copy exactly (fresh wording — not paraphrase of the reference): """${copy.slice(0, 1200)}""".`
    );
  } else {
    parts.push(
      "Use placeholder lorem-style blocks for text regions — do not reproduce reference wording verbatim."
    );
  }
  parts.push(
    "Apply subtle visual variation — do not copy logos, brand marks, or recognizable faces verbatim."
  );
  return parts.join(" ");
}

export function buildMimicTemplateBackgroundPrompt(): string {
  return [
    "Remove all text and typography from this slide.",
    "Keep the background, gradients, borders, layout frame, and decorative elements exactly.",
    "Output a clean background plate suitable for overlaying new text in a carousel template.",
    "Do not add new subjects or logos.",
  ].join(" ");
}

export function buildMimicCarouselSlidePrompt(opts: {
  slideIndex: number;
  layoutTemplate?: string | null;
  visualDescription?: string | null;
  onImageCopy?: string | null;
}): string {
  const parts = [
    "Recreate this carousel slide exactly: same visual style, layout, typography placement, colors, spacing, and decorative framing as the reference.",
    "Remove all original on-image text from the reference before applying new copy.",
  ];
  const copy = String(opts.onImageCopy ?? "").trim();
  if (copy) {
    parts.push(
      `Replace on-slide text with this new copy only — twist the wording, keep the same design language and hierarchy (headline vs body): """${copy.slice(0, 1200)}""".`
    );
  } else {
    parts.push(
      "Leave text regions clean or use neutral placeholder blocks — do not reproduce reference wording verbatim."
    );
  }
  parts.push(
    "Do not redesign the slide. Preserve layout archetype and design energy; vary decorative details subtly without cloning logos or faces."
  );
  if (opts.layoutTemplate?.trim()) {
    parts.push(`Layout archetype: ${opts.layoutTemplate.trim()}.`);
  }
  if (opts.visualDescription?.trim()) {
    parts.push(`Visual content (adapt subtly): ${opts.visualDescription.trim().slice(0, 400)}.`);
  }
  parts.push(`Slide index context: ${opts.slideIndex}.`);
  return parts.join(" ");
}

export function mimicPromptForMode(
  mode: MimicMode,
  slide?: { index?: number; layout?: string; visual?: string; onImageCopy?: string | null }
): string {
  if (mode === "image_full") return buildMimicImageFullPrompt({ onImageCopy: slide?.onImageCopy });
  if (mode === "template_bg") return buildMimicTemplateBackgroundPrompt();
  return buildMimicCarouselSlidePrompt({
    slideIndex: slide?.index ?? 1,
    layoutTemplate: slide?.layout,
    visualDescription: slide?.visual,
    onImageCopy: slide?.onImageCopy,
  });
}
