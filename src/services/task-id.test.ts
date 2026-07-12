import { describe, expect, it } from "vitest";
import {
  isCarouselAllowedPlatform,
  normalizeCarouselIdeaPlatform,
} from "./task-id.js";

describe("carousel idea platforms", () => {
  it("accepts Instagram and Facebook only", () => {
    expect(isCarouselAllowedPlatform("Instagram")).toBe(true);
    expect(isCarouselAllowedPlatform("facebook")).toBe(true);
    expect(isCarouselAllowedPlatform("Pinterest")).toBe(false);
    expect(isCarouselAllowedPlatform("YouTube")).toBe(false);
  });

  it("normalizes unsupported platforms with IG/FB alternation", () => {
    expect(normalizeCarouselIdeaPlatform("Pinterest", 0)).toBe("Instagram");
    expect(normalizeCarouselIdeaPlatform("YouTube", 1)).toBe("Facebook");
    expect(normalizeCarouselIdeaPlatform("IG")).toBe("Instagram");
    expect(normalizeCarouselIdeaPlatform("fb")).toBe("Facebook");
  });
});
