import type { AppConfig } from "../config.js";
import type { ProjectBrandAssetRow } from "../repositories/project-config.js";
import { fetchableUrlFromAssetRow } from "./supabase-storage.js";

/** Replace stored public URLs with signed fetchable URLs (private Supabase buckets). */
export async function signProjectBrandAssetsForClient(
  config: AppConfig,
  rows: ProjectBrandAssetRow[]
): Promise<ProjectBrandAssetRow[]> {
  const bucket = config.SUPABASE_ASSETS_BUCKET || "assets";
  const out: ProjectBrandAssetRow[] = [];
  for (const row of rows) {
    const signed = await fetchableUrlFromAssetRow(config, {
      public_url: row.public_url,
      bucket,
      object_path: row.storage_path,
    });
    out.push({ ...row, public_url: signed ?? row.public_url });
  }
  return out;
}
