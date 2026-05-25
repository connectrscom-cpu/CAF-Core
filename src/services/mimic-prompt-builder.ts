import type { MimicMode } from "../domain/mimic-payload.js";

// ─── Prompt Labs prompt names (keyed in prompt_labs_overrides) ───────────────
export const MIMIC_PROMPT_NAME_IMAGE_FULL = "RENDER__Mimic_Image_Full_v1";
export const MIMIC_PROMPT_NAME_TEMPLATE_BG = "RENDER__Mimic_Template_Background_v1";
export const MIMIC_PROMPT_NAME_CAROUSEL_SLIDE = "RENDER__Mimic_Carousel_Slide_Visual_v1";

export interface MimicPromptOverrides {
  image_full?: string | null;
  template_bg?: string | null;
  carousel_slide_visual?: string | null;
}

// ─── Default prompt text (code-defined baselines) ───────────────────────────

export const DEFAULT_MIMIC_IMAGE_FULL_PROMPT = [
  "Recreate this image's visual design only: composition, layout, color grade, background, and decorative elements.",
  "Preserve framing, spacing, and design energy.",
  "Remove all original on-image text from the reference.",
  "{{copy_instruction}}",
  "Apply subtle visual variation — do not copy logos, brand marks, or recognizable faces verbatim.",
].join(" ");

export const DEFAULT_MIMIC_TEMPLATE_BG_PROMPT = [
  "Remove all text and typography from this slide.",
  "Keep the background, gradients, borders, layout frame, and decorative elements exactly.",
  "Output a clean background plate suitable for overlaying new text in a carousel template.",
  "Output MUST be portrait or square orientation (4:5 or 1:1 aspect ratio) — never landscape or horizontal.",
  "Do not add new subjects or logos.",
  "{{consistency_instruction}}",
].join(" ");

export const DEFAULT_MIMIC_CAROUSEL_SLIDE_PROMPT = [
  "Recreate this carousel slide faithfully: match the visual style, layout, color palette, spacing, and decorative framing of the reference image.",
  "Output MUST be portrait or square orientation (4:5 or 1:1 aspect ratio) — never landscape or horizontal.",
  "Remove all original text from the reference.",
  "{{copy_instruction}}",
  "Do not add logos, brand marks, or recognizable faces.",
  "{{consistency_instruction}}",
  "{{layout_instruction}}",
  "{{visual_instruction}}",
].join(" ");

// ─── Interpolation helpers ──────────────────────────────────────────────────

function buildCopyInstructionForImageFull(copy: string): string {
  if (copy) {
    return `Replace on-image text with this new copy exactly (fresh wording — not paraphrase of the reference): """${copy.slice(0, 1200)}""".`;
  }
  return "Use placeholder lorem-style blocks for text regions — do not reproduce reference wording verbatim.";
}

function buildCopyInstructionForSlide(copy: string): string {
  if (!copy) return "Leave text areas empty or use neutral placeholder blocks.";
  const lines = copy.split(/\n{2,}/);
  const headline = lines[0]?.trim() ?? "";
  const body = lines.slice(1).join("\n").trim();
  if (headline && body) {
    return `Place this text on the slide using the same text hierarchy and positioning as the reference. Headline: """${headline.slice(0, 400)}""" Body: """${body.slice(0, 800)}""".`;
  }
  return `Place this text on the slide matching the reference text positioning: """${copy.slice(0, 1200)}""".`;
}

function interpolateMimicTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let out = template;
  for (const [key, value] of Object.entries(vars)) {
    out = out.replaceAll(`{{${key}}}`, value);
  }
  // Strip leftover empty placeholders
  out = out.replace(/\{\{[a-z_]+\}\}/g, "").replace(/\s{2,}/g, " ").trim();
  return out;
}

// ─── Public builders ────────────────────────────────────────────────────────

export function buildMimicImageFullPrompt(
  opts?: { onImageCopy?: string | null },
  overrides?: MimicPromptOverrides | null
): string {
  const copy = String(opts?.onImageCopy ?? "").trim();
  const template = overrides?.image_full?.trim() || DEFAULT_MIMIC_IMAGE_FULL_PROMPT;
  return interpolateMimicTemplate(template, {
    copy_instruction: buildCopyInstructionForImageFull(copy),
    on_image_copy: copy,
  });
}

export function buildMimicTemplateBackgroundPrompt(
  opts?: { consistencyHint?: string | null },
  overrides?: MimicPromptOverrides | null
): string {
  const consistencyInstruction = opts?.consistencyHint?.trim() || "";
  const template = overrides?.template_bg?.trim() || DEFAULT_MIMIC_TEMPLATE_BG_PROMPT;
  return interpolateMimicTemplate(template, {
    consistency_instruction: consistencyInstruction,
  });
}

export function buildMimicCarouselSlidePrompt(
  opts: {
    slideIndex: number;
    layoutTemplate?: string | null;
    visualDescription?: string | null;
    onImageCopy?: string | null;
    consistencyHint?: string | null;
  },
  overrides?: MimicPromptOverrides | null
): string {
  const copy = String(opts.onImageCopy ?? "").trim();
  const layoutInstruction = opts.layoutTemplate?.trim()
    ? `Layout style: ${opts.layoutTemplate.trim()}.`
    : "";
  const visualInstruction = opts.visualDescription?.trim()
    ? `Visual context: ${opts.visualDescription.trim().slice(0, 400)}.`
    : "";
  const consistencyInstruction = opts.consistencyHint?.trim() || "";
  const template = overrides?.carousel_slide_visual?.trim() || DEFAULT_MIMIC_CAROUSEL_SLIDE_PROMPT;
  return interpolateMimicTemplate(template, {
    copy_instruction: buildCopyInstructionForSlide(copy),
    on_image_copy: copy,
    layout_instruction: layoutInstruction,
    visual_instruction: visualInstruction,
    consistency_instruction: consistencyInstruction,
  });
}

export function mimicPromptForMode(
  mode: MimicMode,
  slide?: { index?: number; layout?: string; visual?: string; onImageCopy?: string | null; consistencyHint?: string | null },
  overrides?: MimicPromptOverrides | null
): string {
  if (mode === "image_full") return buildMimicImageFullPrompt({ onImageCopy: slide?.onImageCopy }, overrides);
  if (mode === "template_bg") return buildMimicTemplateBackgroundPrompt({ consistencyHint: slide?.consistencyHint }, overrides);
  return buildMimicCarouselSlidePrompt({
    slideIndex: slide?.index ?? 1,
    layoutTemplate: slide?.layout,
    visualDescription: slide?.visual,
    onImageCopy: slide?.onImageCopy,
    consistencyHint: slide?.consistencyHint,
  }, overrides);
}

