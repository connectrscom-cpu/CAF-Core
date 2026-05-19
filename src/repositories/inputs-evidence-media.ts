import type { Pool } from "pg";
import { q } from "../db/queries.js";
import type { InstagramNormalizedMediaAsset } from "../services/instagram-media-normalizer.js";
import type { PendingEvidenceMediaAsset } from "../services/inputs-evidence-media-normalizer.js";

export async function insertEvidenceMediaAssetsPending(
  db: Pool,
  projectId: string,
  evidenceRowId: string,
  postUrl: string | null,
  postId: string | null,
  ownerUsername: string | null,
  assets: InstagramNormalizedMediaAsset[] | PendingEvidenceMediaAsset[],
  sourcePlatform = "instagram"
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
      sourcePlatform,
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
        width: "width" in a ? (a.width ?? null) : null,
        height: "height" in a ? (a.height ?? null) : null,
        original_post_url: "original_post_url" in a ? (a.original_post_url ?? null) : null,
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

export interface EvidenceMediaRow {
  id: string;
  source_url: string;
  asset_role: string;
  media_type: string;
  slide_index: number | null;
  archive_status: string;
  public_url: string | null;
  storage_bucket: string | null;
  storage_path: string | null;
}

export async function findEvidenceMediaBySourceUrl(
  db: Pool,
  projectId: string,
  evidenceRowId: string,
  sourceUrl: string
): Promise<EvidenceMediaRow | null> {
  const rows = await q<EvidenceMediaRow>(
    db,
    `SELECT id::text AS id, source_url, asset_role, media_type, slide_index, archive_status,
            public_url, storage_bucket, storage_path
       FROM caf_core.evidence_media_assets
      WHERE project_id = $1 AND evidence_row_id = $2::bigint AND source_url = $3
      LIMIT 1`,
    [projectId, evidenceRowId, sourceUrl]
  );
  return rows[0] ?? null;
}

/** Archived frame URLs for vision (extracted frames first, then thumbnails). */
export async function listEvidenceMediaVisionFrameUrls(
  db: Pool,
  projectId: string,
  evidenceRowId: string,
  maxFrames: number
): Promise<string[]> {
  const rows = await q<{ public_url: string | null; source_url: string; asset_role: string }>(
    db,
    `SELECT public_url, source_url, asset_role
       FROM caf_core.evidence_media_assets
      WHERE project_id = $1
        AND evidence_row_id = $2::bigint
        AND archive_status = 'archived'
        AND asset_role IN ('extracted_frame', 'video_frame', 'thumbnail')
        AND (public_url IS NOT NULL OR source_url LIKE 'https://%')
      ORDER BY
        CASE asset_role
          WHEN 'extracted_frame' THEN 0
          WHEN 'video_frame' THEN 1
          ELSE 2
        END,
        slide_index ASC NULLS LAST,
        created_at ASC
      LIMIT $3`,
    [projectId, evidenceRowId, Math.max(1, Math.min(maxFrames, 24))]
  );
  const out: string[] = [];
  for (const r of rows) {
    const u = (r.public_url && r.public_url.trim()) || (r.source_url.startsWith("https://") ? r.source_url : "");
    if (!u || out.includes(u)) continue;
    out.push(u);
    if (out.length >= maxFrames) break;
  }
  return out;
}

export async function upsertEvidenceMediaAssetArchived(
  db: Pool,
  args: {
    projectId: string;
    evidenceRowId: string;
    sourcePlatform: string;
    sourcePostUrl?: string | null;
    sourcePostId?: string | null;
    sourceOwnerUsername?: string | null;
    sourceUrl: string;
    sourceField: string;
    assetRole: string;
    mediaType: string;
    slideIndex: number | null;
    archiveStatus: "archived" | "failed" | "pending";
    errorMessage?: string | null;
    storageBucket?: string | null;
    storagePath?: string | null;
    publicUrl?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<string> {
  const existing = await findEvidenceMediaBySourceUrl(db, args.projectId, args.evidenceRowId, args.sourceUrl);
  if (existing) {
    await db.query(
      `UPDATE caf_core.evidence_media_assets
          SET archive_status = $2,
              error_message = $3,
              storage_bucket = COALESCE($4, storage_bucket),
              storage_path = COALESCE($5, storage_path),
              public_url = COALESCE($6, public_url),
              metadata_json = COALESCE(metadata_json, '{}'::jsonb) || $7::jsonb,
              updated_at = now()
        WHERE id = $1::uuid`,
      [
        existing.id,
        args.archiveStatus,
        args.errorMessage ?? null,
        args.storageBucket ?? null,
        args.storagePath ?? null,
        args.publicUrl ?? null,
        JSON.stringify(args.metadata ?? {}),
      ]
    );
    return existing.id;
  }

  const ins = await q<{ id: string }>(
    db,
    `INSERT INTO caf_core.evidence_media_assets
      (project_id, evidence_row_id, source_platform, source_post_url, source_post_id, source_owner_username,
       source_url, source_field, asset_role, media_type, slide_index, archive_status, error_message,
       storage_bucket, storage_path, public_url, metadata_json)
     VALUES ($1, $2::bigint, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb)
     RETURNING id::text AS id`,
    [
      args.projectId,
      args.evidenceRowId,
      args.sourcePlatform,
      args.sourcePostUrl ?? null,
      args.sourcePostId ?? null,
      args.sourceOwnerUsername ?? null,
      args.sourceUrl,
      args.sourceField,
      args.assetRole,
      args.mediaType,
      args.slideIndex,
      args.archiveStatus,
      args.errorMessage ?? null,
      args.storageBucket ?? null,
      args.storagePath ?? null,
      args.publicUrl ?? null,
      JSON.stringify(args.metadata ?? {}),
    ]
  );
  return ins[0]!.id;
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
