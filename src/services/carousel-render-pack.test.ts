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
  stripAirQuotesFromSlideCopy,
  stripLeakedFieldLabelsFromSlideCopy,
  stripExplicitCarouselTemplateSelection,
  stripHashtagsFromSlideCopy,
  stripNonRenderableDeckFields,
  synchronizeCoverRootStringFields,
  withInlinedBackgroundImage,
} from "./carousel-render-pack.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";

vi.mock("./supabase-storage.js", () => ({
  downloadBufferFromUrl: vi.fn(async () => Buffer.from("fakepng")),
}));

describe("synchronizeCoverRootStringFields", () => {
  it("flattens legacy object cover into headline/subtitle strings", () => {
    const ctx: Record<string, unknown> = {
      cover: { kicker: "X", headline: "H", cover_subtitle: "Sub text here" },
      cover_slide: { headline: "From slide", body: "Body line" },
    };
    synchronizeCoverRootStringFields(ctx);
    expect(ctx.cover).toBe("From slide");
    expect(ctx.cover_subtitle).toBe("Body line");
  });
});

describe("stripHashtagsFromSlideCopy", () => {
  it("removes spaced #hashtag tokens from slide copy", () => {
    expect(stripHashtagsFromSlideCopy("Hook line #viral #fyp and more")).toBe("Hook line and more");
  });

  it("does not strip #1 style ordinals (digit after #)", () => {
    expect(stripHashtagsFromSlideCopy("Top #1 tip for you")).toBe("Top #1 tip for you");
  });
});

describe("stripAirQuotesFromSlideCopy", () => {
  it("removes curly and straight double quotes, preserves apostrophes", () => {
    expect(stripAirQuotesFromSlideCopy("“Try saying” \"hello\" and I'm here")).toBe("Try saying hello and I'm here");
  });
});

describe("stripLeakedFieldLabelsFromSlideCopy", () => {
  it("removes leading label prefixes like 'Kicker:'", () => {
    expect(stripLeakedFieldLabelsFromSlideCopy("Kicker: Community Spotlight\nHello")).toBe("Community Spotlight\nHello");
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
  it("reads cover_slide + body_slides + cta_slide with nested text blocks", () => {
    const gen = {
      package_type: "mimic_carousel_package",
      copy: {
        carousel: {
          cover_slide: {
            text: { headline: "Unlocking Your Zodiac", body: "Discover unique traits." },
          },
          body_slides: [
            { text: { headline: "Aries: Trailblazer", body: "Bold and fiery." } },
            { text: { headline: "Taurus: Grounded", body: "Steady and loyal." } },
          ],
          cta_slide: {
            text: { headline: "Discover More", body: "Visit @signandsound." },
          },
        },
      },
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides).toHaveLength(4);
    expect(slides[0]?.headline).toBe("Unlocking Your Zodiac");
    expect(slides[1]?.headline).toBe("Aries: Trailblazer");
    expect(slides[3]?.headline).toBe("Discover More");
  });

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

  it("slideHasRenderableContent accepts mimic text_blocks without top-level headline/body", () => {
    expect(
      slideHasRenderableContent({
        text_blocks: [{ role: "title", text: "Aries and their Admiration" }],
        visual_description: "figure with swords",
      })
    ).toBe(true);
    expect(
      slideHasRenderableContent({
        elements: {
          text_blocks: [{ role: "subtitle", text: "Born to cast lines" }],
        },
      })
    ).toBe(true);
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

  it("preferred_slide_count picks canonical slides[] over richer stale carousel deck", () => {
    const gen = {
      slides: [
        { headline: "Aries", body: "Destined to roam wild, yet spending days in calls" },
        { headline: "Gemini", body: "Born to cast lines but ends up catching scams" },
      ],
      carousel: {
        slides: [
          { headline: "Aries", body: "Destined to roam wild, yet spending days in calls" },
          { headline: "Gemini", body: "Born to cast lines but ends up catching scams" },
          { headline: "Cancer", body: "Placeholder third slide with extra body copy here." },
          { headline: "Leo", body: "Placeholder fourth slide with extra body copy here." },
        ],
      },
    };
    const slides = slidesFromGeneratedOutput(gen, { preferred_slide_count: 2 });
    expect(slides).toHaveLength(2);
    expect(slides[0]?.headline).toBe("Aries");
    expect(slides[1]?.headline).toBe("Gemini");
  });

  it("normalizeItemSlide keeps positioned text_blocks without duplicating headline/body", () => {
    const gen = {
      slides: [
        {
          headline: "Aries",
          body: "Destined to roam wild",
          elements: {
            text_blocks: [
              { role: "title", text: "ARIES", x: 0.68, y: 0.6, w: 0.24, h: 0.12 },
              { role: "subtitle", text: "Destined to roam wild", x: 0.68, y: 0.7, w: 0.24, h: 0.08 },
            ],
          },
        },
      ],
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides[0]?.headline).toBeUndefined();
    expect(slides[0]?.body).toBeUndefined();
    const blocks = (slides[0] as Record<string, unknown>).elements as Record<string, unknown>;
    expect(Array.isArray(blocks?.text_blocks)).toBe(true);
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

  it("maps cover_title and cover_subtitle from mimic-style cover slides", () => {
    const gen = {
      slides: [
        {
          cover_title: "Uncover Your Zodiac's Influence",
          cover_subtitle: "Discover personal growth through the lens of your zodiac.",
          slide_role: "cover",
        },
        { headline: "Aries", body: "Bold energy" },
        { headline: "CTA", body: "Follow @brand" },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    expect(slideHasRenderableContent(flat[0]!)).toBe(true);
    const ctx = buildSlideRenderContext(gen, flat, 1);
    expect(String((ctx.cover_slide as { headline?: string }).headline)).toContain("Uncover Your Zodiac");
    expect(String(ctx.cover_subtitle ?? "")).toContain("Discover personal growth");
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
    // CTA panel body comes from the CTA slide body; "handle line" is only set when it looks like @username.
    expect((ctx.cta_slide as { body?: string; handle?: string }).body).toBe("B3");
    expect((ctx.cta_slide as { handle?: string }).handle).toBeUndefined();
  });

  it("maps panel_body into body_slides when body is empty (adapter drift)", () => {
    const gen = {
      slides: [
        { headline: "Cover", body: "Hook" },
        { headline: "Point one", panel_body: "Paragraph that only lived in panel_body." },
        { headline: "CTA", body: "Follow @brand" },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    const ctx = buildSlideRenderContext(gen, flat, 2, { instagramHandle: "@brand" });
    const bs = ctx.body_slides as Array<{ headline?: string; body?: string }>;
    expect(bs).toHaveLength(1);
    expect(String(bs[0]?.body ?? "")).toContain("Paragraph that only lived in panel_body");
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
    expect((ctx.cta_slide as { body?: string }).body).toBe("d");
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
    // Handle is now appended to CTA body text (`cta_slide.sub`) instead of being rendered as its own line.
    expect(String((ctx.cta_slide as { sub?: string }).sub ?? "")).toContain("@mybrand");
    expect(String((ctx.cta_slide as { sub?: string }).sub ?? "")).toMatch(/@mybrand\s*$/);
  });

  it("shortens overly long CTA text for headline-style templates", () => {
    const gen = {
      slides: [
        { headline: "Cover", body: "Hook" },
        {
          headline: "",
          body: "Ready to share your sign's unique tale? Submit your stories and visuals with us, and foster a deeper connection with the stars.",
        },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    const ctx = buildSlideRenderContext(gen, flat, 2, { instagramHandle: "@brand" });
    expect(String(ctx.cta_text).length).toBeLessThanOrEqual(111);
    expect(String(ctx.cta_text)).toContain("Ready to share your sign");
    // Ensure the template fallback path still uses the shortened value.
    expect(String((ctx.cta_slide as { body?: string }).body).length).toBeLessThanOrEqual(111);
    expect(ctx.cta_handle).toBe("@brand");
  });

  it("injects per-slide micro-action panel fields when missing", () => {
    const gen = {
      slides: [
        { headline: "Cover", body: "Hook" },
        { headline: "Interactive Quiz Time!", body: "Ready to start your compatibility journey? Engage with our interactive zodiac quiz." },
        { headline: "CTA", body: "Follow @brand" },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    const ctx = buildSlideRenderContext(gen, flat, 2, { instagramHandle: "@brand" });
    const bs = ctx.body_slides as Array<{ panel_title?: string; panel_body?: string; headline?: string }>;
    expect(bs).toHaveLength(1);
    expect(bs[0]?.panel_title).toBe("Micro-action");
    expect(String(bs[0]?.panel_body ?? "")).toContain("Pick one question");
  });

  it("varies default micro-action panel_body across body slides (non-repeating)", () => {
    const gen = {
      slides: [
        { headline: "Cover", body: "Hook" },
        { headline: "Body 1", body: "Some helpful idea." },
        { headline: "Body 2", body: "Some helpful idea." },
        { headline: "Body 3", body: "Some helpful idea." },
        { headline: "CTA", body: "Follow @brand" },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    const ctx = buildSlideRenderContext(gen, flat, 2, { instagramHandle: "@brand" });
    const bs = ctx.body_slides as Array<{ panel_body?: string }>;
    expect(bs).toHaveLength(3);
    const bodies = bs.map((s) => String(s.panel_body ?? "").trim()).filter(Boolean);
    expect(new Set(bodies).size).toBeGreaterThan(1);
  });

  it("strips double-quote air quotes from slide headline/body", () => {
    const gen = {
      slides: [
        { headline: "\"Cover\"", body: "“Quoted body”" },
        { headline: "CTA", body: "Follow @brand" },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen) as Array<{ headline?: string; body?: string }>;
    expect(flat[0]?.headline).toBe("Cover");
    expect(flat[0]?.body).toBe("Quoted body");
  });

  it("never renders [object Object] for cta_text when upstream passes objects", () => {
    const gen = {
      cta_text: { bogus: true },
      slides: [
        { headline: "Cover", body: "Hook" },
        { headline: "CTA", body: "" },
      ],
    };
    const flatAll = slidesFromGeneratedOutput(gen);
    const flat = flatAll.filter((s) => slideHasRenderableContent(s as Record<string, unknown>));
    const ctx = buildSlideRenderContext(gen, flat, 1, { instagramHandle: "@brand" });
    expect(String(ctx.cta_text)).not.toBe("[object Object]");
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

  it("buildSlideRenderContext: root carousel_* px overrides nested render (live preview + rework)", () => {
    const gen = {
      carousel_body_font_px: 88,
      render: { carousel_body_font_px: 44 },
      slides: [
        { headline: "Cover", body: "Hook" },
        { headline: "CTA", body: "@brand" },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    const ctx = buildSlideRenderContext(gen, flat, 1);
    expect(ctx.carousel_body_font_px).toBe(88);
  });
});

describe("withInlinedBackgroundImage", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inlines Supabase URLs via downloadBufferFromUrl when config is provided", async () => {
    const { downloadBufferFromUrl } = await import("./supabase-storage.js");
    const out = await withInlinedBackgroundImage(
      {
        background_image_url:
          "https://proj.supabase.co/storage/v1/object/public/assets/mimic_backgrounds/slide_002_bg_v1.png",
      },
      { config: { SUPABASE_URL: "https://proj.supabase.co" } as import("../config.js").AppConfig }
    );
    expect(downloadBufferFromUrl).toHaveBeenCalled();
    expect(String(out.background_image_url)).toMatch(/^data:image\/png;base64,/);
  });

  it("throws in strict mode when inline fails", async () => {
    const { downloadBufferFromUrl } = await import("./supabase-storage.js");
    vi.mocked(downloadBufferFromUrl).mockRejectedValueOnce(new Error("403 forbidden"));
    await expect(
      withInlinedBackgroundImage(
        { background_image_url: "https://proj.supabase.co/storage/v1/object/public/assets/bg.png" },
        {
          config: { SUPABASE_URL: "https://proj.supabase.co" } as import("../config.js").AppConfig,
          strict: true,
        }
      )
    ).rejects.toThrow(/refusing plain-paper composite/i);
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
    expect(
      reviewRequestsCarouselTemplateChange({
        rejection_tags: ["carousel_template_change"],
        notes: null,
        overrides_json: { carousel_rework_change_template: false },
      })
    ).toBe(false);
    expect(
      reviewRequestsCarouselTemplateChange({
        rejection_tags: [],
        notes: "",
        overrides_json: { carousel_rework_change_template: true },
      })
    ).toBe(true);
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

  it("restricts random picks to allowedTemplates when provided", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ templates: ["a.hbs", "b.hbs"] }),
      })
    );
    const p = await pickCarouselTemplateForRender(
      "http://renderer:3333",
      {},
      { allowedTemplates: ["a.hbs"] }
    );
    expect(p).toBe("a");
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

  it("picks the same implicit template when implicitPickSeed matches (stable across calls)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ templates: ["default.hbs", "alt.hbs", "third.hbs"] }),
      })
    );
    const opts = { implicitPickSeed: "RUN001__Instagram__FLOW_CAROUSEL__row0001__v1" };
    const a = await pickCarouselTemplateForRender("http://renderer:3333", {}, opts);
    const b = await pickCarouselTemplateForRender("http://renderer:3333", {}, opts);
    expect(a).toBe(b);
    expect(["default", "alt", "third"]).toContain(a);
  });

  it("falls back to allowedTemplates when renderer template list is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    const p = await pickCarouselTemplateForRender(
      "http://renderer:3333",
      {},
      { allowedTemplates: ["only_one.hbs"] }
    );
    expect(p).toBe("only_one");
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
    expect(src).toContain("--caf-carousel-body-size: 56px");
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

describe("mimic carousel copy shapes", () => {
  it("extracts headline/body from carousel.slides[].content (hook/story roles)", () => {
    const gen = {
      carousel: {
        slides: [
          {
            role: "hook_slide",
            index: 0,
            content: { headline: "Reflect on the Cosmos", subline: "What does this month say?" },
          },
          {
            role: "story_slide",
            index: 1,
            content: { headline: "Aries Insight", subline: "Dive into new experiences." },
          },
        ],
      },
    };
    const flat = slidesFromGeneratedOutput(gen);
    expect(flat.length).toBeGreaterThanOrEqual(2);
    expect(slideHasRenderableContent(flat[0]!)).toBe(true);
    expect(slideHasRenderableContent(flat[1]!)).toBe(true);
    expect(String(flat[0]?.headline ?? "")).toContain("Reflect on the Cosmos");
    expect(String(flat[0]?.body ?? "")).toContain("What does this month say");
  });

  it("unwraps per-slide cover/body_slide/cta_slide wrappers", () => {
    const gen = {
      slides: [
        {
          slide_number: 1,
          cover: {
            headline: "What Your Sign Says About Your Love Style",
            body: "Explore how your zodiac sign influences love.",
            kicker: "Astro Insight",
          },
        },
        {
          slide_number: 2,
          body_slide: {
            headline: "Aries: The Passionate Pursuer",
            body: "Aries, your bold and direct energy means you dive into love with enthusiasm.",
          },
        },
        {
          slide_number: 12,
          cta_slide: {
            headline: "Discover More About Your Sign's Love Language",
            sub: "Dive deeper into astrology.",
            cta: "Follow @signandsound",
          },
        },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    expect(flat.filter((s) => slideHasRenderableContent(s as Record<string, unknown>))).toHaveLength(3);
    expect(String(flat[0]?.headline ?? "")).toContain("What Your Sign Says");
    expect(String(flat[1]?.headline ?? "")).toContain("Aries");
    expect(String(flat[2]?.headline ?? "")).toContain("Discover More");
  });

  it("treats panel_title + body as renderable mimic copy", () => {
    const gen = {
      slides: [
        {
          panel_title: "Aries Attraction",
          body: "Ever wondered what draws an Aries to you?",
          slide_role: "cover",
        },
        {
          panel_title: "Taurus Values",
          body: "Uncover the grounding elements that a Taurus cherishes.",
          slide_role: "body",
        },
      ],
    };
    const flat = slidesFromGeneratedOutput(gen);
    expect(flat).toHaveLength(2);
    expect(slideHasRenderableContent(flat[0]!)).toBe(true);
    expect(String(flat[0]?.headline ?? "")).toBe("Aries Attraction");
    expect(String(flat[0]?.body ?? "")).toContain("Ever wondered");
  });
});
