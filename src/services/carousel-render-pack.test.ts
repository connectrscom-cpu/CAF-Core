import { describe, expect, it, vi, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  buildSlideRenderContext,
  carouselSlideCount,
  DEFAULT_CAROUSEL_CTA_COPY,
  explicitCarouselTemplateBaseName,
  formatInstagramHandleForCta,
  pickCarouselTemplateForRender,
  reviewRequestsCarouselTemplateChange,
  slidesFromGeneratedOutput,
  slideHasRenderableContent,
  stripExplicitCarouselTemplateSelection,
  stripHashtagsFromSlideCopy,
  stripNonRenderableDeckFields,
} from "./carousel-render-pack.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";

describe("stripHashtagsFromSlideCopy", () => {
  it("removes spaced #hashtag tokens from slide copy", () => {
    expect(stripHashtagsFromSlideCopy("Hook line #viral #fyp and more")).toBe("Hook line and more");
  });

  it("does not strip #1 style ordinals (digit after #)", () => {
    expect(stripHashtagsFromSlideCopy("Top #1 tip for you")).toBe("Top #1 tip for you");
  });
});

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
  it("reads slides from content.slides when model nests deck under content (LLM drift)", () => {
    const gen = {
      platform: "Instagram",
      variation_name: "Zodiac New Year Resolutions Carousel",
      structure_variables: { slide_count: 7 },
      content: {
        slides: [
          { headline: "Get Ready for 2026!", body: "As we step into the new year…" },
          { headline: "Aries: Bold Moves", body: "For Aries, 2026 is all about embracing boldness." },
        ],
        caption: "Navigate 2026 with zodiac wisdom",
        cta_text: "Comment your sign",
      },
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides).toHaveLength(2);
    expect(slides[0]?.headline).toBe("Get Ready for 2026!");
  });

  it("strips hashtags from slide headline and body", () => {
    const gen = {
      slides: [
        { headline: "Save this #recipe", body: "Try it today #foodie #yum" },
      ],
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides[0]?.headline).toBe("Save this");
    expect(slides[0]?.body).toBe("Try it today");
  });

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

  it("merges emoji-only paragraph lines into adjacent text", () => {
    const gen = {
      slides: [
        { headline: "Title\n🔥", body: "Line one\n\n🔥\nLine two" },
        { headline: "Next", body: "All good" },
      ],
    };
    const slides = slidesFromGeneratedOutput(gen) as Array<{ headline?: string; body?: string }>;
    expect(slides[0]?.headline).toBe("Title 🔥");
    expect(slides[0]?.body).toBe("Line one 🔥\nLine two");
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

  it("appends a CTA slide when deck is 2 slides and last slide doesn't look like CTA", () => {
    const gen = {
      slides: [
        { headline: "Cover", body: "Hook" },
        { headline: "Body", body: "More detail" },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    const ctx = buildSlideRenderContext(gen, flat, 1, { instagramHandle: "@sns" });
    const slides = ctx.slides as Array<{ body?: string; handle?: string }>;
    expect(slides).toHaveLength(3);
    const last = slides[slides.length - 1]!;
    expect(String(last.body)).toContain("Follow");
    expect(String(last.handle)).toContain("@");
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

  it("sanitizes whitespace cover_slide.name so templates can fall back to handle/SNS", () => {
    const gen = {
      cover_slide: { name: "   ", status: "  online.  " },
      slides: [
        { headline: "Cover", body: "Hook" },
        { headline: "CTA", body: "@brand" },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    const ctx = buildSlideRenderContext(gen, flat, 1);
    expect((ctx.cover_slide as { name?: unknown }).name).toBeUndefined();
    expect((ctx.cover_slide as { status?: unknown }).status).toBe("online.");
  });
});

describe("reviewRequestsCarouselTemplateChange / stripExplicitCarouselTemplateSelection", () => {
  it("detects tag and notes", () => {
    expect(reviewRequestsCarouselTemplateChange({ rejection_tags: ["carousel_template_change"], notes: null })).toBe(
      true
    );
    expect(reviewRequestsCarouselTemplateChange({ rejection_tags: [], notes: "Please change template for IG" })).toBe(
      true
    );
    expect(reviewRequestsCarouselTemplateChange({ rejection_tags: ["typo"], notes: "" })).toBe(false);
  });

  it("strips explicit template keys from payload", () => {
    const gp: Record<string, unknown> = {
      template: "sns5_midnight_constellation",
      render: { html_template_name: "sns5_midnight_constellation.hbs", template_key: "x" },
    };
    const prev = stripExplicitCarouselTemplateSelection(gp);
    expect(prev).toBe("sns5_midnight_constellation");
    expect(gp.template).toBeUndefined();
    expect(gp.render).toBeUndefined();
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

  it("excludes previous template name when carousel_template_exclude_for_next_render is set", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ templates: ["a.hbs", "b.hbs"] }),
      })
    );
    const p = await pickCarouselTemplateForRender("http://renderer:3333", {
      carousel_template_exclude_for_next_render: "a",
    });
    expect(p).toBe("b");
  });
});

describe("renderer templates guardrails", () => {
  function readTemplateSource(name: string): string {
    const repoRoot = process.cwd();
    const p = path.join(repoRoot, "services", "renderer", "templates", `${name}.hbs`);
    return fs.readFileSync(p, "utf8");
  }

  it("carousel_sns_chat_story uses larger bubble font size", () => {
    const src = readTemplateSource("carousel_sns_chat_story");
    expect(src).toContain("font-size: 44px");
  });

  it("carousel_neon_grid increases body-text and improves cover subtitle contrast", () => {
    const src = readTemplateSource("carousel_neon_grid");
    expect(src).toContain(".body-text {");
    expect(src).toContain("font-size: clamp(46px");
    expect(src).toContain("background: rgba(10,10,15,0.62)");
    expect(src).toContain("font-family: 'Outfit', sans-serif");
    expect(src).toContain("color: var(--bone)");
  });

  it("carousel_sns_bold_text increases body font size and keeps CTA single", () => {
    const src = readTemplateSource("carousel_sns_bold_text");
    expect(src).toContain("font-size:56px");
    expect(src).toContain("Follow us for more.");
    expect(src).toContain("cta--single");
    const ctaKicker = src.indexOf("Final / CTA");
    expect(ctaKicker).toBeGreaterThan(-1);
    expect(src.slice(ctaKicker)).not.toContain('<div class="body">');
  });

  it("carousel_sns_numbered_system increases body sizes and removes swipe footer", () => {
    const src = readTemplateSource("carousel_sns_numbered_system");
    expect(src).toContain("font-size:56px");
    expect(src).not.toContain("Swipe for the next one.");
  });

  it("carousel_candy_pop forbids tilted text in cover and CTA", () => {
    const src = readTemplateSource("carousel_candy_pop");
    expect(src).toContain("cover-title");
    expect(src).toContain("transform: none !important");
  });

  it("carousel_blue_handwriting_paper left-aligns cover, body slides, and joins emoji orphans", () => {
    const src = readTemplateSource("carousel_blue_handwriting_paper");
    expect(src).toContain(".wrap.wrap--tight{");
    expect(src).toContain(".wrap.wrap--body");
    expect(src).toContain("joinEmojiOrphans");
    expect(src).toContain("text-align: left;");
  });

  it("sns5_midnight_constellation left-aligns body slides", () => {
    const src = readTemplateSource("sns5_midnight_constellation");
    expect(src).toContain("sns5--body");
    expect(src).toContain("joinEmojiOrphans");
  });

  it("carousel_kristy_gold_editorial bumps cover and CTA headline sizes", () => {
    const src = readTemplateSource("carousel_kristy_gold_editorial");
    expect(src).toContain("font-size: 136px;");
    expect(src).toContain("font-size: 34px;");
    expect(src).toContain("font-size:126px");
    expect(src).toContain("font-size: 28px;");
  });

  it("carousel_cosmic_kitchen uses a text panel for contrast over orbits", () => {
    const src = readTemplateSource("carousel_cosmic_kitchen");
    expect(src).toContain(".text-panel");
    expect(src).toContain("background: rgba(18, 16, 22, 0.82);");
  });

  it("carousel_splash_party avoids tilted script secondary and flattens underline", () => {
    const src = readTemplateSource("carousel_splash_party");
    expect(src).toContain("transform: none !important");
    expect(src).toContain(".subtitle-script");
    expect(src).toContain("font-family: 'Outfit', sans-serif;");
    expect(src).toContain("translateX(-50%) rotate(0deg)");
  });
});
