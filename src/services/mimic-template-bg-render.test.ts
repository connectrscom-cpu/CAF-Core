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
    expect(scoped.text_blocks).toEqual([
      { role: "headline", text: "Cover hook" },
      { role: "body", text: "Kicker line" },
    ]);
  });

  it("keeps cover subtitle when headline and body fields are both set", () => {
    const scoped = templateBgLlmSlideForDocAi(1, 12, {
      headline: "Aries: The Passionate Pursuer",
      body: "Subtitle paragraph for the cover slide.",
    });
    expect(scoped.body).toBe("Subtitle paragraph for the cover slide.");
    expect(scoped.text_blocks).toEqual([
      { role: "headline", text: "Aries: The Passionate Pursuer" },
      { role: "body", text: "Subtitle paragraph for the cover slide." },
    ]);
  });

  it("scopes CTA slide to cta + handle", () => {
    const scoped = templateBgLlmSlideForDocAi(5, 5, {
      headline: "Wrong for CTA",
      body: "",
      cta: "Follow for more",
      handle: "@brand",
    });
    expect(scoped.headline).toBe("Follow for more");
    expect(scoped.body).toBe("@brand");
    expect(scoped.text_blocks).toEqual([
      { role: "headline", text: "Follow for more" },
      { role: "handle", text: "@brand" },
    ]);
  });

  it("maps listicle CTA slide to headline + body + handle text_blocks", () => {
    const scoped = templateBgLlmSlideForDocAi(12, 12, {
      headline: "AQUARIUS: THE VISIONARY",
      body: "Aquarius moms inspire their children to dream big and embrace their uniqueness.",
      cta: "AQUARIUS: THE VISIONARY",
      handle: "@signandsound",
    });
    expect(scoped.text_blocks).toEqual([
      { role: "headline", text: "AQUARIUS: THE VISIONARY" },
      {
        role: "body",
        text: "Aquarius moms inspire their children to dream big and embrace their uniqueness.",
      },
      { role: "handle", text: "@signandsound" },
    ]);
    expect(scoped.headline).toBe("AQUARIUS: THE VISIONARY");
    expect(scoped.body).toContain("Aquarius moms");
  });

  it("maps body slides to headline + body", () => {
    const scoped = templateBgLlmSlideForDocAi(3, 5, {
      headline: "Tip three",
      body: "Detail line",
    });
    expect(scoped.headline).toBe("Tip three");
    expect(scoped.body).toBe("Detail line");
    expect(scoped.text_blocks).toEqual([
      { role: "headline", text: "Tip three" },
      { role: "body", text: "Detail line" },
    ]);
  });

  it("maps inverted listicle body slides to decor title + paragraph", () => {
    const scoped = templateBgLlmSlideForDocAi(3, 12, {
      headline:
        "She is spirited and adventurous, constantly passing it on as she guides her kids toward pursuing their ambitions.",
      body: "A fierce and vibrant spirit defines the Aries mom.",
      kicker: "Aries Mother Traits",
    });
    expect(scoped.headline).toBe("THE ARIES MOTHER");
    expect(String(scoped.body)).toContain("She is spirited");
    expect(scoped.text_blocks).toEqual(
      expect.arrayContaining([
        { role: "headline", text: "THE ARIES MOTHER" },
        expect.objectContaining({ role: "body" }),
      ])
    );
  });

  it("maps inverted listicle body when LLM put handle in body and paragraph in headline", () => {
    const paragraph =
      "The Aries Mom is a spirited explorer, always ready for adventure. She wants her kids to cherish their childhood memories full of love and joy.";
    const scoped = templateBgLlmSlideForDocAi(2, 12, {
      headline: paragraph,
      body: "@sistersvillage",
      text_blocks: [
        { llm_field: "body", text: paragraph },
        { llm_field: "handle", text: "@sistersvillage" },
      ],
    });
    expect(scoped.headline).toBe("THE ARIES MOTHER");
    expect(scoped.body).toBe(paragraph);
  });

  it("omits project handle from body-slot text_blocks (handle uses OCR bbox + projectHandle)", () => {
    const scoped = templateBgLlmSlideForDocAi(2, 12, {
      headline: "THE ARIES MOTHER",
      body: "The Aries Mom is a spirited explorer, always ready for adventure.",
      handle: "@signandsound",
    });
    expect(scoped.text_blocks).toEqual([
      { role: "headline", text: "THE ARIES MOTHER" },
      { role: "body", text: "The Aries Mom is a spirited explorer, always ready for adventure." },
    ]);
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
