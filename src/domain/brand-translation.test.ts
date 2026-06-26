import { describe, expect, it } from "vitest";
import { parseBrandProfile } from "./brand-profile.js";
import {
  buildBrandExecutionBrief,
  buildBrandTranslationPromptBlock,
  parseBrandExecutionBrief,
  BRAND_EXECUTION_BRIEF_SCHEMA,
} from "./brand-translation.js";
import { deriveSlideIntelligenceFromAnalysis } from "./slide-intelligence.js";

const profile = parseBrandProfile({
  brand_name: "Acme SaaS",
  palette: ["#0A2540", "#635BFF"],
  visual_style: "clean SaaS, blue, educational",
  tone: "confident, plain-spoken",
  symbol_map: { exclusivity: "enterprise tier badge", aspiration: "growth chart climbing" },
});

const bundle = deriveSlideIntelligenceFromAnalysis({
  aesthetic: {
    why_it_worked: "Aspirational exclusivity drives saves.",
    slides: [
      {
        slide_index: 1,
        slide_purpose: "cover with aspirational symbol",
        symbolic_elements: [
          { element: "castle", denotation: "stone fortress", connotations: ["exclusivity", "mystery"] },
        ],
      },
      {
        slide_index: 2,
        slide_purpose: "proof of growth",
        symbolic_elements: [{ element: "mountain", connotations: ["aspiration"] }],
      },
    ],
  },
});

describe("buildBrandExecutionBrief", () => {
  it("preserves the strategic thesis and remaps mapped symbols", () => {
    const brief = buildBrandExecutionBrief(bundle, profile);
    expect(brief).not.toBeNull();
    expect(brief!.schema_version).toBe(BRAND_EXECUTION_BRIEF_SCHEMA);
    expect(brief!.brand_name).toBe("Acme SaaS");
    // INVARIANT: thesis copied verbatim from why_analysis
    expect(brief!.strategic_thesis_preserved).toBe(bundle!.why_analysis!.strategic_thesis);

    const cover = brief!.slides[0];
    expect(cover.translated_symbols[0].mapped).toBe(true);
    expect(cover.translated_symbols[0].brand_expression).toBe("enterprise tier badge");

    const proof = brief!.slides[1];
    expect(proof.translated_symbols[0].brand_expression).toBe("growth chart climbing");

    // "mystery" had no mapping -> surfaced for LLM fallback
    expect(brief!.unmapped_connotations).toContain("mystery");
  });

  it("returns null without a profile or bundle", () => {
    expect(buildBrandExecutionBrief(bundle, null)).toBeNull();
    expect(buildBrandExecutionBrief(null, profile)).toBeNull();
  });
});

describe("buildBrandTranslationPromptBlock", () => {
  it("emits a brand block that pins the thesis and lists remaps", () => {
    const brief = buildBrandExecutionBrief(bundle, profile);
    const block = buildBrandTranslationPromptBlock(brief);
    expect(block).not.toBeNull();
    expect(block!).toContain("Strategic thesis (DO NOT change)");
    expect(block!).toContain("castle → enterprise tier badge");
    expect(block!).toContain("Acme SaaS");
  });
});

describe("parseBrandExecutionBrief round-trip", () => {
  it("round-trips through JSON", () => {
    const brief = buildBrandExecutionBrief(bundle, profile);
    const round = parseBrandExecutionBrief(JSON.parse(JSON.stringify(brief)));
    expect(round?.strategic_thesis_preserved).toBe(brief!.strategic_thesis_preserved);
  });

  it("rejects non-brief payloads", () => {
    expect(parseBrandExecutionBrief({ schema_version: "nope" })).toBeNull();
    expect(parseBrandExecutionBrief(null)).toBeNull();
  });
});

describe("parseBrandProfile", () => {
  it("accepts object-form symbol_map and trims signal", () => {
    expect(profile).not.toBeNull();
    expect(profile!.symbol_map).toEqual([
      { connotation: "exclusivity", brand_expression: "enterprise tier badge" },
      { connotation: "aspiration", brand_expression: "growth chart climbing" },
    ]);
  });

  it("returns null when there is no usable brand signal", () => {
    expect(parseBrandProfile({})).toBeNull();
    expect(parseBrandProfile(null)).toBeNull();
  });
});
