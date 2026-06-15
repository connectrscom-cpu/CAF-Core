import { describe, expect, it } from "vitest";
import { templateBgGuidelineSlideIndex, templateBgLlmSlideForDocAi } from "./mimic-template-bg-render.js";

describe("templateBgLlmSlideForDocAi", () => {
  it("scopes cover slide to headline + subtitle only", () => {
    const scoped = templateBgLlmSlideForDocAi(1, 5, {
      headline: "Cover hook",
      body: "Body should not land on cover",
      subtitle: "Kicker line",
    });
    expect(scoped.headline).toBe("Cover hook");
    expect(scoped.body).toBe("Kicker line");
  });

  it("scopes CTA slide to cta + handle", () => {
    const scoped = templateBgLlmSlideForDocAi(5, 5, {
      headline: "Wrong for CTA",
      body: "Also wrong",
      cta: "Follow for more",
      handle: "@brand",
    });
    expect(scoped.headline).toBe("Follow for more");
    expect(scoped.body).toBe("@brand");
  });

  it("maps body slides to headline + body", () => {
    const scoped = templateBgLlmSlideForDocAi(3, 5, {
      headline: "Tip three",
      body: "Detail line",
    });
    expect(scoped.headline).toBe("Tip three");
    expect(scoped.body).toBe("Detail line");
  });
});

describe("templateBgGuidelineSlideIndex", () => {
  it("uses cover/body/cta reference indices for uniform listicle decks", () => {
    const mimic = {
      mode: "template_bg" as const,
      reference_items: [{ index: 1 }, { index: 2 }, { index: 3 }, { index: 4 }],
      visual_guideline: {
        format_pattern: "listicle",
        mimic_evaluation: { template_consistency: "uniform" },
      },
    };
    expect(templateBgGuidelineSlideIndex(mimic, 1, 4)).toBe(1);
    expect(templateBgGuidelineSlideIndex(mimic, 2, 4)).toBe(3);
    expect(templateBgGuidelineSlideIndex(mimic, 4, 4)).toBe(4);
  });
});
