import { describe, expect, it } from "vitest";
import { slideRoleForIndex } from "../domain/carousel-composite-layout.js";
import {
  compositeTextFromRenderContext,
  escapeXmlText,
  wrapTextToLines,
} from "../services/carousel-composite-text.js";

describe("carousel-composite-layout", () => {
  it("maps slide indices to cover/body/cta roles", () => {
    expect(slideRoleForIndex(1, 5)).toBe("cover");
    expect(slideRoleForIndex(3, 5)).toBe("body");
    expect(slideRoleForIndex(5, 5)).toBe("cta");
    expect(slideRoleForIndex(2, 2)).toBe("cta");
  });
});

describe("carousel-composite-text", () => {
  it("wraps long lines to max width", () => {
    const lines = wrapTextToLines(
      "One two three four five six seven eight nine ten eleven twelve",
      400,
      68,
      700
    );
    expect(lines.length).toBeGreaterThan(1);
  });

  it("escapes XML in text", () => {
    expect(escapeXmlText(`a & b <c>`)).toBe("a &amp; b &lt;c&gt;");
  });

  it("extracts cover and cta copy from render context", () => {
    const ctx = {
      cover: "Hook title",
      cover_subtitle: "Subtitle line",
      cta_text: "Follow for more",
      cta_slide: { sub: "@brand" },
      body_slides: [{ headline: "Tip 1", body: "Detail" }],
      slides: [{ headline: "Hook title" }, { headline: "Tip 1", body: "Detail" }, { headline: "Follow" }],
    };
    const cover = compositeTextFromRenderContext(ctx, 1, 3);
    expect(cover.role).toBe("cover");
    expect(cover.headline).toBe("Hook title");

    const cta = compositeTextFromRenderContext(ctx, 3, 3);
    expect(cta.role).toBe("cta");
    expect(cta.headline).toContain("Follow");
  });
});
