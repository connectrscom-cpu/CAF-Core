import { describe, expect, it } from "vitest";
import { buildBvsSlice, isBvsEnabledForCandidate, parseBvsV1 } from "./bvs-v1.js";

describe("bvs_v1", () => {
  it("detects enabled flag on candidate data", () => {
    expect(isBvsEnabledForCandidate({ use_brand_visual_system: true })).toBe(true);
    expect(isBvsEnabledForCandidate({ use_brand_visual_system: false })).toBe(false);
  });

  it("round-trips bvs slice", () => {
    const slice = buildBvsSlice(true, 2, {
      schema_version: "brand_bible_v1",
      visual_mode: "minimal_editorial",
      visual_mode_custom: null,
      palette: ["#fff"],
      allowed_motifs: [],
      forbidden_motifs: [],
      application_guide: {
        instructions: "Calm nature aesthetic.",
        content_aims: [],
        mimic_policy: null,
        original_policy: null,
      },
      asset_refs: [],
      resolved_assets: [],
    });
    const parsed = parseBvsV1(slice);
    expect(parsed?.enabled).toBe(true);
    expect(parsed?.bible_version).toBe(2);
    expect(parsed?.bible_snapshot?.application_guide.instructions).toContain("Calm");
  });
});
