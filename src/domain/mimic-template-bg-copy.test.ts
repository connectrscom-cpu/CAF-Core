import { describe, expect, it } from "vitest";
import {
  isListicleBodyInvertedLlmCopy,
  listicleDecorTitleFromKicker,
  listicleDecorTitleFromParagraph,
  resolveTemplateBgBodyOnScreenCopy,
  resolveTemplateBgCtaOnScreenCopy,
  shortListicleMotherDecorTitle,
  splitListicleColonLeadTitle,
  templateBgLlmSlideForDocAi,
} from "./mimic-template-bg-copy.js";

describe("mimic-template-bg-copy", () => {
  it("recognizes short sign mother decor titles", () => {
    expect(shortListicleMotherDecorTitle("Aries Mother")).toBe("Aries Mother");
    expect(shortListicleMotherDecorTitle("GEMINI Mother")).toBe("GEMINI Mother");
    expect(shortListicleMotherDecorTitle("Aries Mother Traits")).toBe("");
  });

  it("derives THE ARIES MOTHER from kicker", () => {
    expect(listicleDecorTitleFromKicker("Aries Mother Traits")).toBe("THE ARIES MOTHER");
    expect(listicleDecorTitleFromKicker("Aries Mother")).toBe("Aries Mother");
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
    expect(mapped.body).toContain("spirited");
  });

  it("uses slide_title for inverted listicle decor when paragraph is in headline", () => {
    const paragraph =
      "Every generation echoes through the cosmic tides, but the archetype of nurturer transforms with each sign.";
    const mapped = resolveTemplateBgBodyOnScreenCopy({
      headline: paragraph,
      body: "",
      slide_title: "Aries Mother",
    });
    expect(mapped.inverted).toBe(true);
    expect(mapped.headline).toBe("Aries Mother");
    expect(mapped.body).toBe(paragraph);
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

  it("derives Gemini as Mother from colon-lead paragraph copy", () => {
    expect(
      listicleDecorTitleFromParagraph(
        "Gemini as Mother: She is the voice weaving play and possibility into each day."
      )
    ).toBe("Gemini as Mother");
  });

  it("splits colon-lead listicle copy into title + body", () => {
    const paragraph =
      "Gemini as Mother: She is the voice weaving play and possibility into each day. The Gemini archetype brings curiosity to the breakfast table.";
    const split = splitListicleColonLeadTitle(paragraph);
    expect(split?.title).toBe("Gemini as Mother");
    expect(split?.body).toContain("She is the voice");
  });

  it("maps duplicate headline/body paragraph to title + body for listicle slides", () => {
    const paragraph =
      "Gemini as Mother: She is the voice weaving play and possibility into each day. The Gemini archetype brings curiosity to the breakfast table.";
    const mapped = resolveTemplateBgBodyOnScreenCopy({
      headline: paragraph,
      body: paragraph,
    });
    expect(mapped.inverted).toBe(true);
    expect(mapped.headline).toBe("Gemini as Mother");
    expect(mapped.body).toBe(paragraph.slice("Gemini as Mother: ".length).trim());
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

  it("templateBgLlmSlideForDocAi pulls CTA body from text_blocks when body field empty", () => {
    const mapped = templateBgLlmSlideForDocAi(14, 14, {
      headline: "PISCES: True Renewal",
      body: "",
      handle: "@signandsound",
      text_blocks: [
        { role: "headline", text: "PISCES: True Renewal" },
        { role: "body", text: "Pisces season invites renewal and quiet courage." },
        { role: "handle", text: "@signandsound" },
      ],
    });
    expect(String(mapped.body ?? "")).toContain("Pisces season");
  });
});
