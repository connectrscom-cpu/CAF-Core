import { describe, expect, it } from "vitest";
import {
  buildBrandBiblePromptBlock,
  buildBrandBibleSnapshot,
  parseBrandBible,
} from "./brand-bible.js";

describe("parseBrandBible", () => {
  it("parses application guide and asset refs", () => {
    const bible = parseBrandBible({
      schema_version: "brand_bible_v1",
      visual_mode: "minimal_editorial",
      palette: ["#88b04b", "#2c2a26"],
      application_guide: {
        instructions: "Always use botanical motifs. No faces.",
        content_aims: ["education", "awareness"],
        mimic_policy: "Structure only — never copy competitor visuals.",
      },
      asset_refs: [{ asset_id: "a1", role: "style_reference", label: "Moodboard" }],
    });
    expect(bible?.application_guide.instructions).toContain("botanical");
    expect(bible?.asset_refs[0]?.role).toBe("style_reference");
  });

  it("returns null for empty payload", () => {
    expect(parseBrandBible({})).toBeNull();
  });
});

describe("buildBrandBiblePromptBlock", () => {
  it("includes mimic invariant when forMimic", () => {
    const bible = parseBrandBible({
      visual_mode: "illustrated_cartoon",
      application_guide: { instructions: "Use mascot Leafy on every slide." },
    });
    expect(bible).not.toBeNull();
    const snap = buildBrandBibleSnapshot(bible!, []);
    const block = buildBrandBiblePromptBlock(snap, { forMimic: true });
    expect(block).toContain("Brand Visual System");
    expect(block).toContain("never reproduce the competitor");
    expect(block).toContain("Leafy");
  });
});
