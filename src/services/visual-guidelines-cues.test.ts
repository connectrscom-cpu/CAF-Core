import { describe, expect, it } from "vitest";
import { compactCueList, isRedundantCue } from "./visual-guidelines-cues.js";

describe("visual-guidelines-cues", () => {
  it("detects near-duplicate humor lines", () => {
    const a = "Humor, relatability, and a popular theme make this carousel engaging for the audience.";
    const b = "Humor combined with relatable content about zodiac signs resonates with the audience.";
    expect(isRedundantCue(b, [a])).toBe(true);
  });

  it("caps list to max with actionable lines preferred", () => {
    const many = [
      "The carousel uses a consistent visual style with images depicting various people.",
      "Choose a playful character for each zodiac sign.",
      "Use a consistent color palette across slides.",
      "Craft humorous captions for each sign.",
      "Ensure equal margins on all slides.",
      "This Instagram carousel presents a fun take on quarantine.",
      "Select high-quality images for each slide.",
      "Maintain typography hierarchy.",
      "Add sign name at the top of each slide.",
      "Design a grid layout for four signs.",
      "Include a clear CTA on the last slide.",
      "Leverages humor during quarantine for engagement.",
    ];
    const out = compactCueList(many, 10);
    expect(out.length).toBeLessThanOrEqual(10);
    expect(out.some((c) => /^Choose\b/i.test(c))).toBe(true);
  });
});
