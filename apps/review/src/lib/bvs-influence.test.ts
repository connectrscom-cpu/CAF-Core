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
        },
      },
    });
    expect(ctx.enabled).toBe(true);
    expect(ctx.bible_version).toBe(3);
    expect(ctx.snapshot?.palette).toEqual(["#F4D03F"]);
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
});
