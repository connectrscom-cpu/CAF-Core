/**
 * Build HeyGen Video Agent v3 `files` array from project brand assets (max 20).
 */
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

export function mergeHeygenVideoAgentFiles(
  body: Record<string, unknown>,
  extra: HeygenFileEntry[]
): void {
  if (extra.length === 0) return;
  const existing = body.files;
  const cur: HeygenFileEntry[] = Array.isArray(existing)
    ? (existing as HeygenFileEntry[]).filter((x) => x && typeof x === "object")
    : [];
  const merged = [...cur, ...extra].slice(0, HEYGEN_FILES_MAX);
  body.files = merged;
}
