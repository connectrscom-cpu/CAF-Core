import { describe, expect, it } from "vitest";
import { clampHashtagsToSignalPackAllowlist } from "./product-video-hashtags.js";

describe("clampHashtagsToSignalPackAllowlist", () => {
  it("keeps model picks that exist on the allowlist and pads in allowlist order", () => {
    const out = clampHashtagsToSignalPackAllowlist(["astrology", "nope", "ZodiacSigns"], ["astrology", "moon", "zodiacsigns"], 4);
    expect(out).toEqual(["astrology", "zodiacsigns", "moon"]);
  });

  it("returns allowlist prefix when model tags are empty", () => {
    expect(clampHashtagsToSignalPackAllowlist([], ["one", "two"], 2)).toEqual(["one", "two"]);
  });
});
