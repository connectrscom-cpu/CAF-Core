import { describe, expect, it, vi, afterEach } from "vitest";
import {
  explicitCarouselTemplateBaseName,
  pickCarouselTemplateForRender,
  slidesFromGeneratedOutput,
  slideHasRenderableContent,
} from "./carousel-render-pack.js";

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

  it("uses slides when they contain real text even if carousel exists", () => {
    const gen = {
      slides: [{ headline: "Real", body: "From slides" }],
      carousel: [{ headline: "Other", body: "From carousel" }],
    };
    const slides = slidesFromGeneratedOutput(gen);
    expect(slides[0]?.headline).toBe("Real");
  });

  it("slideHasRenderableContent is false for role-only placeholders", () => {
    expect(slideHasRenderableContent({ slide_role: "cover" })).toBe(false);
    expect(slideHasRenderableContent({ headline: "x", body: "" })).toBe(true);
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
