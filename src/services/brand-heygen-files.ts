/**
 * Build HeyGen Video Agent v3 `files` array from project brand assets (max 20).
 */
import {
  resolveHeygenBvsReferenceAssets,
  type BrandBibleResolvedAsset,
  type BrandBibleSnapshotV1,
} from "../domain/brand-bible.js";
import {
  resolveHeygenProductReferenceAssets,
  type ProductBibleSnapshotV1,
} from "../domain/product-bible.js";
import type { ProjectBrandAssetRow } from "../repositories/project-config.js";

const HEYGEN_FILES_MAX = 20;

export type HeygenFileEntry =
  | { type: "asset_id"; asset_id: string }
  | { type: "url"; url: string };

/**
 * Prefer `heygen_asset_id`; else `public_url` as url type. Skips palette-only rows without URLs.
 */
export function brandAssetsToHeygenFiles(assets: ProjectBrandAssetRow[]): HeygenFileEntry[] {
  const out: HeygenFileEntry[] = [];
  for (const a of assets) {
    if (out.length >= HEYGEN_FILES_MAX) break;
    const hid = (a.heygen_asset_id ?? "").trim();
    if (hid) {
      out.push({ type: "asset_id", asset_id: hid });
      continue;
    }
    const u = (a.public_url ?? "").trim();
    if (u && /^https?:\/\//i.test(u)) {
      out.push({ type: "url", url: u });
    }
  }
  return out;
}

function heygenFileKey(entry: HeygenFileEntry): string | null {
  if (entry.type === "asset_id") {
    const id = entry.asset_id?.trim();
    return id ? `asset_id:${id}` : null;
  }
  const url = entry.url?.trim();
  return url ? `url:${url}` : null;
}

/** BVS-referenced assets first (matches prompt File 1…N order); prefers synced HeyGen asset ids. */
export function brandBibleSnapshotToHeygenFiles(
  snapshot: BrandBibleSnapshotV1 | null | undefined,
  projectAssets: ProjectBrandAssetRow[],
  referenceAssets?: BrandBibleResolvedAsset[]
): HeygenFileEntry[] {
  if (!snapshot) return [];
  const refs = referenceAssets ?? resolveHeygenBvsReferenceAssets(snapshot);
  if (refs.length === 0) return [];
  const byId = new Map(projectAssets.map((a) => [a.id, a]));
  const out: HeygenFileEntry[] = [];
  const seen = new Set<string>();
  for (const asset of refs) {
    if (out.length >= HEYGEN_FILES_MAX) break;
    const row = byId.get(asset.asset_id);
    const hid = row?.heygen_asset_id?.trim();
    const url = asset.public_url?.trim() || row?.public_url?.trim();
    if (hid) {
      const key = `asset_id:${hid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: "asset_id", asset_id: hid });
      continue;
    }
    if (url && /^https?:\/\//i.test(url)) {
      const key = `url:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: "url", url });
    }
  }
  return out;
}

/** Product bible screenshots first (workflow steps in order); prefers synced HeyGen asset ids. */
export function productBibleSnapshotToHeygenFiles(
  snapshot: ProductBibleSnapshotV1 | null | undefined,
  projectAssets: ProjectBrandAssetRow[]
): HeygenFileEntry[] {
  if (!snapshot) return [];
  const refs = resolveHeygenProductReferenceAssets(snapshot);
  if (refs.length === 0) return [];
  const byId = new Map(projectAssets.map((a) => [a.id, a]));
  const out: HeygenFileEntry[] = [];
  const seen = new Set<string>();
  for (const asset of refs) {
    if (out.length >= HEYGEN_FILES_MAX) break;
    const row = byId.get(asset.asset_id);
    const hid = row?.heygen_asset_id?.trim();
    const url = asset.public_url?.trim() || row?.public_url?.trim();
    if (hid) {
      const key = `asset_id:${hid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: "asset_id", asset_id: hid });
      continue;
    }
    if (url && /^https?:\/\//i.test(url)) {
      const key = `url:${url}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ type: "url", url });
    }
  }
  return out;
}

export function mergeHeygenVideoAgentFiles(
  body: Record<string, unknown>,
  extra: HeygenFileEntry[]
): void {
  if (extra.length === 0) return;
  const existing = body.files;
  const cur: HeygenFileEntry[] = Array.isArray(existing)
    ? (existing as HeygenFileEntry[]).filter((x) => x && typeof x === "object")
    : [];
  const seen = new Set<string>();
  const merged: HeygenFileEntry[] = [];
  for (const entry of [...cur, ...extra]) {
    const key = heygenFileKey(entry);
    if (key && seen.has(key)) continue;
    if (key) seen.add(key);
    merged.push(entry);
    if (merged.length >= HEYGEN_FILES_MAX) break;
  }
  body.files = merged;
}
