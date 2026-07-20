import { describe, expect, it } from "vitest";
import { resolveBrandSlideLogos } from "./brand-asset-url";

describe("resolveBrandSlideLogos", () => {
  it("prefers bible logo roles and appends kit logos not already listed", () => {
    const logos = resolveBrandSlideLogos(
      "sns",
      [
        { asset_id: "logo-light", role: "logo", label: "Light", public_url: "https://cdn.example/light.png" },
        { asset_id: "logo-dark", role: "logo", label: "Dark", public_url: "https://cdn.example/dark.png" },
        { asset_id: "frame-1", role: "slide_frame", label: "Frame" },
      ],
      [
        { id: "logo-light", kind: "logo", public_url: "https://cdn.example/light.png" },
        { id: "logo-kit-only", kind: "logo", public_url: "https://cdn.example/kit.png" },
        { id: "other", kind: "other", public_url: "https://cdn.example/other.png" },
      ]
    );
    expect(logos.map((l) => l.assetId)).toEqual(["logo-light", "logo-dark", "logo-kit-only"]);
    expect(logos[0]?.label).toBe("Light");
    expect(logos[2]?.label).toBe("Logo");
  });

  it("falls back to kit logos when bible has none", () => {
    const logos = resolveBrandSlideLogos(
      "sns",
      [{ asset_id: "frame-1", role: "slide_frame" }],
      [{ id: "kit-logo", kind: "logo", public_url: "https://cdn.example/kit.png" }]
    );
    expect(logos).toHaveLength(1);
    expect(logos[0]?.assetId).toBe("kit-logo");
  });
});
