import { describe, expect, it, vi } from "vitest";
import { buildBrandBibleSnapshot, parseBrandBible } from "../domain/brand-bible.js";
import {
  brandBibleSnapshotToHeygenFiles,
  mergeHeygenVideoAgentFiles,
  resolveHeygenFilesForHeyGenSubmit,
} from "./brand-heygen-files.js";
import * as supabaseStorage from "./supabase-storage.js";

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

describe("resolveHeygenFilesForHeyGenSubmit", () => {
  it("replaces private Supabase public URLs with signed fetchable URLs", async () => {
    vi.spyOn(supabaseStorage, "fetchableUrlFromAssetRow").mockResolvedValue(
      "https://proj.supabase.co/storage/v1/object/sign/assets/brand-kit/logo.png?token=abc"
    );
    const config = { SUPABASE_ASSETS_BUCKET: "assets" } as never;
    const rows = [
      {
        id: "s1",
        public_url: "https://proj.supabase.co/storage/v1/object/public/assets/brand-kit/logo.png",
        storage_path: "assets/brand-kit/logo.png",
      },
    ] as never;
    const resolved = await resolveHeygenFilesForHeyGenSubmit(
      config,
      [{ type: "url", url: "https://proj.supabase.co/storage/v1/object/public/assets/brand-kit/logo.png" }],
      rows
    );
    expect(resolved).toEqual([
      {
        type: "url",
        url: "https://proj.supabase.co/storage/v1/object/sign/assets/brand-kit/logo.png?token=abc",
      },
    ]);
    vi.restoreAllMocks();
  });

  it("keeps heygen asset_id entries unchanged", async () => {
    const config = { SUPABASE_ASSETS_BUCKET: "assets" } as never;
    const resolved = await resolveHeygenFilesForHeyGenSubmit(
      config,
      [{ type: "asset_id", asset_id: "hey_123" }],
      []
    );
    expect(resolved).toEqual([{ type: "asset_id", asset_id: "hey_123" }]);
  });
});
