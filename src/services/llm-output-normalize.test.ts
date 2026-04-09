import { describe, expect, it } from "vitest";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";

describe("normalizeLlmParsedForSchemaValidation (carousel)", () => {
  it("wraps flat slides[] into variations[{ variation_name, slides, caption, inputs_used }]", () => {
    const out = normalizeLlmParsedForSchemaValidation("Flow_Carousel_Copy", {
      slides: [
        { headline: "A", body: "1" },
        { headline: "B", body: "2" },
      ],
      caption: "Cap",
      cta_type: "Save",
    });
    expect(Array.isArray(out.variations)).toBe(true);
    expect(out.variations).toHaveLength(1);
    const v = out.variations![0] as Record<string, unknown>;
    expect(v.variation_name).toBe("V1");
    expect(Array.isArray(v.slides)).toBe(true);
    expect((v.slides as unknown[]).length).toBe(2);
    expect(v.caption).toBe("Cap");
    expect(v.cta_type).toBe("Save");
    expect(v.inputs_used).toMatchObject({
      reference_post_ids: [],
      themes_used: [],
    });
  });

  it("wraps mistaken flat slide rows in variations[]", () => {
    const out = normalizeLlmParsedForSchemaValidation("Flow_Carousel_Copy", {
      variations: [
        { headline: "H1", body: "B1", slide_number: 1 },
        { headline: "H2", body: "B2", slide_number: 2 },
      ],
    });
    const v = out.variations![0] as Record<string, unknown>;
    expect(Array.isArray(v.slides)).toBe(true);
    expect((v.slides as unknown[]).length).toBe(2);
  });

  it("fills defaults on already-nested Carousel_Insight shape", () => {
    const out = normalizeLlmParsedForSchemaValidation("Flow_Carousel_Copy", {
      variations: [
        {
          variation_name: "V1",
          slides: [{ headline: "x", body: "y" }],
          caption: "c",
          cta_type: "Comment",
          inputs_used: { reference_post_ids: ["a"], themes_used: ["t"] },
        },
      ],
    });
    const v = out.variations![0] as Record<string, unknown>;
    expect(v.slides).toHaveLength(1);
    expect((v.slides as Record<string, unknown>[])[0].slide_number).toBe(1);
  });

  it("wraps slide_deck.slides when top-level slides are empty placeholders", () => {
    const out = normalizeLlmParsedForSchemaValidation("Flow_Carousel_Copy", {
      slides: [{ body: "", headline: "", slide_role: "cover" }],
      variation_name: "relationship_patterns_carousel",
      slide_deck: {
        slides: [
          { headline: "Cover", body: "Opening body text here." },
          { headline: "Mid", body: "Middle slide body." },
        ],
        structure_variables: { slide_count: 2, narrative_arc: "a,b" },
      },
    });
    const v = out.variations![0] as Record<string, unknown>;
    expect(v.variation_name).toBe("relationship_patterns_carousel");
    expect((v.slides as unknown[])).toHaveLength(2);
    expect((v.slides as Array<{ headline?: string }>)[0]?.headline).toBe("Cover");
    expect((out.structure_variables as Record<string, unknown>)?.slide_count).toBe(2);
  });

  it("hoists top-level slide_count into structure_variables for QC paths", () => {
    const out = normalizeLlmParsedForSchemaValidation("Flow_Carousel_Copy", {
      slide_count: 6,
      narrative_arc: "identity-based escalation",
      slides: [
        { headline: "A", body: "1".repeat(50) },
        { headline: "B", body: "2".repeat(50) },
      ],
    });
    const sv = out.structure_variables as Record<string, unknown>;
    expect(sv?.slide_count).toBe(6);
    expect(sv?.narrative_arc).toBe("identity-based escalation");
  });

  it("maps structure{} to structure_variables (slide_count nested under structure)", () => {
    const out = normalizeLlmParsedForSchemaValidation("Flow_Carousel_Copy", {
      variation_name: "Interpreter Carousel",
      structure: {
        slide_count: 7,
        narrative_arc: ["hook", "insight", "cta"],
        hook_type: "tension-based",
        cta_type: "engagement",
        cta_placement: "end",
      },
      slides: [
        { headline: "A", body: "1".repeat(50) },
        { headline: "B", body: "2".repeat(50) },
      ],
    });
    const sv = out.structure_variables as Record<string, unknown>;
    expect(sv?.slide_count).toBe(7);
    expect(sv?.narrative_arc).toBe("hook,insight,cta");
    expect(sv?.hook_type).toBe("tension-based");
  });
});
