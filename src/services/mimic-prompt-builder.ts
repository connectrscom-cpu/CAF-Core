import type { MimicMode } from "../domain/mimic-payload.js";
import {
  buildVisualVariantSimilarityInstruction,
  DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT,
  isBoldMimicVisualVariant,
  MIMIC_BOLD_VARIANT_SAME_COPY_INSTRUCTION,
} from "../domain/mimic-render-settings.js";

export interface MimicRenderPromptSettings {
  visualSimilarityPct?: number;
  /** Nemotron layout/visual/deck hints in art-only image prompts (default off). */
  includeStyleHints?: boolean;
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

/** Strip every readable glyph; copy is composited via HBS later. */
export const MIMIC_TEXT_REMOVAL_INSTRUCTION =
  "Remove ALL on-image text from this slide: every word, letter, number, headline, subhead, bullet, caption, watermark, UI label, and social @handle (e.g. @username). " +
  "Do not paraphrase or replace reference wording with new text — erase typography completely and leave former text regions as clean, low-detail visual space only. " +
  "All final copy will be added later via HTML/CSS overlay.";

/** Prompt Labs overrides that still bake copy onto Flux output — ignored for art-only pipeline. */
export function isFluxTextBakePromptOverride(template: string): boolean {
  const t = String(template ?? "");
  return (
    /Replace all on-image text with this new copy/i.test(t) ||
    /Render copy legibly/i.test(t) ||
    /\{\{on_image_copy\}\}/i.test(t) ||
    (/copy_instruction/i.test(t) && !/Remove ALL on-image text/i.test(t))
  );
}

/** Art-only plate extract: strip text first, then visual variant (similarity from project/env). */
export function buildArtOnlyVariantPrompt(visualSimilarityPct?: number): string {
  const pct = visualSimilarityPct ?? DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT;
  const variant = buildVisualVariantSimilarityInstruction(pct);
  if (isBoldMimicVisualVariant(pct)) {
    return [
      variant,
      "Create a fresh art-only background plate: new subject, scene, and composition inspired by the reference mood and slide role — not a reshoot or near-duplicate.",
      MIMIC_TEXT_REMOVAL_INSTRUCTION,
    ]
      .join(" ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }
  return `${MIMIC_TEXT_REMOVAL_INSTRUCTION} ${variant}`.replace(/\s{2,}/g, " ").trim();
}

/** Full-bleed carousel_visual: keep hero imagery centered like the reference. */
export const MIMIC_FULL_BLEED_CENTER_COMPOSITION_INSTRUCTION =
  "Keep the main subject and focal imagery centered in the frame: anchor hero visuals in the middle third horizontally and vertically, matching the reference composition. " +
  "Do not crop, shift, or push the central imagery off-center or toward the edges.";

/** Art-only full-bleed slide plate — variant + text strip; center lock only above bold-variant band. */
export function buildFullBleedArtOnlyVariantPrompt(visualSimilarityPct?: number): string {
  const pct = visualSimilarityPct ?? DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT;
  const base = buildArtOnlyVariantPrompt(pct);
  if (isBoldMimicVisualVariant(pct)) return base;
  return `${base} ${MIMIC_FULL_BLEED_CENTER_COMPOSITION_INSTRUCTION}`;
}

/** @deprecated Use buildArtOnlyVariantPrompt() — kept for tests and Prompt Labs baselines. */
export const DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT = buildArtOnlyVariantPrompt(
  DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT
);

/** @deprecated Long-form guard — restore when re-enabling rich mimic prompts. */
export const MIMIC_IMAGE_NO_ON_IMAGE_TEXT_RULE =
  "NEVER render readable text on the image: no words, letters, numbers, headlines, subheads, paragraphs, bullet lists, captions, lorem ipsum, placeholder copy, UI labels, CTA buttons with words, watermarks with text, or gibberish text blocks. Leave text regions as clean, low-detail areas only — all final copy is added later via HTML/CSS overlay.";

export const DEFAULT_MIMIC_IMAGE_FULL_PROMPT = DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT;
export const DEFAULT_MIMIC_TEMPLATE_BG_PROMPT = DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT;
export const DEFAULT_MIMIC_CAROUSEL_SLIDE_ART_ONLY_PROMPT = DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT;

/** Appended to every art-only image-model prompt (edit + t2i) unless explicitly opted out. */
export const MIMIC_IMAGE_ART_ONLY_HARD_GUARD =
  "CRITICAL: Output must contain ZERO readable text — no words, letters, numbers, logos, @handles, watermarks, captions, signs, UI labels, or gibberish. All copy is added later via HTML/CSS overlay only.";

/** Enforce art-only output on image-model prompts (Flux/BFL/OpenAI/NVIDIA/DashScope). */
export function finalizeMimicImageModelPrompt(
  prompt: string,
  opts?: { allowOnImageText?: boolean }
): string {
  const base = String(prompt ?? "").trim();
  if (!base) return MIMIC_IMAGE_ART_ONLY_HARD_GUARD;
  if (opts?.allowOnImageText) return base;
  if (base.includes("ZERO readable text")) return base;
  return `${base} ${MIMIC_IMAGE_ART_ONLY_HARD_GUARD}`.replace(/\s{2,}/g, " ").trim();
}

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
  const centerLock = isBoldMimicVisualVariant(pct) ? "" : `${MIMIC_FULL_BLEED_CENTER_COMPOSITION_INSTRUCTION} `;
  const sameCopyLead = isBoldMimicVisualVariant(pct) ? `${MIMIC_BOLD_VARIANT_SAME_COPY_INSTRUCTION} ` : "";
  return `${buildVisualVariantSimilarityInstruction(pct)} ${centerLock}${sameCopyLead}{{layout_instruction}} {{visual_instruction}} {{consistency_instruction}} Replace all on-image text with this new copy (do not reproduce reference wording): {{copy_instruction}} {{handle_instruction}} Render copy legibly with clear typography; match text hierarchy and placement from the reference. Single polished 4:5 slide output.`;
}

function appendFullBleedSlidePromptHints(
  base: string,
  opts: {
    safeZoneInstruction?: string | null;
    consistencyHint?: string | null;
    intentInstruction?: string | null;
  }
): string {
  return [base, opts.safeZoneInstruction, opts.consistencyHint, opts.intentInstruction]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

/** Fallback overlay margins when reference text-block geometry is unavailable. */
export function buildBoldVariantGenericOverlayHint(): string {
  return "";
}

/** Strip Nemotron copy leaks so the image model never sees reference wording. */
export function sanitizeVisualDescriptionForImagePrompt(raw: string | null | undefined): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  s = s.replace(
    /\b(body\s*text|headline|subhead|hook|caption|cta|on[-\s]?screen\s*text|overlay\s*copy)\s*:?\s*[^\n.]*/gi,
    ""
  );
  s = s.replace(/['"][^'"]{6,}['"]/g, "");
  s = s.replace(/\.\s*(\.|$)/g, ".");
  return s.replace(/\s{2,}/g, " ").trim().replace(/\.$/, "").slice(0, 300);
}

/** Soft reference cues for bold variants — inspired-by visuals only, never reference copy. */
export function buildBoldVariantVisualInspirationHint(
  visualDescription?: string | null,
  layoutTemplate?: string | null
): string {
  const parts: string[] = [];
  const visual = sanitizeVisualDescriptionForImagePrompt(visualDescription);
  const layout = String(layoutTemplate ?? "").trim();
  if (visual) {
    parts.push(
      `Visual mood and subject cues (reinterpret freely — new photo, not the same frame): ${visual}.`
    );
  }
  if (layout) {
    parts.push(`Slide format like the reference (${layout}) — new execution only.`);
  }
  return parts.join(" ");
}

/** Abstract slide role for bold variants — no reference-frame language. */
export function buildBoldVariantSlideRoleHint(slidePurpose: string | null | undefined): string {
  const role = String(slidePurpose ?? "").trim().toLowerCase();
  if (role === "cta") return "Call-to-action slide energy — strong visual punch, no on-image CTA text.";
  if (role === "hook") return "Hook/cover slide — bold attention-grabbing visual, no on-image headline.";
  if (role === "storytelling" || role === "content") {
    return "Content slide — narrative visual energy only, no on-image text blocks.";
  }
  return "Carousel slide — polished 4:5 social visual with no on-image typography.";
}

/** Deck-wide mood only — not per-slide layout or scene description from the reference. */
export function buildBoldVariantDeckMoodHint(
  deckAesthetic: string | null | undefined,
  deckConsistency: string | null | undefined
): string {
  const parts: string[] = [];
  const aesthetic = String(deckAesthetic ?? "").trim();
  const consistency = String(deckConsistency ?? "").trim();
  if (aesthetic) parts.push(`Series aesthetic mood (invent new scenes): ${aesthetic.slice(0, 200)}.`);
  if (consistency) parts.push(`Keep deck tone coherent but not identical frames: ${consistency.slice(0, 200)}.`);
  return parts.join(" ");
}

/** @deprecated HBS overlay path — art-only plate extract. */
export const DEFAULT_MIMIC_TEMPLATE_BG_COMPOSE_PROMPT = DEFAULT_MIMIC_TEXT_REMOVAL_PROMPT;

// ─── Interpolation helpers ──────────────────────────────────────────────────

function buildCopyInstructionForImageFull(_copy: string): string {
  return MIMIC_TEXT_REMOVAL_INSTRUCTION;
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
  opts?: { onImageCopy?: string | null; visualSimilarityPct?: number },
  overrides?: MimicPromptOverrides | null
): string {
  const override = overrides?.image_full?.trim();
  const template =
    override && !isFluxTextBakePromptOverride(override)
      ? override
      : buildArtOnlyVariantPrompt(opts?.visualSimilarityPct);
  if (!override || isFluxTextBakePromptOverride(override)) return template;
  return interpolateMimicTemplate(template, {
    copy_instruction: MIMIC_TEXT_REMOVAL_INSTRUCTION,
    on_image_copy: "",
  });
}

export function buildMimicTemplateBackgroundPrompt(
  opts?: {
    consistencyHint?: string | null;
    layoutTemplate?: string | null;
    visualDescription?: string | null;
    visualSimilarityPct?: number;
    deckAesthetic?: string | null;
    deckVisualConsistency?: string | null;
    includeStyleHints?: boolean;
  },
  overrides?: MimicPromptOverrides | null
): string {
  const pct = opts?.visualSimilarityPct ?? DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT;
  const bold = isBoldMimicVisualVariant(pct);
  const styleHints = opts?.includeStyleHints === true;
  const override = overrides?.template_bg?.trim();
  const template =
    override && !isFluxTextBakePromptOverride(override)
      ? override
      : buildArtOnlyVariantPrompt(opts?.visualSimilarityPct);
  if (!override || isFluxTextBakePromptOverride(override)) {
    if (!bold || !styleHints) return template;
    return appendFullBleedSlidePromptHints(template, {
      consistencyHint: buildBoldVariantDeckMoodHint(opts?.deckAesthetic, opts?.deckVisualConsistency),
    });
  }
  if (bold) {
    return interpolateMimicTemplate(template, {
      visual_instruction: styleHints
        ? buildBoldVariantDeckMoodHint(opts?.deckAesthetic, opts?.deckVisualConsistency)
        : "",
      consistency_instruction: "",
    });
  }
  if (!styleHints) {
    return interpolateMimicTemplate(template, {
      visual_instruction: "",
      consistency_instruction: "",
    });
  }
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

function buildHandleInstruction(_projectHandle: string | null | undefined): string {
  return "Never render @handles, watermarks, brand names, or any readable text on the image.";
}

export function buildMimicCarouselSlideArtOnlyPrompt(
  opts: {
    slideIndex: number;
    layoutTemplate?: string | null;
    visualDescription?: string | null;
    safeZoneInstruction?: string | null;
    consistencyHint?: string | null;
    intentInstruction?: string | null;
    projectHandle?: string | null;
    visualSimilarityPct?: number;
    slidePurpose?: string | null;
    deckAesthetic?: string | null;
    deckVisualConsistency?: string | null;
    includeStyleHints?: boolean;
  },
  overrides?: MimicPromptOverrides | null
): string {
  const pct = opts.visualSimilarityPct ?? DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT;
  const bold = isBoldMimicVisualVariant(pct);
  const styleHints = opts.includeStyleHints === true;
  const override = overrides?.carousel_slide_visual?.trim();
  const template =
    override && !isFluxTextBakePromptOverride(override)
      ? override
      : buildFullBleedArtOnlyVariantPrompt(opts.visualSimilarityPct);
  if (bold) {
    const styleExtras = styleHints
      ? [
          buildBoldVariantDeckMoodHint(opts.deckAesthetic, opts.deckVisualConsistency),
          buildBoldVariantVisualInspirationHint(opts.visualDescription, opts.layoutTemplate),
          buildBoldVariantSlideRoleHint(opts.slidePurpose),
        ]
          .filter(Boolean)
          .join(" ")
      : "";
    if (!override || isFluxTextBakePromptOverride(override)) {
      const base = template;
      return styleExtras ? `${base} ${styleExtras}`.replace(/\s{2,}/g, " ").trim() : base;
    }
    return interpolateMimicTemplate(template, {
      safe_zone_instruction: "",
      handle_instruction: buildHandleInstruction(opts.projectHandle),
      layout_instruction: "",
      visual_instruction: styleHints ? styleExtras : "",
      consistency_instruction: "",
      copy_instruction: MIMIC_TEXT_REMOVAL_INSTRUCTION,
      intent_instruction: "",
      on_image_copy: "",
    });
  }
  if (!override || isFluxTextBakePromptOverride(override)) {
    if (!styleHints) {
      return appendFullBleedSlidePromptHints(template, {
        safeZoneInstruction: opts.safeZoneInstruction,
      });
    }
    return appendFullBleedSlidePromptHints(template, opts);
  }
  const layoutInstruction = styleHints && opts.layoutTemplate?.trim()
    ? `Layout style: ${opts.layoutTemplate.trim()}.`
    : "";
  const visualInstruction = styleHints && opts.visualDescription?.trim()
    ? `Visual context: ${opts.visualDescription.trim().slice(0, 400)}.`
    : "";
  const consistencyInstruction = styleHints ? opts.consistencyHint?.trim() || "" : "";
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
    slidePurpose?: string | null;
    deckAesthetic?: string | null;
    deckVisualConsistency?: string | null;
    includeStyleHints?: boolean;
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
        intentInstruction: opts.intentInstruction,
        projectHandle: opts.projectHandle,
        visualSimilarityPct: opts.visualSimilarityPct,
        slidePurpose: opts.slidePurpose,
        deckAesthetic: opts.deckAesthetic,
        deckVisualConsistency: opts.deckVisualConsistency,
        includeStyleHints: opts.includeStyleHints,
      },
      overrides
    );
  }
  const copy = String(opts.onImageCopy ?? "").trim();
  const similarityPct = opts.visualSimilarityPct ?? DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT;
  const bold = isBoldMimicVisualVariant(similarityPct);
  const visualInstruction =
    !bold && opts.visualDescription?.trim()
      ? `Visual context: ${opts.visualDescription.trim().slice(0, 400)}.`
      : bold
        ? buildBoldVariantVisualInspirationHint(opts.visualDescription, opts.layoutTemplate) ||
          buildBoldVariantDeckMoodHint(opts.deckAesthetic, opts.deckVisualConsistency)
        : "";
  const layoutInstruction =
    !bold && opts.layoutTemplate?.trim() ? `Layout style: ${opts.layoutTemplate.trim()}.` : "";
  const consistencyInstruction = bold ? "" : opts.consistencyHint?.trim() || "";
  const intentInstruction = bold
    ? buildBoldVariantSlideRoleHint(opts.slidePurpose)
    : opts.intentInstruction?.trim() || "";
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
    safe_zone_instruction: bold
      ? buildBoldVariantGenericOverlayHint()
      : opts.safeZoneInstruction?.trim() || "",
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
    slidePurpose?: string | null;
    deckAesthetic?: string | null;
    deckVisualConsistency?: string | null;
  },
  overrides?: MimicPromptOverrides | null,
  renderSettings?: MimicRenderPromptSettings | null
): string {
  const visualSimilarityPct =
    renderSettings?.visualSimilarityPct ?? slide?.visualSimilarityPct ?? DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT;
  const includeStyleHints = renderSettings?.includeStyleHints === true;
  if (mode === "image_full") {
    return buildMimicImageFullPrompt(
      { onImageCopy: slide?.onImageCopy, visualSimilarityPct },
      overrides
    );
  }
  if (mode === "template_bg") {
    return buildMimicTemplateBackgroundPrompt(
      {
        consistencyHint: includeStyleHints ? slide?.consistencyHint : "",
        layoutTemplate: includeStyleHints ? slide?.layout : null,
        visualDescription: includeStyleHints ? slide?.visual : null,
        visualSimilarityPct,
        deckAesthetic: includeStyleHints ? slide?.deckAesthetic : null,
        deckVisualConsistency: includeStyleHints ? slide?.deckVisualConsistency : null,
        includeStyleHints,
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
      layoutTemplate: includeStyleHints ? slide?.layout : null,
      visualDescription: includeStyleHints ? slide?.visual : null,
      onImageCopy: slide?.onImageCopy,
      consistencyHint: includeStyleHints ? slide?.consistencyHint : "",
      intentInstruction: includeStyleHints ? slide?.intentInstruction : "",
      projectHandle: slide?.projectHandle,
      artOnly: slide?.artOnly,
      safeZoneInstruction: slide?.safeZoneInstruction,
      visualSimilarityPct,
      slidePurpose: includeStyleHints ? slide?.slidePurpose : null,
      deckAesthetic: includeStyleHints ? slide?.deckAesthetic : null,
      deckVisualConsistency: includeStyleHints ? slide?.deckVisualConsistency : null,
      includeStyleHints,
    },
    overrides
  );
}

