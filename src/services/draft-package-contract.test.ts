import { describe, expect, it } from "vitest";
import { validateAndNormalizeDraftPackage } from "./draft-package-contract.js";

describe("draft-package-contract: carousel publish metadata normalization", () => {
  it("uses metadata.caption/hashtags for carousel warnings + canonical fields", () => {
    const r = validateAndNormalizeDraftPackage("FLOW_CAROUSEL", {
      package_type: "carousel_package",
      slides: [{ headline: "H", body: "B", slide_number: 1 }],
      metadata: {
        caption: "Hello #Libra",
        hashtags: ["libra", "#AstrologyCommunity"],
      },
      variations: [{ caption: "", hashtags: [] }],
    } as any);

    expect(r.errors).toEqual([]);
    expect(r.warnings).not.toContain(
      "carousel_package: missing caption/primary_copy (will reduce publish readiness)"
    );
    expect(r.warnings).not.toContain("carousel_package: missing hashtags (discoverability risk)");
    expect(String(r.output.caption)).toContain("Hello");
    expect(Array.isArray(r.output.hashtags)).toBe(true);
    expect(r.output.hashtags).toContain("libra");
    expect((r.output.variations as any)[0].caption).toContain("Hello");
    expect((r.output.variations as any)[0].hashtags).toContain("libra");
  });

  it("uses carousel.caption/hashtags for carousel warnings + canonical fields", () => {
    const r = validateAndNormalizeDraftPackage("FLOW_CAROUSEL", {
      package_type: "carousel_package",
      slides: [{ headline: "H", body: "B", slide_number: 1 }],
      carousel: {
        slides: [{ headline: "H", body: "B" }],
        caption: "Libra season is here",
        hashtags: ["libraseason", "astrologycommunity"],
      },
      variations: [{ caption: "", hashtags: [] }],
    } as any);

    expect(r.errors).toEqual([]);
    expect(r.warnings).not.toContain(
      "carousel_package: missing caption/primary_copy (will reduce publish readiness)"
    );
    expect(r.warnings).not.toContain("carousel_package: missing hashtags (discoverability risk)");
    expect(String(r.output.caption)).toContain("Libra season");
    expect((r.output.hashtags as any[]).length).toBeGreaterThan(0);
    expect(r.output.hashtags).toContain("libraseason");
  });
});

