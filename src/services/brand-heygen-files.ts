/**
 * Build HeyGen Video Agent v3 `files` array from project brand assets (max 20).
 */
import type { AppConfig } from "../config.js";
import {
  resolveHeygenBvsReferenceAssets,
  type BrandBibleResolvedAsset,
  type BrandBibleSnapshotV1,
} from "../domain/brand-bible.js";
import {
  resolveHeygenProductReferenceAssets,
  type ProductBibleResolvedAsset,
  type ProductBibleSnapshotV1,
} from "../domain/product-bible.js";
import type { ProjectBrandAssetRow } from "../repositories/project-config.js";
import {
  createSignedUrlForObjectKey,
  fetchableUrlFromAssetRow,
  tryParseSupabasePublicObjectUrl,
  tryParseSupabaseSignedObjectUrl,
} from "./supabase-storage.js";

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

/**
 * Product bible screenshots (workflow steps in order); prefers synced HeyGen asset ids.
 * Pass the same `referenceAssets` used in the prompt File N map so attachment order matches labels.
 */
export function productBibleSnapshotToHeygenFiles(
  snapshot: ProductBibleSnapshotV1 | null | undefined,
  projectAssets: ProjectBrandAssetRow[],
  referenceAssets?: ProductBibleResolvedAsset[]
): HeygenFileEntry[] {
  if (!snapshot) return [];
  const refs = referenceAssets ?? resolveHeygenProductReferenceAssets(snapshot);
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

function findBrandAssetRowForUrl(rows: ProjectBrandAssetRow[], url: string): ProjectBrandAssetRow | undefined {
  const u = url.trim();
  if (!u) return undefined;
  return rows.find((r) => {
    const pub = (r.public_url ?? "").trim();
    if (pub && pub === u) return true;
    const path = (r.storage_path ?? "").trim();
    if (!path) return false;
    try {
      const parsed = tryParseSupabasePublicObjectUrl(u) ?? tryParseSupabaseSignedObjectUrl(u);
      if (!parsed) return false;
      return parsed.objectPath === path || parsed.objectPath.endsWith(`/${path}`);
    } catch {
      return false;
    }
  });
}

/** Resolve url-type entries to signed/fetchable URLs HeyGen can download (private Supabase buckets). */
export async function resolveHeygenFileEntryUrl(
  config: AppConfig,
  url: string,
  assetRow?: ProjectBrandAssetRow | null
): Promise<string | null> {
  const trimmed = url.trim();
  if (!trimmed || !/^https?:\/\//i.test(trimmed)) return null;

  const bucket = config.SUPABASE_ASSETS_BUCKET || "assets";
  const fromRow = await fetchableUrlFromAssetRow(config, {
    public_url: trimmed,
    bucket,
    object_path: assetRow?.storage_path ?? null,
  });
  if (fromRow) return fromRow;

  const parsed =
    tryParseSupabasePublicObjectUrl(trimmed) ?? tryParseSupabaseSignedObjectUrl(trimmed);
  if (parsed) {
    const signed = await createSignedUrlForObjectKey(config, parsed.bucket, parsed.objectPath, 7200);
    if ("signedUrl" in signed) return signed.signedUrl;
  }

  return trimmed;
}

export async function resolveHeygenFilesForHeyGenSubmit(
  config: AppConfig,
  files: HeygenFileEntry[],
  assetRows: ProjectBrandAssetRow[]
): Promise<HeygenFileEntry[]> {
  const out: HeygenFileEntry[] = [];
  for (const entry of files) {
    if (entry.type === "asset_id") {
      const id = entry.asset_id?.trim();
      if (id) out.push({ type: "asset_id", asset_id: id });
      continue;
    }
    const url = entry.url?.trim();
    if (!url) continue;
    const row = findBrandAssetRowForUrl(assetRows, url);
    const fetchable = await resolveHeygenFileEntryUrl(config, url, row);
    if (!fetchable) continue;
    out.push({ type: "url", url: fetchable });
    if (out.length >= HEYGEN_FILES_MAX) break;
  }
  return out;
}

/** In-place: replace `body.files` with fetchable URLs before POST /v3/video-agents. */
export async function resolveHeygenVideoAgentBodyFiles(
  config: AppConfig,
  body: Record<string, unknown>,
  assetRows: ProjectBrandAssetRow[]
): Promise<void> {
  const raw = body.files;
  if (!Array.isArray(raw) || raw.length === 0) return;
  const entries = raw.filter((x) => x && typeof x === "object") as HeygenFileEntry[];
  const resolved = await resolveHeygenFilesForHeyGenSubmit(config, entries, assetRows);
  if (resolved.length > 0) body.files = resolved;
  else delete body.files;
}
