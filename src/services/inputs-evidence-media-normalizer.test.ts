import { describe, expect, it } from "vitest";
import { normalizeGenericVideoEvidenceMedia } from "./inputs-evidence-media-normalizer.js";

describe("normalizeGenericVideoEvidenceMedia", () => {
  it("registers tiktok source video and thumbnail", () => {
    const norm = normalizeGenericVideoEvidenceMedia("tiktok_video", {
      url: "https://www.tiktok.com/@u/video/1",
      video_url: "https://cdn.example/v.mp4",
      thumbnail_url: "https://cdn.example/t.jpg",
    });
    expect(norm?.source_platform).toBe("tiktok");
    expect(norm?.media_assets).toHaveLength(2);
    expect(norm?.media_assets.some((a) => a.asset_role === "source_video")).toBe(true);
    expect(norm?.media_assets.some((a) => a.asset_role === "thumbnail")).toBe(true);
  });

  it("returns null when no video or thumbnail urls", () => {
    expect(normalizeGenericVideoEvidenceMedia("tiktok_video", { caption: "hello" })).toBeNull();
  });
});
