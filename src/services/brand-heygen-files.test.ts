import { describe, expect, it } from "vitest";
import { buildBrandBibleSnapshot, parseBrandBible } from "../domain/brand-bible.js";
import {
  brandBibleSnapshotToHeygenFiles,
  mergeHeygenVideoAgentFiles,
} from "./brand-heygen-files.js";

describe("brandBibleSnapshotToHeygenFiles", () => {
  it("prefers heygen_asset_id over public_url for BVS refs", () => {
    const snap = buildBrandBibleSnapshot(
      parseBrandBible({
        asset_refs: [
          { asset_id: "logo1", role: "logo" },
          { asset_id: "s1", role: "style_reference" },
        ],
      })!,
      [
        { id: "logo1", public_url: "https://cdn/logo.png", heygen_asset_id: "hey_logo" },
        { id: "s1", public_url: "https://cdn/style.png", heygen_asset_id: null },
      ] as never
    );
    const files = brandBibleSnapshotToHeygenFiles(snap, [
      {
        id: "logo1",
        public_url: "https://cdn/logo.png",
        heygen_asset_id: "hey_logo",
      },
      {
        id: "s1",
        public_url: "https://cdn/style.png",
        heygen_asset_id: null,
      },
    ] as never);
    expect(files).toEqual([
      { type: "asset_id", asset_id: "hey_logo" },
      { type: "url", url: "https://cdn/style.png" },
    ]);
  });
});

describe("mergeHeygenVideoAgentFiles", () => {
  it("dedupes by asset_id and url when merging", () => {
    const body: Record<string, unknown> = {
      files: [{ type: "asset_id", asset_id: "hey_logo" }],
    };
    mergeHeygenVideoAgentFiles(body, [
      { type: "asset_id", asset_id: "hey_logo" },
      { type: "url", url: "https://cdn/extra.png" },
    ]);
    expect(body.files).toEqual([
      { type: "asset_id", asset_id: "hey_logo" },
      { type: "url", url: "https://cdn/extra.png" },
    ]);
  });
});
