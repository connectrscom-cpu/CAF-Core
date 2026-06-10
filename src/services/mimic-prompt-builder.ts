import type { MimicMode } from "../domain/mimic-payload.js";
import {
  buildVisualVariantSimilarityInstruction,
  DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT,
} from "../domain/mimic-render-settings.js";

export interface MimicRenderPromptSettings {
  visualSimilarityPct?: number;
}

// ─── Prompt Labs prompt names (keyed in prompt_labs_overrides) ───────────────
export const MIMIC_PROMPT_NAME_IMAGE_FULL = "RENDER__Mimic_Image_Full_v1";
export const MIMIC_PROMPT_NAME_TEMPLATE_BG = "RENDER__Mimic_Template_Background_v1";
export const MIMIC_PROMPT_NAME_CAROUSEL_SLIDE = "RENDER__Mimic_Carousel_Slide_Visual_v1";
export const MIMIC_PROMPT_NAME_TEMPLATE_BG_COMPOSE = "RENDER__Mimic_Template_Bg_Compose_v1";

export interface MimicPromptOverrides {
  image_full?: string | null;
  template_bg?: string | null;
  carousel_slide_visual?: string | null;
  template_bg_compose?: string | null;
}

// ─── Default prompt text (code-defined baselines) ───────────────────────────

/** Temporary minimal Qwen instruction — text strip only; copy is composited via HBS later. */
export const DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT =
  "Remove all on-image text, typography, watermarks, and @handles. Keep everything else the same.";

/** @deprecated Long-form guard — restore when re-enabling rich mimic prompts. */
export const MIMIC_IMAGE_NO_ON_IMAGE_TEXT_RULE =
  "NEVER render readable text on the image: no words, letters, numbers, headlines, subheads, paragraphs, bullet lists, captions, lorem ipsum, placeholder copy, UI labels, CTA buttons with words, watermarks with text, or gibberish text blocks. Leave text regions as clean, low-detail areas only — all final copy is added later via HTML/CSS overlay.";

export const DEFAULT_MIMIC_IMAGE_FULL_PROMPT = DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT;
export const DEFAULT_MIMIC_TEMPLATE_BG_PROMPT = DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT;
export const DEFAULT_MIMIC_CAROUSEL_SLIDE_ART_ONLY_PROMPT = DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT;

/** @deprecated Image-model typography — prefer art-only + HBS overlay. Kept for Prompt Labs overrides. */
export const DEFAULT_MIMIC_CAROUSEL_SLIDE_PROMPT = DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT;

/** @deprecated Use buildVisualVariantSimilarityInstruction() — kept for tests/docs. */
export const MIMIC_VISUAL_VARIANT_SIMILARITY_INSTRUCTION = buildVisualVariantSimilarityInstruction(
  DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT
);

function defaultTemplateBgComposeWithCopyPrompt(pct: number): string {
  return `${buildVisualVariantSimilarityInstruction(pct)} Replace all on-image text with this new copy (do not reproduce reference wording): {{copy_instruction}} {{consistency_instruction}} Render copy legibly with clear typography; match text hierarchy and placement from the reference. Single polished 4:5 slide output.`;
}

function defaultCarouselSlideWithCopyPrompt(pct: number): string {
  return `${buildVisualVariantSimilarityInstruction(pct)} {{layout_instruction}} {{visual_instruction}} {{consistency_instruction}} Replace all on-image text with this new copy (do not reproduce reference wording): {{copy_instruction}} {{handle_instruction}} Render copy legibly with clear typography; match text hierarchy and placement from the reference. Single polished 4:5 slide output.`;
}

/** @deprecated HBS overlay path — art-only plate extract. */
export const DEFAULT_MIMIC_TEMPLATE_BG_COMPOSE_PROMPT = DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT;

// ─── Interpolation helpers ──────────────────────────────────────────────────

function buildCopyInstructionForImageFull(copy: string): string {
  if (copy) {
    return `Replace on-image text with this new copy exactly (fresh wording — not paraphrase of the reference): """${copy.slice(0, 1200)}""".`;
  }
  return "Do not add any on-image text — leave text regions as clean visual space only.";
}

function buildCopyInstructionForSlide(copy: string): string {
  if (!copy) return "Keep on-image text minimal — use similar text layout/placement as the reference but do NOT reproduce the reference wording.";
  const lines = copy.split(/\n{2,}/);
  const headline = lines[0]?.trim() ?? "";
  const body = lines.slice(1).join("\n").trim();
  if (headline && body) {
    return `Render this exact new copy verbatim with legible typography and the same hierarchy/positioning as the reference. Headline: """${headline.slice(0, 400)}""" Body: """${body.slice(0, 800)}""".`;
  }
  return `Render this exact new copy verbatim, legibly, matching reference text positioning: """${copy.slice(0, 400)}""".`;
}

function buildCopyInstructionForCompose(copy: string): string {
  if (!copy) return "Leave the background clean — do not add any text.";
  const lines = copy.split(/\n{2,}/);
  const headline = lines[0]?.trim() ?? "";
  const body = lines.slice(1).join("\n").trim();
  if (headline && body) {
    return `Headline: """${headline.slice(0, 400)}""" Body text: """${body.slice(0, 1200)}""".`;
  }
  return `Text to place: """${copy.slice(0, 1200)}""".`;
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
  const template = overrides?.image_full?.trim() || DEFAULT_MIMIC_IMAGE_FULL_PROMPT;
  if (!overrides?.image_full?.trim()) return template;
  const copy = String(opts?.onImageCopy ?? "").trim();
  return interpolateMimicTemplate(template, {
    copy_instruction: buildCopyInstructionForImageFull(copy),
    on_image_copy: copy,
  });
}

export function buildMimicTemplateBackgroundPrompt(
  opts?: {
    consistencyHint?: string | null;
    layoutTemplate?: string | null;
    visualDescription?: string | null;
  },
  overrides?: MimicPromptOverrides | null
): string {
  const template = overrides?.template_bg?.trim() || DEFAULT_MIMIC_TEMPLATE_BG_PROMPT;
  if (!overrides?.template_bg?.trim()) return template;
  const consistencyInstruction = opts?.consistencyHint?.trim() || "";
  const layoutInstruction = opts?.layoutTemplate?.trim()
    ? `Reference layout: ${opts.layoutTemplate.trim()}.`
    : "";
  const visualInstruction = opts?.visualDescription?.trim()
    ? `Reference look: ${opts.visualDescription.trim().slice(0, 400)}.`
    : "";
  return interpolateMimicTemplate(template, {
    visual_instruction: [layoutInstruction, visualInstruction].filter(Boolean).join(" "),
    consistency_instruction: consistencyInstruction,
  });
}

function buildHandleInstruction(projectHandle: string | null | undefined): string {
  const handle = String(projectHandle ?? "").trim();
  if (!handle) {
    return "Do not add any @handle or watermark on the image.";
  }
  const normalized = handle.startsWith("@") ? handle : `@${handle}`;
  return `If you include a small corner handle, use exactly ${normalized} — never the reference creator's handle.`;
}

export function buildMimicCarouselSlideArtOnlyPrompt(
  opts: {
    slideIndex: number;
    layoutTemplate?: string | null;
    visualDescription?: string | null;
    safeZoneInstruction?: string | null;
    consistencyHint?: string | null;
    projectHandle?: string | null;
  },
  overrides?: MimicPromptOverrides | null
): string {
  const template = overrides?.carousel_slide_visual?.trim() || DEFAULT_MIMIC_CAROUSEL_SLIDE_ART_ONLY_PROMPT;
  if (!overrides?.carousel_slide_visual?.trim()) return template;
  const layoutInstruction = opts.layoutTemplate?.trim()
    ? `Layout style: ${opts.layoutTemplate.trim()}.`
    : "";
  const visualInstruction = opts.visualDescription?.trim()
    ? `Visual context: ${opts.visualDescription.trim().slice(0, 400)}.`
    : "";
  const consistencyInstruction = opts.consistencyHint?.trim() || "";
  const safeZoneInstruction = opts.safeZoneInstruction?.trim() || "";
  return interpolateMimicTemplate(template, {
    safe_zone_instruction: safeZoneInstruction,
    handle_instruction: buildHandleInstruction(opts.projectHandle),
    layout_instruction: layoutInstruction,
    visual_instruction: visualInstruction,
    consistency_instruction: consistencyInstruction,
    copy_instruction: "",
    intent_instruction: "",
    on_image_copy: "",
  });
}

export function buildMimicCarouselSlidePrompt(
  opts: {
    slideIndex: number;
    layoutTemplate?: string | null;
    visualDescription?: string | null;
    onImageCopy?: string | null;
    consistencyHint?: string | null;
    intentInstruction?: string | null;
    projectHandle?: string | null;
    artOnly?: boolean;
    safeZoneInstruction?: string | null;
    visualSimilarityPct?: number;
  },
  overrides?: MimicPromptOverrides | null
): string {
  if (opts.artOnly !== false) {
    return buildMimicCarouselSlideArtOnlyPrompt(
      {
        slideIndex: opts.slideIndex,
        layoutTemplate: opts.layoutTemplate,
        visualDescription: opts.visualDescription,
        safeZoneInstruction: opts.safeZoneInstruction,
        consistencyHint: opts.consistencyHint,
        projectHandle: opts.projectHandle,
      },
      overrides
    );
  }
  const copy = String(opts.onImageCopy ?? "").trim();
  const layoutInstruction = opts.layoutTemplate?.trim()
    ? `Layout style: ${opts.layoutTemplate.trim()}.`
    : "";
  const visualInstruction = opts.visualDescription?.trim()
    ? `Visual context: ${opts.visualDescription.trim().slice(0, 400)}.`
    : "";
  const consistencyInstruction = opts.consistencyHint?.trim() || "";
  const intentInstruction = opts.intentInstruction?.trim() || "";
  const similarityPct = opts.visualSimilarityPct ?? DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT;
  const template =
    overrides?.carousel_slide_visual?.trim() || defaultCarouselSlideWithCopyPrompt(similarityPct);
  return interpolateMimicTemplate(template, {
    copy_instruction: buildCopyInstructionForSlide(copy),
    on_image_copy: copy,
    handle_instruction: buildHandleInstruction(opts.projectHandle),
    layout_instruction: layoutInstruction,
    visual_instruction: visualInstruction,
    consistency_instruction: consistencyInstruction,
    intent_instruction: intentInstruction,
    safe_zone_instruction: opts.safeZoneInstruction?.trim() || "",
  });
}

export function buildMimicTemplateBgComposePrompt(
  opts: {
    onImageCopy?: string | null;
    consistencyHint?: string | null;
    visualSimilarityPct?: number;
  },
  overrides?: MimicPromptOverrides | null
): string {
  const custom = overrides?.template_bg_compose?.trim();
  const similarityPct = opts.visualSimilarityPct ?? DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT;
  const template = custom || defaultTemplateBgComposeWithCopyPrompt(similarityPct);
  const copy = String(opts.onImageCopy ?? "").trim();
  const consistencyInstruction = opts.consistencyHint?.trim() || "";
  if (!custom) {
    return interpolateMimicTemplate(template, {
      copy_instruction: buildCopyInstructionForCompose(copy),
      consistency_instruction: consistencyInstruction,
    });
  }
  return interpolateMimicTemplate(template, {
    copy_instruction: buildCopyInstructionForCompose(copy),
    consistency_instruction: consistencyInstruction,
  });
}

export function mimicPromptForMode(
  mode: MimicMode | "template_bg_compose",
  slide?: {
    index?: number;
    layout?: string;
    visual?: string;
    onImageCopy?: string | null;
    consistencyHint?: string | null;
    intentInstruction?: string | null;
    projectHandle?: string | null;
    artOnly?: boolean;
    safeZoneInstruction?: string | null;
    visualSimilarityPct?: number;
  },
  overrides?: MimicPromptOverrides | null,
  renderSettings?: MimicRenderPromptSettings | null
): string {
  const visualSimilarityPct =
    renderSettings?.visualSimilarityPct ?? slide?.visualSimilarityPct ?? DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT;
  if (mode === "image_full") return buildMimicImageFullPrompt({ onImageCopy: slide?.onImageCopy }, overrides);
  if (mode === "template_bg") {
    return buildMimicTemplateBackgroundPrompt(
      {
        consistencyHint: slide?.consistencyHint,
        layoutTemplate: slide?.layout,
        visualDescription: slide?.visual,
      },
      overrides
    );
  }
  if (mode === "template_bg_compose") {
    return buildMimicTemplateBgComposePrompt(
      {
        onImageCopy: slide?.onImageCopy,
        consistencyHint: slide?.consistencyHint,
        visualSimilarityPct,
      },
      overrides
    );
  }
  return buildMimicCarouselSlidePrompt(
    {
      slideIndex: slide?.index ?? 1,
      layoutTemplate: slide?.layout,
      visualDescription: slide?.visual,
      onImageCopy: slide?.onImageCopy,
      consistencyHint: slide?.consistencyHint,
      intentInstruction: slide?.intentInstruction,
      projectHandle: slide?.projectHandle,
      artOnly: slide?.artOnly,
      safeZoneInstruction: slide?.safeZoneInstruction,
      visualSimilarityPct,
    },
    overrides
  );
}

