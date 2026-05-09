import { describe, expect, it } from "vitest";
import { estimateCarouselSlideFlyUsd, estimateHeyGenVideoUsd } from "./render-cost-estimate.js";

describe("estimateCarouselSlideFlyUsd", () => {
  it("allocates machine-hour by latency", () => {
    // 3_600_000 ms = 1 hour → $1/h → $1
    expect(estimateCarouselSlideFlyUsd(3_600_000, 1)).toBe(1);
    expect(estimateCarouselSlideFlyUsd(36_000, 10)).toBeCloseTo(0.1, 5);
  });

  it("returns null when rates unset or invalid", () => {
    expect(estimateCarouselSlideFlyUsd(1000, 0)).toBeNull();
    expect(estimateCarouselSlideFlyUsd(0, 5)).toBeNull();
  });
});

describe("estimateHeyGenVideoUsd", () => {
  it("uses per-minute pricing", () => {
    expect(estimateHeyGenVideoUsd(60, 2)).toBe(2);
    expect(estimateHeyGenVideoUsd(30, 2)).toBe(1);
  });

  it("returns null without duration or rate", () => {
    expect(estimateHeyGenVideoUsd(null, 1)).toBeNull();
    expect(estimateHeyGenVideoUsd(60, 0)).toBeNull();
  });
});
