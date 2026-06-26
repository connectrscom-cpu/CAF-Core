/**
 * Why Mimic execution — role-driven slide plans and SIL-grounded image brief inputs.
 * Consumed at draft prep (before render) when `execution_mode === why_mimic`.
 */
import type { MimicMode, MimicPayloadV1, MimicSlidePlan } from "./mimic-payload.js";
import { pickMimicPayload } from "./mimic-payload.js";
import type { MimicSlideCopyLayoutForLlm } from "./mimic-carousel-package.js";
import { buildSlideCopyLayoutForLlmFromPayload } from "./mimic-job-grounding.js";
import {
  auditSlideIntelligenceWhyQuality,
  isSlideIntelligenceVisualDescriptionSufficient,
  isSlideIntelligenceWhyItWorksSufficient,
  type SlideIntelligenceTextQualityOpts,
} from "./mimic-slide-analysis-quality.js";
import { parseBrandExecutionBrief, type BrandExecutionBriefV1, type BrandSlideBrief } from "./brand-translation.js";
import {
  buildWhyMimicPromptBlock,
  parseSlideIntelligenceBundle,
  type SlideIntelligenceBundleV1,
  type SlideIntelligenceV1,
} from "./slide-intelligence.js";

export const MIMIC_EXECUTION_MODE_WHY = "why_mimic" as const;
export const MIMIC_EXECUTION_MODE_CLASSIC = "classic" as const;

export type MimicExecutionMode = typeof MIMIC_EXECUTION_MODE_WHY | typeof MIMIC_EXECUTION_MODE_CLASSIC;

export function isWhyMimicExecution(
  flowType: string,
  mimic?: Pick<MimicPayloadV1, "execution_mode"> | null
): boolean {
  const mode = String(mimic?.execution_mode ?? "").trim();
  if (mode === MIMIC_EXECUTION_MODE_WHY) return true;
  if (mode === MIMIC_EXECUTION_MODE_CLASSIC) return false;
  return (flowType ?? "").trim() === "FLOW_WHY_MIMIC_CAROUSEL";
}

/** Role-driven slide plans from SIL (output order follows intelligence, not 1:1 pixel lock). */
export function buildWhyMimicSlidePlansFromSil(
  bundle: SlideIntelligenceBundleV1,
  mode: MimicMode,
  referenceItemCount: number
): MimicSlidePlan[] {
  const render_mode = mode === "template_bg" ? "hbs" : "full_bleed";
  const refCap = Math.max(1, referenceItemCount);
  const slides = bundle.slides.length > 0 ? bundle.slides : [];
  if (slides.length === 0) return [];

  return slides.map((s, i) => {
    const slideIndex = s.slide_index > 0 ? s.slide_index : i + 1;
    const sourceIdx = s.source_slide_index ?? slideIndex;
    return {
      slide_index: slideIndex,
      render_mode,
      reference_index: Math.min(slideIndex, refCap),
      source_slide_index: sourceIdx > 0 ? sourceIdx : slideIndex,
    };
  });
}

export type WhyMimicFluxSlideInput = {
  slide_index: number;
  slide_role: string | null;
  narrative_function: string | null;
  psychological_trigger: string | null;
  persuasion_mechanism: string | null;
  curiosity_mechanism: string | null;
  attention_device: string | null;
  visual_role: string | null;
  emotion: string | null;
  why_it_works: string | null;
  visual_description: string | null;
  symbolic_elements: Array<{ element: string; connotations: string[] }>;
  deck_strategic_thesis: string | null;
  deck_dominant_mechanism: string | null;
  deck_narrative_spine: string[];
  brand_preserved_function: string | null;
  brand_preserved_mechanism: string | null;
  brand_visual_style: string | null;
  brand_tone: string | null;
  generated_headline: string | null;
  generated_body: string | null;
  safe_zone_hint: string;
};

function brandSlideBrief(
  brief: BrandExecutionBriefV1 | null | undefined,
  slideIndex: number
): BrandSlideBrief | null {
  if (!brief?.slides?.length) return null;
  return brief.slides.find((s) => s.slide_index === slideIndex) ?? null;
}

function silSlideForIndex(bundle: SlideIntelligenceBundleV1, slideIndex: number): SlideIntelligenceV1 | null {
  return bundle.slides.find((s) => s.slide_index === slideIndex) ?? bundle.slides[slideIndex - 1] ?? null;
}

function copyFromParsedSlide(slide: Record<string, unknown> | null | undefined): {
  headline: string | null;
  body: string | null;
} {
  if (!slide) return { headline: null, body: null };
  const headline = String(slide.headline ?? slide.title ?? "").trim() || null;
  const body = String(slide.body ?? slide.text ?? "").trim() || null;
  return { headline, body };
}

export function buildWhyMimicFluxSlideInput(
  bundle: SlideIntelligenceBundleV1,
  slideIndex1Based: number,
  opts?: {
    parsedSlide?: Record<string, unknown> | null;
    brandBrief?: BrandExecutionBriefV1 | null;
    safeZoneHint?: string;
  }
): WhyMimicFluxSlideInput | null {
  const sil = silSlideForIndex(bundle, slideIndex1Based);
  if (!sil) return null;

  const why = bundle.why_analysis;
  const brandSlide = brandSlideBrief(opts?.brandBrief ?? null, slideIndex1Based);
  const copy = copyFromParsedSlide(opts?.parsedSlide);

  return {
    slide_index: slideIndex1Based,
    slide_role: sil.slide_role,
    narrative_function: sil.narrative_function,
    psychological_trigger: sil.psychological_trigger,
    persuasion_mechanism: sil.persuasion_mechanism,
    curiosity_mechanism: sil.curiosity_mechanism,
    attention_device: sil.attention_device,
    visual_role: sil.visual_role,
    emotion: sil.emotion,
    why_it_works: sil.why_it_works,
    visual_description: sil.visual_description,
    symbolic_elements: sil.symbolic_elements.map((s) => ({
      element: s.element,
      connotations: s.connotations,
    })),
    deck_strategic_thesis: why?.strategic_thesis ?? null,
    deck_dominant_mechanism: why?.dominant_mechanism ?? null,
    deck_narrative_spine: why?.narrative_spine ?? [],
    brand_preserved_function: brandSlide?.preserved_function ?? null,
    brand_preserved_mechanism: brandSlide?.preserved_mechanism ?? null,
    brand_visual_style: opts?.brandBrief?.visual_style ?? null,
    brand_tone: opts?.brandBrief?.tone ?? null,
    generated_headline: copy.headline,
    generated_body: copy.body,
    safe_zone_hint: opts?.safeZoneHint ?? "",
  };
}

export function parseWhyMimicSlideIntelligenceFromMimic(
  mimic: MimicPayloadV1 | null | undefined
): SlideIntelligenceBundleV1 | null {
  return parseSlideIntelligenceBundle(mimic?.slide_intelligence);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s || null;
}

function layoutRowForIndex(
  layout: MimicSlideCopyLayoutForLlm[],
  slideIndex: number
): MimicSlideCopyLayoutForLlm | null {
  return layout.find((r) => r.slide_index === slideIndex) ?? layout[slideIndex - 1] ?? null;
}

function slidePlanForIndex(mimic: MimicPayloadV1, slideIndex: number): MimicSlidePlan | null {
  const plans = Array.isArray(mimic.slide_plans) ? mimic.slide_plans : [];
  return plans.find((p) => p.slide_index === slideIndex) ?? plans[slideIndex - 1] ?? null;
}

function fluxPromptForIndex(mimic: MimicPayloadV1, slideIndex: number): Record<string, unknown> | null {
  const prompts = asRecord(mimic.flux_image_prompts as unknown);
  if (!prompts) return null;
  const row = asRecord(prompts[String(slideIndex)] ?? prompts[slideIndex]);
  if (!row) return null;
  return {
    flux_image_prompt: str(row.flux_image_prompt),
    image_input_mode: str(row.image_input_mode),
    safe_zone_hint: str(row.safe_zone_hint),
    source_slide_index: row.source_slide_index ?? null,
  };
}

function generatedSlidesFromPayload(gp: Record<string, unknown>): Map<number, Record<string, unknown>> {
  const map = new Map<number, Record<string, unknown>>();
  const snapshot = asRecord(gp.draft_package_snapshot) ?? asRecord(gp.generated_output);
  if (!snapshot) return map;

  const mimicPkg = asRecord(snapshot.mimic_carousel_package) ?? snapshot;
  const copy = asRecord(mimicPkg.copy) ?? mimicPkg;
  const slides = Array.isArray(copy.slides)
    ? copy.slides
    : Array.isArray(mimicPkg.slides)
      ? mimicPkg.slides
      : [];

  for (let i = 0; i < slides.length; i++) {
    const slide = asRecord(slides[i]);
    if (!slide) continue;
    const slideIndex = typeof slide.slide_index === "number" && slide.slide_index > 0 ? slide.slide_index : i + 1;
    const textBlocks = Array.isArray(slide.text_blocks)
      ? slide.text_blocks
          .map((b) => {
            const block = asRecord(b);
            if (!block) return null;
            const text = str(block.text ?? block.content);
            if (!text) return null;
            return { role: str(block.role), text };
          })
          .filter((b): b is { role: string | null; text: string } => b !== null)
      : null;

    map.set(slideIndex, {
      headline: str(slide.headline ?? slide.title),
      body: str(slide.body ?? slide.text),
      text_blocks: textBlocks?.length ? textBlocks : null,
    });
  }
  return map;
}

function referenceExportFromLayout(row: MimicSlideCopyLayoutForLlm | null): Record<string, unknown> | null {
  if (!row) return null;
  const textBlocks = Array.isArray(row.text_blocks)
    ? row.text_blocks.map((b) => ({ role: b.role ?? null, text: b.text }))
    : null;
  const copySlots = Array.isArray(row.copy_slots_v1)
    ? row.copy_slots_v1.map((s) => ({
        slot_index: s.slot_index,
        llm_field: s.llm_field,
        split: s.split,
        reference_text: s.reference_text,
        block_texts: s.block_texts,
      }))
    : null;

  return {
    on_screen_text: row.reference_on_screen_text,
    visual_description: row.visual_description,
    slide_purpose: row.slide_purpose,
    layout_template: row.layout_template,
    image_or_photo_role: row.image_or_photo_role,
    text_density: row.text_density,
    graphic_elements: row.graphic_elements,
    color_tokens: row.color_tokens,
    typography: row.typography,
    text_blocks: textBlocks?.length ? textBlocks : null,
    copy_slots_v1: copySlots?.length ? copySlots : null,
  };
}

function intelligenceExportFromSil(
  sil: SlideIntelligenceV1 | null,
  qualityOpts?: SlideIntelligenceTextQualityOpts,
  strategicThesis?: string | null
): Record<string, unknown> | null {
  if (!sil) return null;
  const whyOpts = { ...qualityOpts, strategicThesis: strategicThesis ?? null };
  const whySufficient = isSlideIntelligenceWhyItWorksSufficient(sil.why_it_works, whyOpts);
  const visualSufficient = isSlideIntelligenceVisualDescriptionSufficient(sil.visual_description, qualityOpts);
  return {
    slide_index: sil.slide_index,
    source_slide_index: sil.source_slide_index,
    slide_role: sil.slide_role,
    visual_role: sil.visual_role,
    narrative_function: sil.narrative_function,
    psychological_trigger: sil.psychological_trigger,
    emotion: sil.emotion,
    attention_device: sil.attention_device,
    curiosity_mechanism: sil.curiosity_mechanism,
    persuasion_mechanism: sil.persuasion_mechanism,
    symbolic_elements: sil.symbolic_elements.map((s) => ({
      element: s.element,
      denotation: s.denotation,
      connotations: s.connotations,
    })),
    why_it_works: sil.why_it_works,
    why_sufficient: whySufficient,
    visual_description: sil.visual_description,
    visual_sufficient: visualSufficient,
    on_screen_text: sil.on_screen_text,
    provider: sil.provider,
    confidence: sil.confidence,
    evidence_refs: sil.evidence_refs,
  };
}

function brandSlideExport(brandSlide: BrandSlideBrief | null): Record<string, unknown> | null {
  if (!brandSlide) return null;
  return {
    preserved_function: brandSlide.preserved_function,
    preserved_mechanism: brandSlide.preserved_mechanism,
    translated_symbols: brandSlide.translated_symbols.map((s) => ({
      element: s.element,
      original_connotations: s.original_connotations,
      brand_expression: s.brand_expression,
      mapped: s.mapped,
    })),
  };
}

/** Operator/LLM-facing brief: what to preserve vs invent when reinterpreting one slide. */
export function buildSlideReinterpretationBrief(
  bundle: SlideIntelligenceBundleV1,
  slideIndex: number,
  opts?: {
    reference?: MimicSlideCopyLayoutForLlm | null;
    brandSlide?: BrandSlideBrief | null;
    brandBrief?: BrandExecutionBriefV1 | null;
    generated?: Record<string, unknown> | null;
    deckThesis?: string | null;
  }
): string | null {
  const sil = silSlideForIndex(bundle, slideIndex);
  const ref = opts?.reference ?? null;
  const generated = opts?.generated ?? null;
  const lines: string[] = [];

  lines.push(
    `Slide ${slideIndex}: preserve the strategic FUNCTION of this slide; invent fresh subjects, visuals, and wording.`
  );

  const thesis = opts?.deckThesis ?? bundle.why_analysis?.strategic_thesis ?? null;
  if (thesis) lines.push(`Deck thesis (hold constant): ${thesis}`);

  if (sil?.slide_role) lines.push(`Role in arc: ${sil.slide_role}`);
  if (sil?.narrative_function) lines.push(`Narrative job: ${sil.narrative_function}`);
  if (sil?.visual_role) lines.push(`Visual job: ${sil.visual_role}`);
  if (sil?.emotion) lines.push(`Target emotion: ${sil.emotion}`);

  const mechanisms = [sil?.psychological_trigger, sil?.attention_device, sil?.curiosity_mechanism, sil?.persuasion_mechanism]
    .filter((m): m is string => !!m && m.trim().length > 0);
  if (mechanisms.length > 0) lines.push(`Mechanisms to preserve: ${mechanisms.join(" · ")}`);

  if (sil?.why_it_works) lines.push(`Why the reference slide worked: ${sil.why_it_works}`);
  if (sil?.visual_description) lines.push(`Reference imagery (reinterpret, do not copy literally): ${sil.visual_description}`);

  if (sil?.symbolic_elements.length) {
    const sym = sil.symbolic_elements
      .map((s) => {
        const con = s.connotations.length ? ` → ${s.connotations.join(", ")}` : "";
        const den = s.denotation ? ` (${s.denotation})` : "";
        return `${s.element}${den}${con}`;
      })
      .join("; ");
    lines.push(`Symbolism to remap (not copy literally): ${sym}`);
  }

  if (opts?.brandSlide?.preserved_function) {
    lines.push(`Brand-preserved function: ${opts.brandSlide.preserved_function}`);
  }
  if (opts?.brandSlide?.preserved_mechanism) {
    lines.push(`Brand-preserved mechanism: ${opts.brandSlide.preserved_mechanism}`);
  }
  if (opts?.brandBrief?.tone) lines.push(`Brand tone: ${opts.brandBrief.tone}`);
  if (opts?.brandBrief?.visual_style) lines.push(`Brand visual style: ${opts.brandBrief.visual_style}`);

  if (ref?.reference_on_screen_text) {
    lines.push(`Reference on-screen text (rephrase; do not copy verbatim): ${ref.reference_on_screen_text}`);
  }
  if (!sil?.visual_description && ref?.visual_description) {
    lines.push(`Reference visual look: ${ref.visual_description}`);
  }
  if (ref?.slide_purpose) lines.push(`Reference slide purpose: ${ref.slide_purpose}`);
  if (ref?.layout_template) lines.push(`Layout pattern: ${ref.layout_template}`);

  const genHeadline = str(generated?.headline);
  const genBody = str(generated?.body);
  if (genHeadline || genBody) {
    lines.push(
      `Current generated copy: ${[genHeadline, genBody].filter(Boolean).join(" — ")}`
    );
  }

  if (lines.length <= 1) return null;
  return lines.join("\n");
}

function collectSlideIndices(
  bundle: SlideIntelligenceBundleV1,
  layout: MimicSlideCopyLayoutForLlm[],
  generated: Map<number, Record<string, unknown>>,
  mimic: MimicPayloadV1
): number[] {
  const indices = new Set<number>();
  for (const s of bundle.slides) {
    if (s.slide_index > 0) indices.add(s.slide_index);
  }
  for (const row of layout) {
    if (row.slide_index > 0) indices.add(row.slide_index);
  }
  for (const idx of generated.keys()) indices.add(idx);
  for (const plan of mimic.slide_plans ?? []) {
    if (plan.slide_index > 0) indices.add(plan.slide_index);
  }
  if (indices.size === 0) indices.add(1);
  return [...indices].sort((a, b) => a - b);
}

/**
 * Rich Why Mimic slice for run content-log export — enough context to audit or
 * reinterpret each slide (reference + intelligence + brand + generated output).
 */
export function buildWhyMimicContentLogSummary(
  flowType: string,
  generationPayload?: unknown,
  qualityOpts?: SlideIntelligenceTextQualityOpts
): Record<string, unknown> | null {
  const gp = asRecord(generationPayload) ?? {};
  const mimicRec = pickMimicPayload(gp) ?? pickMimicPayload({ mimic_v1: generationPayload });
  if (!mimicRec || !isWhyMimicExecution(flowType, mimicRec)) return null;

  const bundle = parseSlideIntelligenceBundle(mimicRec.slide_intelligence);
  if (!bundle) return null;

  const why = bundle.why_analysis;
  const brandBrief = parseBrandExecutionBrief(mimicRec.brand_execution_brief);
  const copyLayout = buildSlideCopyLayoutForLlmFromPayload(gp);
  const generatedBySlide = generatedSlidesFromPayload(gp);
  const slideIndices = collectSlideIndices(bundle, copyLayout, generatedBySlide, mimicRec);

  const vg = asRecord(mimicRec.visual_guideline);
  const deckVisual = asRecord(vg?.deck_visual_system);

  const intelligenceQuality = auditSlideIntelligenceWhyQuality(bundle, qualityOpts);

  const slides = slideIndices.map((slideIndex) => {
    const sil = silSlideForIndex(bundle, slideIndex);
    const refRow = layoutRowForIndex(copyLayout, slideIndex);
    const brandSlide = brandSlideBrief(brandBrief, slideIndex);
    const generated = generatedBySlide.get(slideIndex) ?? null;
    const plan = slidePlanForIndex(mimicRec, slideIndex);
    const flux = fluxPromptForIndex(mimicRec, slideIndex);

    return {
      slide_index: slideIndex,
      source_slide_index: sil?.source_slide_index ?? plan?.source_slide_index ?? refRow?.slide_index ?? slideIndex,
      intelligence: intelligenceExportFromSil(sil, qualityOpts, why?.strategic_thesis ?? null),
      reference: referenceExportFromLayout(refRow),
      brand_slide: brandSlideExport(brandSlide),
      generated,
      execution: {
        render_mode: plan?.render_mode ?? null,
        reference_index: plan?.reference_index ?? null,
        flux_image_prompt: flux,
      },
      reinterpretation_brief: buildSlideReinterpretationBrief(bundle, slideIndex, {
        reference: refRow,
        brandSlide,
        brandBrief,
        generated,
        deckThesis: why?.strategic_thesis ?? null,
      }),
    };
  });

  return {
    schema: "why_mimic_content_log_v2",
    execution_mode: mimicRec.execution_mode ?? MIMIC_EXECUTION_MODE_WHY,
    source_insights_id: mimicRec.source_insights_id ?? bundle.source_insights_id,
    analysis_tier: mimicRec.analysis_tier ?? bundle.analysis_tier,
    mimic_mode: mimicRec.mode ?? null,
    reinterpretation_contract: {
      preserve: "strategic FUNCTION of each slide (role, mechanism, persuasion job) — not surface wording or literal subjects",
      invent: "fresh copy, visuals, and brand-mapped symbols while holding deck thesis constant",
      legal_note: str(mimicRec.twist_brief?.legal_note),
      generation_guidance: buildWhyMimicPromptBlock(bundle),
    },
    deck_strategy: {
      strategic_thesis: why?.strategic_thesis ?? null,
      dominant_mechanism: why?.dominant_mechanism ?? null,
      secondary_mechanisms: why?.secondary_mechanisms ?? [],
      narrative_spine: why?.narrative_spine ?? [],
      arc_summary: why?.arc_summary ?? null,
      provider: why?.provider ?? bundle.provider,
      confidence: why?.confidence ?? null,
      slide_count: why?.slide_count ?? bundle.slides.length,
      overall_aesthetic: str(deckVisual?.overall_aesthetic),
      text_density: str(deckVisual?.text_density ?? vg?.text_density),
    },
    brand_execution: brandBrief
      ? {
          brand_name: brandBrief.brand_name,
          strategic_thesis_preserved: brandBrief.strategic_thesis_preserved,
          dominant_mechanism_preserved: brandBrief.dominant_mechanism_preserved,
          visual_style: brandBrief.visual_style,
          tone: brandBrief.tone,
          palette: brandBrief.palette,
          unmapped_connotations: brandBrief.unmapped_connotations,
        }
      : null,
    intelligence_quality: intelligenceQuality,
    slide_count: slides.length,
    slides,
  };
}
