import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import {
  deckUsesUnifiedBackgroundPlate,
  isListicleLikeFormatPattern,
  isTextOverlayDeckFromGuideline,
} from "../domain/mimic-text-heavy.js";

/** Default layout when no project pin matches — same cover/body/cta contract as most SNS templates. */
export const MIMIC_LAYOUT_TEMPLATE_DEFAULT = "carousel_notes_app_minimal";

/** Shared HBS for full-bleed mimic — runtime Document AI block positioning, no per-job template fork. */
export const MIMIC_FULL_BLEED_RENDER_TEMPLATE = "carousel_mimic_bg";

/** Built-in carousel layouts safe for mimic background injection (cover / body_slides / CTA shape). */
export const MIMIC_LAYOUT_BUILTIN_BASES = [
  "carousel_notes_app_minimal",
  "carousel_sns_bold_text",
  "carousel_sns_numbered_system",
  "carousel_sns_chat_story",
  "carousel_sns_educational_clean",
  "carousel_sns_cosmic_identity",
  "carousel_blue_handwriting_paper",
  "carousel_mimic_bg",
] as const;

const LAYOUT_RULES: { test: (hay: string, formatPattern: string) => boolean; bases: string[] }[] = [
  {
    test: (hay, fp) =>
      isListicleLikeFormatPattern(fp) || /numbered|listicle|educational|tips|steps/.test(hay),
    bases: ["carousel_sns_numbered_system", "carousel_sns_educational_clean", "carousel_notes_app_minimal"],
  },
  {
    test: (hay) => /chat|thread|dm|story|message|bubble/.test(hay),
    bases: ["carousel_sns_chat_story", "carousel_notes_app_minimal"],
  },
  {
    test: (hay) => /bold|stacked|banner|high.contrast/.test(hay),
    bases: ["carousel_sns_bold_text", "carousel_notes_app_minimal"],
  },
  {
    test: (hay) => /cosmic|zodiac|celestial|star|horoscope/.test(hay),
    bases: ["carousel_sns_cosmic_identity", "carousel_notes_app_minimal"],
  },
  {
    test: (hay) => /handwriting|paper|notebook|lined/.test(hay),
    bases: ["carousel_blue_handwriting_paper", "carousel_notes_app_minimal"],
  },
  {
    test: (_hay, _fp) => true,
    bases: [MIMIC_LAYOUT_TEMPLATE_DEFAULT, "carousel_sns_bold_text"],
  },
];

function normalizeTemplateBase(name: string): string {
  return name.replace(/\.hbs$/i, "").trim().toLowerCase();
}

function mimicGuidelineHaystack(mimic: MimicPayloadV1): { hay: string; formatPattern: string } {
  const vg = mimic.visual_guideline ?? {};
  const aes =
    vg.aesthetic_analysis_json && typeof vg.aesthetic_analysis_json === "object"
      ? (vg.aesthetic_analysis_json as Record<string, unknown>)
      : vg;
  const formatPattern = String(aes.format_pattern ?? vg.format_pattern ?? "").trim();
  const parts: string[] = [formatPattern.toLowerCase()];
  const dvs = vg.deck_visual_system;
  if (dvs && typeof dvs === "object") {
    for (const k of ["repeated_template", "overall_aesthetic", "motion_or_energy"] as const) {
      const v = String((dvs as Record<string, unknown>)[k] ?? "").trim();
      if (v) parts.push(v.toLowerCase());
    }
  }
  const mimicEval = aes.mimic_evaluation;
  if (mimicEval && typeof mimicEval === "object") {
    for (const k of ["mode_reason", "background_description"] as const) {
      const v = String((mimicEval as Record<string, unknown>)[k] ?? "").trim();
      if (v) parts.push(v.toLowerCase());
    }
  }
  if (isTextOverlayDeckFromGuideline(vg as Record<string, unknown>)) parts.push("text overlay");
  if (deckUsesUnifiedBackgroundPlate(vg as Record<string, unknown>)) parts.push("uniform backdrop");
  return { hay: parts.join(" "), formatPattern };
}

/**
 * Pick a project-approved (or built-in) carousel `.hbs` to fork for `template_bg` mimic render.
 * Intersects vision/format cues with `projectPinnedTemplates` when provided.
 */
export function pickMimicLayoutBaseTemplate(
  mimic: MimicPayloadV1,
  projectPinnedTemplates: string[]
): string {
  const pins = projectPinnedTemplates
    .map((t) => normalizeTemplateBase(t))
    .filter((t) => t.length > 0);
  const allowed = new Set(
    pins.length > 0
      ? pins.filter((t) =>
          MIMIC_LAYOUT_BUILTIN_BASES.some((b) => b === t) || t.startsWith("carousel_") || t.startsWith("mimic_")
        )
      : MIMIC_LAYOUT_BUILTIN_BASES.map((b) => b)
  );
  if (pins.length > 0) {
    for (const p of pins) allowed.add(p);
  }

  const { hay, formatPattern } = mimicGuidelineHaystack(mimic);
  for (const rule of LAYOUT_RULES) {
    if (!rule.test(hay, formatPattern)) continue;
    for (const base of rule.bases) {
      const norm = normalizeTemplateBase(base);
      if (allowed.has(norm)) return norm;
    }
  }
  const firstPin = pins.find((p) => allowed.has(p));
  if (firstPin) return firstPin;
  return MIMIC_LAYOUT_TEMPLATE_DEFAULT;
}

const SLIDE_BG_CSS = `
    /* mimic_bg_plate — extracted Qwen background as full-bleed slide layer */
    .slide{ position:relative; }
    .slide-bg{
      position:absolute;
      inset:0;
      z-index:0;
      background-size:cover;
      background-position:center;
      background-repeat:no-repeat;
    }
    .slide > .page,
    .slide > .inner,
    .slide > .frame,
    .slide > .wrap{
      position:relative;
      z-index:1;
    }
`;

const COVER_BG_SNIPPET = `{{#if background_image_url}}
    <div class="slide-bg" style="background-image:url('{{{background_image_url}}}');"></div>
    {{/if}}`;

const BODY_BG_SNIPPET = `{{#if ../background_image_url}}
    <div class="slide-bg" style="background-image:url('{{{../background_image_url}}}');"></div>
    {{/if}}`;

/** Inject optional full-bleed PNG background plates into any cover/body/cta carousel template. */
export function injectMimicBackgroundPlateSupport(source: string): string {
  let s = source
    .replace(/url\('\{\{background_image_url\}\}'\)/g, "url('{{{background_image_url}}}')")
    .replace(/url\('\{\{\.\.\/background_image_url\}\}'\)/g, "url('{{{../background_image_url}}}')");

  if (!s.includes(".slide-bg")) {
    if (s.includes("</style>")) {
      s = s.replace("</style>", `${SLIDE_BG_CSS}\n  </style>`);
    } else {
      s = `${SLIDE_BG_CSS}\n${s}`;
    }
  }

  s = s.replace(
    /(\{\{#each body_slides\}\}\s*\r?\n\s*<div class="slide[^"]*">)\s*\r?\n/g,
    (match, prefix) =>
      match.includes("slide-bg") || match.includes("background_image_url")
        ? match
        : `${prefix}\n    ${BODY_BG_SNIPPET}\n`
  );

  s = s.replace(
    /(<div class="slide[^"]*">)\s*\r?\n(\s*<div class="(?:page|inner|frame|wrap))/g,
    `$1\n    ${COVER_BG_SNIPPET}\n$2`
  );

  return s;
}
