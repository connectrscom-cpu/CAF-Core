import { describe, expect, it } from "vitest";
import {
  buildBrandBiblePromptBlock,
  buildBrandBibleSnapshot,
  buildBibleFromBrandAssets,
  parseBrandBible,
  resolveExplicitFluxPromptAssets,
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

  it("parses mascot, slide_frame roles and heygen presenters", () => {
    const bible = parseBrandBible({
      visual_mode: "illustrated_cartoon",
      asset_refs: [
        { asset_id: "m1", role: "mascot", label: "Cosmic guide" },
        { asset_id: "f1", role: "slide_frame", label: "Orbit border" },
      ],
      heygen_presenters: [
        {
          label: "Primary host",
          avatar_id: "av_123",
          voice_id: "vo_456",
          avatar_name: "Stellar Host",
          voice_name: "Warm EN",
        },
      ],
    });
    expect(bible?.asset_refs.map((r) => r.role)).toEqual(["mascot", "slide_frame"]);
    expect(bible?.heygen_presenters[0]?.avatar_id).toBe("av_123");
    expect(bible?.heygen_presenters[0]?.voice_id).toBe("vo_456");
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

  it("includes mascot, slide frame, and heygen presenter lines", () => {
    const bible = parseBrandBible({
      asset_refs: [
        { asset_id: "m1", role: "mascot" },
        { asset_id: "f1", role: "slide_frame" },
      ],
      heygen_presenters: [{ label: "Cosmic host", avatar_id: "av_1", voice_id: "vo_1" }],
    });
    expect(bible).not.toBeNull();
    const snap = buildBrandBibleSnapshot(bible!, [
      {
        id: "m1",
        project_id: "x",
        kind: "reference_image",
        label: "Guide",
        sort_order: 0,
        public_url: "https://example.com/m.png",
        storage_path: null,
        heygen_asset_id: null,
        heygen_synced_at: null,
        metadata_json: {},
        created_at: "",
        updated_at: "",
      },
      {
        id: "f1",
        project_id: "x",
        kind: "reference_image",
        label: "Frame",
        sort_order: 1,
        public_url: "https://example.com/f.png",
        storage_path: null,
        heygen_asset_id: null,
        heygen_synced_at: null,
        metadata_json: {},
        created_at: "",
        updated_at: "",
      },
    ]);
    const block = buildBrandBiblePromptBlock(snap, { forMimic: true });
    expect(block).toContain("Brand mascots");
    expect(block).toContain("Slide frames/borders");
    expect(block).toContain("Video presenters (HeyGen)");
    expect(block).toContain("Cosmic host");
  });

  it("emits per-asset Flux prompt lines when flux_prompt_asset_ids is set", () => {
    const bible = parseBrandBible({
      visual_mode: "illustrated_cartoon",
      flux_prompt_asset_ids: ["s1", "s2"],
      asset_refs: [
        { asset_id: "s1", role: "style_reference", label: "Cosmic wash", usage_notes: "Deep indigo star fields" },
        { asset_id: "s2", role: "mascot", label: "Leafy guide", usage_notes: "Friendly cosmic mascot" },
        { asset_id: "x1", role: "background", label: "Unused plate" },
      ],
    });
    expect(bible).not.toBeNull();
    const snap = buildBrandBibleSnapshot(bible!, [
      {
        id: "s1",
        project_id: "x",
        kind: "reference_image",
        label: "Cosmic wash",
        sort_order: 0,
        public_url: "https://example.com/s1.png",
        storage_path: null,
        heygen_asset_id: null,
        heygen_synced_at: null,
        metadata_json: {},
        created_at: "",
        updated_at: "",
      },
      {
        id: "s2",
        project_id: "x",
        kind: "reference_image",
        label: "Leafy guide",
        sort_order: 1,
        public_url: "https://example.com/s2.png",
        storage_path: null,
        heygen_asset_id: null,
        heygen_synced_at: null,
        metadata_json: {},
        created_at: "",
        updated_at: "",
      },
    ]);
    const selected = resolveExplicitFluxPromptAssets(snap);
    expect(selected).toHaveLength(2);
    expect(selected[0]?.asset_id).toBe("s1");
    const block = buildBrandBiblePromptBlock(snap, { forMimic: true });
    expect(block).toContain("Flux prompt references (2 selected");
    expect(block).toContain("[style reference] Cosmic wash — Deep indigo star fields");
    expect(block).toContain("[mascot] Leafy guide — Friendly cosmic mascot");
    expect(block).not.toContain("Style references (");
    expect(block).not.toContain("Unused plate");
  });

  it("parses flux_prompt_asset_ids with max cap", () => {
    const bible = parseBrandBible({
      flux_prompt_asset_ids: ["a", "b", "c", "d", "e", "f", "g", "h", "i"],
      application_guide: { instructions: "test" },
    });
    expect(bible?.flux_prompt_asset_ids).toHaveLength(7);
    expect(bible?.flux_prompt_asset_ids).toEqual(["a", "b", "c", "d", "e", "f", "g"]);
  });
});
