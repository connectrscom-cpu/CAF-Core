import type { Pool } from "pg";
import { q } from "../db/queries.js";
import type { InstagramNormalizedMediaAsset } from "../services/instagram-media-normalizer.js";

export async function insertEvidenceMediaAssetsPending(
  db: Pool,
  projectId: string,
  evidenceRowId: string,
  postUrl: string | null,
  postId: string | null,
  ownerUsername: string | null,
  assets: InstagramNormalizedMediaAsset[]
): Promise<void> {
  if (assets.length === 0) return;
  const values: unknown[] = [];
  const ph: string[] = [];
  let p = 1;
  for (const a of assets) {
    ph.push(
      `($${p++}, $${p++}::bigint, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}, $${p++}::jsonb)`
    );
    values.push(
      projectId,
      evidenceRowId,
      "instagram",
      postUrl,
      postId,
      ownerUsername,
      a.source_url,
      a.source_field,
      a.asset_role,
      a.media_type,
      a.slide_index,
      "pending",
      JSON.stringify({
        width: a.width ?? null,
        height: a.height ?? null,
        original_post_url: a.original_post_url ?? null,
      })
    );
  }
  await db.query(
    `INSERT INTO caf_core.evidence_media_assets
      (project_id, evidence_row_id, source_platform, source_post_url, source_post_id, source_owner_username,
       source_url, source_field, asset_role, media_type, slide_index, archive_status, metadata_json)
     VALUES ${ph.join(", ")}`,
    values
  );
}

export interface EvidenceMediaPreviewRow {
  evidence_row_id: string;
  public_url: string | null;
  source_url: string;
}

/**
 * Best-effort preview URLs for a batch of evidence rows (public_url preferred, else source_url).
 */
export async function listEvidenceMediaPreviewForRows(
  db: Pool,
  projectId: string,
  rowIds: string[]
): Promise<EvidenceMediaPreviewRow[]> {
  const ids = [...new Set(rowIds.map((x) => String(x).trim()).filter((x) => /^\d+$/.test(x)))].slice(0, 500);
  if (ids.length === 0) return [];
  return q(
    db,
    `SELECT m.evidence_row_id::text AS evidence_row_id,
            m.public_url,
            m.source_url
       FROM caf_core.evidence_media_assets m
      WHERE m.project_id = $1 AND m.evidence_row_id = ANY($2::bigint[])
      ORDER BY m.evidence_row_id ASC, m.slide_index ASC NULLS FIRST, m.created_at ASC`,
    [projectId, ids]
  );
}

/** First thumbnail + deduped URL list per evidence row id. */
export function foldMediaPreviews(rows: EvidenceMediaPreviewRow[]): Map<string, { thumbnail: string | null; urls: string[] }> {
  const map = new Map<string, { thumbnail: string | null; urls: string[] }>();
  for (const r of rows) {
    const url = (r.public_url && r.public_url.trim()) || (r.source_url && r.source_url.trim()) || "";
    if (!url) continue;
    const cur = map.get(r.evidence_row_id) ?? { thumbnail: null, urls: [] };
    if (!cur.thumbnail) cur.thumbnail = url;
    if (!cur.urls.includes(url)) cur.urls.push(url);
    map.set(r.evidence_row_id, cur);
  }
  return map;
}
