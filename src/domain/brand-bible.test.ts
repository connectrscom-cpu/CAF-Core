import { describe, expect, it } from "vitest";
import {
  buildBrandBiblePromptBlock,
  buildBrandBibleSnapshot,
  buildBibleFromBrandAssets,
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

describe("buildBibleFromBrandAssets", () => {
  it("builds bible from moodboard palette and reference rows", () => {
    const bible = buildBibleFromBrandAssets([
      {
        id: "p1",
        project_id: "x",
        kind: "palette",
        label: "Brand",
        sort_order: 0,
        public_url: null,
        storage_path: null,
        heygen_asset_id: null,
        heygen_synced_at: null,
        metadata_json: { colors: ["#ffff00", "#7ae9ff"] },
        created_at: "",
        updated_at: "",
      },
      {
        id: "r1",
        project_id: "x",
        kind: "reference_image",
        label: "Style ref",
        sort_order: 1,
        public_url: "https://example.com/a.png",
        storage_path: "brand-kit/x/a.png",
        heygen_asset_id: null,
        heygen_synced_at: null,
        metadata_json: {},
        created_at: "",
        updated_at: "",
      },
    ]);
    expect(bible?.palette).toEqual(["#ffff00", "#7ae9ff"]);
    expect(bible?.asset_refs[0]?.role).toBe("style_reference");
    expect(bible?.application_guide.mimic_policy).toContain("Never reproduce");
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
