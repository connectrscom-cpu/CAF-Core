import { describe, expect, it, vi, afterEach } from "vitest";
import { resolveBrandAssetUploadUrl } from "./brand-asset-upload-url";

describe("resolveBrandAssetUploadUrl", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("uses Next API proxy on local next dev", () => {
    vi.stubGlobal("window", {
      location: { hostname: "localhost", port: "3000", host: "localhost:3000" },
    });
    expect(resolveBrandAssetUploadUrl("Cuisina")).toBe(
      "/api/project-config/brand-assets/upload?project=Cuisina"
    );
  });

  it("uses same-origin Core upload on embedded deploy", () => {
    vi.stubGlobal("window", {
      location: { hostname: "caf-core.fly.dev", port: "", host: "caf-core.fly.dev" },
    });
    expect(resolveBrandAssetUploadUrl("Cuisina")).toBe("/v1/projects/Cuisina/brand-assets/upload");
  });

  it("uses absolute Core URL when review host differs", () => {
    vi.stubEnv("NEXT_PUBLIC_CAF_CORE_URL", "https://caf-core.fly.dev");
    vi.stubGlobal("window", {
      location: { hostname: "review.example.com", port: "", host: "review.example.com" },
    });
    expect(resolveBrandAssetUploadUrl("SNS")).toBe(
      "https://caf-core.fly.dev/v1/projects/SNS/brand-assets/upload"
    );
  });
});
