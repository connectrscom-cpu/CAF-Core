import type { MimicMode } from "../domain/mimic-payload.js";

export function buildMimicImageFullPrompt(): string {
  return [
    "Recreate this image with nearly identical composition, layout, color grade, and visual style.",
    "Preserve framing, spacing, and design energy.",
    "Apply only subtle visual variation — do not copy logos, brand marks, or recognizable faces verbatim.",
    "Keep the same hook-style visual pattern suitable for social media.",
  ].join(" ");
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
}): string {
  const parts = [
    "Recreate this carousel slide with nearly identical composition, palette, and visual style.",
    "Preserve layout archetype and design energy; vary details subtly without cloning logos or faces.",
  ];
  if (opts.layoutTemplate?.trim()) {
    parts.push(`Layout archetype: ${opts.layoutTemplate.trim()}.`);
  }
  if (opts.visualDescription?.trim()) {
    parts.push(`Visual content (adapt subtly): ${opts.visualDescription.trim().slice(0, 400)}.`);
  }
  parts.push(`Slide index context: ${opts.slideIndex}.`);
  return parts.join(" ");
}

export function mimicPromptForMode(mode: MimicMode, slide?: { index: number; layout?: string; visual?: string }): string {
  if (mode === "image_full") return buildMimicImageFullPrompt();
  if (mode === "template_bg") return buildMimicTemplateBackgroundPrompt();
  return buildMimicCarouselSlidePrompt({
    slideIndex: slide?.index ?? 1,
    layoutTemplate: slide?.layout,
    visualDescription: slide?.visual,
  });
}
