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
});
