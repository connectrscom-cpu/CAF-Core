import { describe, expect, it } from "vitest";
import {
  isListicleBodyInvertedLlmCopy,
  listicleDecorTitleFromKicker,
  listicleDecorTitleFromParagraph,
  resolveTemplateBgBodyOnScreenCopy,
  resolveTemplateBgCtaOnScreenCopy,
} from "./mimic-template-bg-copy.js";

describe("mimic-template-bg-copy", () => {
  it("derives THE ARIES MOTHER from kicker", () => {
    expect(listicleDecorTitleFromKicker("Aries Mother Traits")).toBe("THE ARIES MOTHER");
  });

  it("derives THE ARIES MOTHER from inverted paragraph copy", () => {
    expect(
      listicleDecorTitleFromParagraph(
        "The Aries Mom is a spirited explorer, always ready for adventure."
      )
    ).toBe("THE ARIES MOTHER");
  });

  it("detects inverted listicle body copy", () => {
    const long =
      "She is spirited and adventurous, constantly passing it on as she guides her kids toward pursuing their ambitions.";
    const short = "A fierce and vibrant spirit defines the Aries mom.";
    expect(isListicleBodyInvertedLlmCopy(long, short, "Aries Mother Traits")).toBe(true);
  });

  it("maps inverted LLM fields to decor title + paragraph body", () => {
    const long =
      "She is spirited and adventurous, constantly passing it on as she guides her kids toward pursuing their ambitions.";
    const short = "A fierce and vibrant spirit defines the Aries mom.";
    const mapped = resolveTemplateBgBodyOnScreenCopy({
      headline: long,
      body: short,
      kicker: "Aries Mother Traits",
    });
    expect(mapped.inverted).toBe(true);
    expect(mapped.headline).toBe("THE ARIES MOTHER");
    expect(mapped.body).toContain("She is spirited");
    expect(mapped.body).toContain("fierce and vibrant");
  });

  it("maps inverted copy with handle in body field and no kicker", () => {
    const paragraph =
      "The Aries Mom is a spirited explorer, always ready for adventure. She wants her kids to cherish their childhood memories full of love and joy.";
    const mapped = resolveTemplateBgBodyOnScreenCopy({
      headline: paragraph,
      body: "@sistersvillage",
    });
    expect(mapped.inverted).toBe(true);
    expect(mapped.headline).toBe("THE ARIES MOTHER");
    expect(mapped.body).toBe(paragraph);
  });

  it("maps listicle CTA with substantive body to headline + body + handle slots", () => {
    const mapped = resolveTemplateBgCtaOnScreenCopy({
      headline: "AQUARIUS: THE VISIONARY",
      body: "Aquarius moms inspire their children to dream big.",
      cta: "AQUARIUS: THE VISIONARY",
      handle: "@signandsound",
    });
    expect(mapped.listicle_style).toBe(true);
    expect(mapped.headline).toBe("AQUARIUS: THE VISIONARY");
    expect(mapped.body).toContain("Aquarius moms");
    expect(mapped.handle).toBe("@signandsound");
  });

  it("keeps simple follow CTA as headline + handle only", () => {
    const mapped = resolveTemplateBgCtaOnScreenCopy({
      headline: "ignored",
      body: "",
      cta: "Follow for more",
      handle: "@brand",
    });
    expect(mapped.listicle_style).toBe(false);
    expect(mapped.headline).toBe("Follow for more");
    expect(mapped.body).toBe("");
    expect(mapped.handle).toBe("@brand");
  });
});
