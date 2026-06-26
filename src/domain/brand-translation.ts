/**
 * Brand Translation (`brand_execution_brief_v1`) — Layer C transformation.
 *
 * Maps the abstract intent of a reference (its Slide Intelligence + Why Analysis)
 * onto a specific brand's execution vocabulary. The hard invariant: the strategic
 * reason the reference works is held CONSTANT — only execution (symbols, imagery,
 * copy register) is remapped. Same intent → a castle for one brand, a blue
 * dashboard for another.
 *
 * Deterministic: symbol remapping uses the brand `symbol_map`; connotations with
 * no mapping are surfaced in `unmapped_connotations` for an LLM fallback at
 * generation. No LLM call happens here.
 */
import type { BrandProfileV1 } from "./brand-profile.js";
import { lookupSymbolExpression } from "./brand-profile.js";
import type { SlideIntelligenceBundleV1 } from "./slide-intelligence.js";

export const BRAND_EXECUTION_BRIEF_SCHEMA = "brand_execution_brief_v1" as const;

/** Where the brief lives when projected onto a job (inside `mimic_v1`). */
export const BRAND_EXECUTION_BRIEF_SLICE_KEY = "brand_execution_brief" as const;

export interface BrandTranslatedSymbol {
  element: string;
  original_connotations: string[];
  /** Brand expression for the first mapped connotation, or null when unmapped. */
  brand_expression: string | null;
  mapped: boolean;
}

export interface BrandSlideBrief {
  slide_index: number;
  /** Copied from SIL — the function this slide must keep performing. */
  preserved_function: string | null;
  preserved_mechanism: string | null;
  translated_symbols: BrandTranslatedSymbol[];
}

export interface BrandExecutionBriefV1 {
  schema_version: typeof BRAND_EXECUTION_BRIEF_SCHEMA;
  brand_name: string | null;
  /** INVARIANT: verbatim from why_analysis.strategic_thesis — must not be changed. */
  strategic_thesis_preserved: string | null;
  dominant_mechanism_preserved: string | null;
  visual_style: string | null;
  tone: string | null;
  palette: string[];
  slides: BrandSlideBrief[];
  /** Connotations with no brand mapping — LLM should invent brand-appropriate execution. */
  unmapped_connotations: string[];
}

/**
 * Build a brand execution brief from reference intelligence + a brand profile.
 * Returns null when either input is missing.
 */
export function buildBrandExecutionBrief(
  bundle: SlideIntelligenceBundleV1 | null | undefined,
  profile: BrandProfileV1 | null | undefined
): BrandExecutionBriefV1 | null {
  if (!bundle || !profile) return null;

  const unmapped = new Set<string>();

  const slides: BrandSlideBrief[] = bundle.slides.map((s) => {
    const translated: BrandTranslatedSymbol[] = s.symbolic_elements.map((sym) => {
      let brand_expression: string | null = null;
      for (const connotation of sym.connotations) {
        const hit = lookupSymbolExpression(profile, connotation);
        if (hit) {
          // First mapped connotation wins for the symbol's brand expression…
          if (!brand_expression) brand_expression = hit;
        } else if (connotation.trim()) {
          // …but every unmapped connotation is still surfaced for LLM fallback.
          unmapped.add(connotation.trim());
        }
      }
      return {
        element: sym.element,
        original_connotations: sym.connotations,
        brand_expression,
        mapped: brand_expression != null,
      };
    });

    const mechanism =
      [s.psychological_trigger, s.persuasion_mechanism, s.curiosity_mechanism]
        .filter((m): m is string => !!m && m.trim().length > 0)
        .join("; ") || null;

    return {
      slide_index: s.slide_index,
      preserved_function: s.narrative_function ?? s.slide_role,
      preserved_mechanism: mechanism,
      translated_symbols: translated,
    };
  });

  return {
    schema_version: BRAND_EXECUTION_BRIEF_SCHEMA,
    brand_name: profile.brand_name,
    strategic_thesis_preserved: bundle.why_analysis?.strategic_thesis ?? null,
    dominant_mechanism_preserved: bundle.why_analysis?.dominant_mechanism ?? null,
    visual_style: profile.visual_style,
    tone: profile.tone,
    palette: profile.palette,
    slides,
    unmapped_connotations: [...unmapped].slice(0, 24),
  };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

/** Tolerant reader for a projected brief (round-trip from `mimic_v1`). */
export function parseBrandExecutionBrief(raw: unknown): BrandExecutionBriefV1 | null {
  const rec = asRecord(raw);
  if (!rec || rec.schema_version !== BRAND_EXECUTION_BRIEF_SCHEMA) return null;
  return rec as unknown as BrandExecutionBriefV1;
}

/**
 * Prompt block instructing the LLM to keep the strategic thesis + mechanism while
 * adopting brand execution. Returns null when the brief carries no usable signal.
 */
export function buildBrandTranslationPromptBlock(
  brief: BrandExecutionBriefV1 | null | undefined,
  opts?: { maxSlides?: number }
): string | null {
  if (!brief) return null;
  const maxSlides = Math.max(1, opts?.maxSlides ?? 14);

  const header: string[] = [
    "Brand translation (Brand-Aware Why Mimic — keep the strategic FUNCTION, change only the execution to fit this brand):",
  ];
  if (brief.brand_name) header.push(`- Brand: ${brief.brand_name}`);
  if (brief.strategic_thesis_preserved)
    header.push(`- Strategic thesis (DO NOT change): ${brief.strategic_thesis_preserved}`);
  if (brief.dominant_mechanism_preserved)
    header.push(`- Keep mechanism: ${brief.dominant_mechanism_preserved}`);
  if (brief.visual_style) header.push(`- Visual style: ${brief.visual_style}`);
  if (brief.tone) header.push(`- Copy register: ${brief.tone}`);
  if (brief.palette.length) header.push(`- Palette: ${brief.palette.join(", ")}`);

  const symbolLines: string[] = [];
  for (const slide of brief.slides.slice(0, maxSlides)) {
    const mapped = slide.translated_symbols.filter((t) => t.mapped);
    if (mapped.length === 0) continue;
    const remaps = mapped
      .map((t) => `${t.element} → ${t.brand_expression}`)
      .join("; ");
    symbolLines.push(`  - Slide ${slide.slide_index}: ${remaps}`);
  }

  const parts = [...header];
  if (symbolLines.length > 0) {
    parts.push("Symbol remapping (use brand expression instead of the reference's symbol):", ...symbolLines);
  }
  if (brief.unmapped_connotations.length > 0) {
    parts.push(
      `For these intents with no brand mapping, invent brand-appropriate execution (do not reuse the reference's literal symbol): ${brief.unmapped_connotations.join(", ")}.`
    );
  }

  if (parts.length <= 1) return null;
  return parts.join("\n").trim();
}
