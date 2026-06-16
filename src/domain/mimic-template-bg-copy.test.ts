import { describe, expect, it } from "vitest";
import {
  isListicleBodyInvertedLlmCopy,
  listicleDecorTitleFromKicker,
  resolveTemplateBgBodyOnScreenCopy,
} from "./mimic-template-bg-copy.js";

describe("mimic-template-bg-copy", () => {
  it("derives THE ARIES MOTHER from kicker", () => {
    expect(listicleDecorTitleFromKicker("Aries Mother Traits")).toBe("THE ARIES MOTHER");
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
});
