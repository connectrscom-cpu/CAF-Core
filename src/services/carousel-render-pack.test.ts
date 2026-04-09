import { describe, expect, it, vi, afterEach } from "vitest";
import {
  buildSlideRenderContext,
  carouselSlideCount,
  DEFAULT_CAROUSEL_CTA_COPY,
  explicitCarouselTemplateBaseName,
  formatInstagramHandleForCta,
  pickCarouselTemplateForRender,
  slidesFromGeneratedOutput,
  slideHasRenderableContent,
  stripNonRenderableDeckFields,
} from "./carousel-render-pack.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";

describe("stripNonRenderableDeckFields", () => {
  it("drops candidate empty slides so gen.carousel is the only deck (merge shadowing)", () => {
    const candidate = { slides: [{ slide_role: "cover", headline: "", body: "" }] };
    const gen = {
      carousel: [
        { headline: "Real", body: "Copy" },
        { headline: "Second", body: "Line" },
      ],
    };
    const merged = stripNonRenderableDeckFields({ ...candidate, ...gen });
    expect(merged.slides).toBeUndefined();
    const slides = slidesFromGeneratedOutput(merged);
    expect(slides).toHaveLength(2);
    expect(slides[0]?.headline).toBe("Real");
  });

  it("with normalize, recovers slide_deck when merge retained empty top-level slides from candidate", () => {
    const merged = stripNonRenderableDeckFields({
      slides: [{ slide_role: "cover", headline: "", body: "" }],
      slide_deck: {
        slides: [
          { headline: "Cover", body: "Opening" },
          { headline: "Mid", body: "Middle" },
        ],
      },
    });
    const normalized = normalizeLlmParsedForSchemaValidation("Flow_Carousel_Copy", merged);
    const slides = slidesFromGeneratedOutput(normalized);
    expect(slides).toHaveLength(2);
    expect((slides[0] as { headline?: string }).headline).toBe("Cover");
  });
});

describe("slidesFromGeneratedOutput", () => {
  it("prefers carousel[] over empty slides/variations stubs (LLM split output)", () => {
    const gen = {
      slides: [{ body: "", headline: "", slide_role: "cover" }],
      variations: [{ body: "", headline: "", slide_role: "cover" }],
      carousel: [
        { headline: "Aries", body: "Fire sign energy" },
        { headline: "Taurus", body: "Earth sign calm" },
      ],
      slide_count: 2,
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides).toHaveLength(2);
    expect(slides[0]?.headline).toBe("Aries");
    expect(slides[1]?.body).toContain("Earth");
  });

  it("parses Sheets-style stringified carousel with items[]", () => {
    const json = JSON.stringify({
      type: "carousel",
      slide_count: 2,
      items: [
        { index: 1, slide_number: 1, headline: "Hook", body: "Body one" },
        { index: 2, slide_number: 2, headline: "Next", body: "Body two" },
      ],
    });
    const slides = slidesFromGeneratedOutput({ carousel: json });
    expect(slides).toHaveLength(2);
    expect(slides[0]?.headline).toBe("Hook");
  });

  it("uses slides when they contain real text even if carousel exists (tie-band prefers slides)", () => {
    const gen = {
      slides: [{ headline: "Real", body: "From slides" }],
      carousel: [{ headline: "Other", body: "From carousel" }],
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides[0]?.headline).toBe("Real");
  });

  it("prefers slides over thin top-level items merged from candidate_data", () => {
    const gen = {
      items: [{ headline: "Idea", body: "Short" }],
      slides: [
        { headline: "Cover line", body: "Full paragraph one with enough characters to dominate the stub deck." },
        { headline: "Mid", body: "Second slide body also substantial for the carousel reader." },
        { headline: "CTA", body: "@brand" },
      ],
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides[0]?.headline).toBe("Cover line");
    expect(slides).toHaveLength(3);
  });

  it("slideHasRenderableContent is false for role-only placeholders", () => {
    expect(slideHasRenderableContent({ slide_role: "cover" })).toBe(false);
    expect(slideHasRenderableContent({ headline: "x", body: "" })).toBe(true);
  });

  it("reads Flow_Carousel_Copy shape variation.slides when top-level slides are empty placeholders", () => {
    const gen = {
      slides: [{ body: "", headline: "", slide_role: "cover" }],
      variation: {
        structure: { slide_count: 7 },
        slides: [
          { headline: "H1", body: "First body with enough text." },
          { headline: "H2", body: "Second slide." },
        ],
      },
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides).toHaveLength(2);
    expect(slides[0]?.headline).toBe("H1");
  });

  it("reads carousel.slides object (LLM nests slides under carousel)", () => {
    const gen = {
      carousel: {
        narrative_arc: "build",
        slides: [
          { headline: "A", body: "Alpha slide body here." },
          { headline: "B", body: "Beta slide body here." },
        ],
      },
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides).toHaveLength(2);
    expect(slides[0]?.headline).toBe("A");
  });

  it("reads content.carousel array (alternate LLM nesting)", () => {
    const gen = {
      content: {
        caption: "Cap",
        carousel: [
          { headline: "One", body: "Body one extended." },
          { headline: "Two", body: "Body two extended." },
        ],
      },
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides).toHaveLength(2);
    expect(slides[1]?.headline).toBe("Two");
  });

  it("reads slide_deck.slides when top-level slides are router placeholders (Flow_Carousel_Copy drift)", () => {
    const gen = {
      slides: [{ body: "", headline: "", slide_role: "cover" }],
      variation_name: "relationship_patterns_carousel",
      slide_deck: {
        structure_variables: { slide_count: 5, narrative_arc: "intro,end" },
        slides: [
          { headline: "How Does Your Sign Love?", body: "Every zodiac sign expresses affection in unique ways." },
          { headline: "Aries", body: "Aries leads with fiery passion and dynamic energy." },
          { headline: "Taurus", body: "Taurus nurtures with unwavering loyalty." },
        ],
      },
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides).toHaveLength(3);
    expect(slides[0]?.headline).toBe("How Does Your Sign Love?");
    expect(String(slides[1]?.body)).toContain("Aries");
  });
});

describe("carousel template shape (body_slides)", () => {
  it("carouselSlideCount matches DOM when flat slides lack body_slides", () => {
    const gen = {
      slides: [
        { headline: "A", body: "a" },
        { headline: "B", body: "b" },
        { headline: "C", body: "c" },
      ],
    };
    expect(carouselSlideCount(gen)).toBe(3);
  });

  it("single flat slide maps to cover + empty CTA shell (2 DOM slides)", () => {
    const gen = { slides: [{ headline: "Only", body: "one" }] };
    expect(carouselSlideCount(gen)).toBe(2);
  });

  it("buildSlideRenderContext injects cover_slide, body_slides, cta_slide from flat slides", () => {
    const gen = {
      slides: [
        { headline: "H1", body: "B1" },
        { headline: "H2", body: "B2" },
        { headline: "H3", body: "B3" },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    const ctx = buildSlideRenderContext(gen, flat, 2);
    expect((ctx.cover_slide as { headline?: string }).headline).toBe("H1");
    expect(Array.isArray(ctx.body_slides)).toBe(true);
    expect((ctx.body_slides as unknown[])).toHaveLength(1);
    expect((ctx.body_slides as Array<{ headline?: string }>)[0]?.headline).toBe("H2");
    expect((ctx.cta_slide as { body?: string; handle?: string }).body).toBe("H3");
    expect((ctx.cta_slide as { handle?: string }).handle).toBe("B3");
  });

  it("derives cover headline from body when first slide has no title (templates use cover_slide.headline)", () => {
    const gen = {
      slides: [
        { headline: "", body: "This is the opening thought. It continues with more detail." },
        { headline: "Middle", body: "More" },
        { headline: "End", body: "Bye" },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    const ctx = buildSlideRenderContext(gen, flat, 1);
    expect(String((ctx.cover_slide as { headline?: string }).headline).length).toBeGreaterThan(0);
    expect(String((ctx.cover_slide as { headline?: string }).headline)).toContain("This is the opening thought");
  });

  it("merged candidate body_slides cannot shrink slide_count vs generated_output.slides", () => {
    const base = {
      body_slides: [{ headline: "stub", body: "from router" }],
      slides: [
        { headline: "A", body: "a" },
        { headline: "B", body: "b" },
        { headline: "C", body: "c" },
        { headline: "D", body: "d" },
      ],
    };
    expect(carouselSlideCount(base)).toBe(4);
    const flat = slidesFromGeneratedOutput(base);
    const ctx = buildSlideRenderContext(base, flat, 4);
    expect((ctx.body_slides as unknown[])).toHaveLength(2);
    expect((ctx.cta_slide as { body?: string }).body).toBe("D");
  });

  it("fills default CTA copy and project Instagram when the last slide has no text", () => {
    const gen = {
      slides: [
        { headline: "A", body: "a" },
        { headline: "", body: "" },
      ],
    };
    const flatAll = slidesFromGeneratedOutput(gen);
    const flat = flatAll.filter((s) => slideHasRenderableContent(s as Record<string, unknown>));
    expect(flat).toHaveLength(1);
    const ctx = buildSlideRenderContext(gen, flat, 1, { instagramHandle: "mybrand" });
    expect(ctx.cta_text).toBe(DEFAULT_CAROUSEL_CTA_COPY);
    expect(ctx.cta_handle).toBe("@mybrand");
    expect((ctx.cta_slide as { body?: string; handle?: string }).body).toBe(DEFAULT_CAROUSEL_CTA_COPY);
    expect((ctx.cta_slide as { handle?: string }).handle).toBe("@mybrand");
  });

  it("formatInstagramHandleForCta accepts URLs and stray @", () => {
    expect(formatInstagramHandleForCta("https://instagram.com/demo_user/")).toBe("@demo_user");
    expect(formatInstagramHandleForCta("@demo")).toBe("@demo");
  });
});

describe("explicitCarouselTemplateBaseName", () => {
  it("treats default as implicit", () => {
    expect(explicitCarouselTemplateBaseName({ template: "default" })).toBeNull();
    expect(explicitCarouselTemplateBaseName({ template: "default.hbs" })).toBeNull();
  });

  it("returns custom template base name", () => {
    expect(explicitCarouselTemplateBaseName({ template: "brand" })).toBe("brand");
    expect(
      explicitCarouselTemplateBaseName({
        generated_output: { render: { html_template_name: "minimal.hbs" } },
      })
    ).toBe("minimal");
  });
});

describe("pickCarouselTemplateForRender", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses explicit template without calling renderer", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const p = await pickCarouselTemplateForRender("http://renderer:3333", { template: "foo" });
    expect(p).toBe("foo");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("picks from /templates when implicit default", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ templates: ["default.hbs", "alt.hbs"] }),
      })
    );
    const p = await pickCarouselTemplateForRender("http://renderer:3333", {});
    expect(["default", "alt"]).toContain(p);
  });
});
