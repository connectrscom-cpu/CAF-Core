import { describe, expect, it } from "vitest";
import { buildBvsInfluenceSections, parseBvsFromGenerationPayload } from "./bvs-influence";

describe("parseBvsFromGenerationPayload", () => {
  it("reads enabled snapshot from generation_payload", () => {
    const ctx = parseBvsFromGenerationPayload({
      bvs_v1: {
        schema_version: "bvs_v1",
        enabled: true,
        bible_version: 3,
        bible_snapshot: {
          schema_version: "brand_bible_v1",
          visual_mode: "minimal_editorial",
          visual_mode_custom: null,
          palette: ["#F4D03F"],
          allowed_motifs: ["botanical"],
          forbidden_motifs: [],
          application_guide: {
            instructions: "Calm premium look",
            content_aims: ["education"],
            mimic_policy: "Structure only",
            original_policy: null,
          },
          asset_refs: [],
          resolved_assets: [],
          flux_prompt_asset_ids: ["a1"],
        },
      },
    });
    expect(ctx.enabled).toBe(true);
    expect(ctx.bible_version).toBe(3);
    expect(ctx.snapshot?.palette).toEqual(["#F4D03F"]);
    expect(ctx.snapshot?.flux_prompt_asset_ids).toEqual(["a1"]);
  });
});

describe("buildBvsInfluenceSections", () => {
  it("explains when BVS is disabled", () => {
    const sections = buildBvsInfluenceSections({
      enabled: false,
      bible_version: null,
      snapshot: null,
      mimicEnabled: false,
    });
    expect(sections[0]?.title).toBe("Brand Visual System");
    expect(sections[0]?.lines[0]).toMatch(/BVS was off/);
  });

  it("lists explicit Flux prompt references when snapshot has flux_prompt_asset_ids", () => {
    const sections = buildBvsInfluenceSections({
      enabled: true,
      bible_version: 2,
      mimicEnabled: true,
      snapshot: {
        visual_mode: "illustrated_cartoon",
        visual_mode_custom: null,
        palette: ["#112244"],
        allowed_motifs: [],
        forbidden_motifs: [],
        application_guide: {
          instructions: "",
          content_aims: [],
          mimic_policy: null,
          original_policy: null,
        },
        flux_prompt_asset_ids: ["a1"],
        resolved_assets: [
          {
            asset_id: "a1",
            role: "style_reference",
            label: "Star field",
            usage_notes: "Deep cosmic gradient",
            public_url: "https://example.com/a1.png",
            kind: "reference_image",
          },
        ],
        heygen_presenters: [],
      },
    });
    const bibleSection = sections.find((s) => s.title === "Your brand bible");
    expect(bibleSection?.lines.some((l) => l.includes("Flux prompt references"))).toBe(true);
  });
});
