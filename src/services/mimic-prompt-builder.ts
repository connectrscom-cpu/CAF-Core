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
    "Recreate this carousel slide faithfully: match the visual style, layout, color palette, spacing, and decorative framing of the reference image.",
    "Remove all original text from the reference.",
  ];
  const copy = String(opts.onImageCopy ?? "").trim();
  if (copy) {
    const lines = copy.split(/\n{2,}/);
    const headline = lines[0]?.trim() ?? "";
    const body = lines.slice(1).join("\n").trim();
    if (headline && body) {
      parts.push(
        `Place this text on the slide using the same text hierarchy and positioning as the reference. Headline: """${headline.slice(0, 400)}""" Body: """${body.slice(0, 800)}""".`
      );
    } else {
      parts.push(
        `Place this text on the slide matching the reference text positioning: """${copy.slice(0, 1200)}""".`
      );
    }
  } else {
    parts.push(
      "Leave text areas empty or use neutral placeholder blocks."
    );
  }
  parts.push("Do not add logos, brand marks, or recognizable faces.");
  if (opts.layoutTemplate?.trim()) {
    parts.push(`Layout style: ${opts.layoutTemplate.trim()}.`);
  }
  if (opts.visualDescription?.trim()) {
    parts.push(`Visual context: ${opts.visualDescription.trim().slice(0, 400)}.`);
  }
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
