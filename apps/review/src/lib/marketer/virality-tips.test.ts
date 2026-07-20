import { describe, expect, it } from "vitest";
import {
  VIRALITY_TIPS,
  pickViralityTip,
  sourceLabel,
  type ViralityTipPage,
} from "./virality-tips";

const PAGES: ViralityTipPage[] = [
  "ideas",
  "research",
  "intelligence",
  "content",
  "publishing",
  "performance",
  "profile",
  "workspace",
  "cart",
];

describe("virality-tips", () => {
  it("has at least one tip per page", () => {
    for (const page of PAGES) {
      expect(VIRALITY_TIPS.some((t) => t.page === page), `missing tips for ${page}`).toBe(true);
    }
  });

  it("pickViralityTip returns a tip for each page", () => {
    for (const page of PAGES) {
      const tip = pickViralityTip(page);
      expect(tip).not.toBeNull();
      expect(tip!.page).toBe(page);
    }
  });

  it("labels sources clearly", () => {
    expect(sourceLabel("meta_public")).toBe("Meta-backed");
    expect(sourceLabel("benchmark")).toBe("Industry baseline");
  });

  it("does not encode folklore phrases", () => {
    const blob = VIRALITY_TIPS.map((t) => `${t.title} ${t.body}`).join("\n").toLowerCase();
    expect(blob).not.toMatch(/200/);
    expect(blob).not.toMatch(/4.?6.?hour/);
    expect(blob).not.toMatch(/creator account/);
  });
});
