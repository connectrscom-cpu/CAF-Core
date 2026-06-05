/**
 * Persist rows into inputs_evidence_imports + inputs_evidence_rows (shared by scraper, pack, upload).
 */
import type { Pool } from "pg";
import {
  insertInputsEvidenceImport,
  insertInputsEvidenceRowsBatch,
} from "../repositories/inputs-evidence.js";
import { insertEvidenceMediaAssetsPending } from "../repositories/inputs-evidence-media.js";
import { computeInputHealth, flagSparseEvidenceRows, persistImportHealth } from "./input-health.js";
import { normalizeGenericVideoEvidenceMedia } from "./inputs-evidence-media-normalizer.js";
import { isVideoLikeEvidence } from "./inputs-image-url-for-analysis.js";
import { normalizeInstagramEvidenceMedia } from "./instagram-media-normalizer.js";
import {
  sheetNameToEvidenceKind,
  type ParsedInputsEvidenceRow,
} from "./inputs-sns-workbook-parser.js";

export function buildSheetStatsFromRows(
  rows: ParsedInputsEvidenceRow[],
  extra: Record<string, unknown>
): Record<string, unknown> {
  const sheetCounts = new Map<string, number>();
  for (const r of rows) {
    sheetCounts.set(r.sheet_name, (sheetCounts.get(r.sheet_name) ?? 0) + 1);
  }
  const sheets = [...sheetCounts.entries()].map(([sheet_name, row_count]) => ({
    sheet_name,
    evidence_kind: sheetNameToEvidenceKind(sheet_name),
    row_count,
    truncated: false,
    columns: Object.keys(rows.find((x) => x.sheet_name === sheet_name)?.payload_json ?? {}),
  }));
  return {
    version: 1,
    sheets,
    total_rows: rows.length,
    ...extra,
  };
}

export async function writeInputsEvidenceImport(
  db: Pool,
  projectId: string,
  opts: {
    filename: string;
    notes: string | null;
    workbook_sha256: string;
    sheet_stats_json: Record<string, unknown>;
    rows: ParsedInputsEvidenceRow[];
  }
): Promise<{ importId: string; totalRows: number }> {
  const imp = await insertInputsEvidenceImport(db, {
    project_id: projectId,
    upload_filename: opts.filename,
    workbook_sha256: opts.workbook_sha256,
    sheet_stats_json: opts.sheet_stats_json,
    notes: opts.notes,
  });

  const BATCH = 250;
  for (let i = 0; i < opts.rows.length; i += BATCH) {
    const slice = opts.rows.slice(i, i + BATCH);
    const rowIds = await insertInputsEvidenceRowsBatch(db, projectId, imp.id, slice);
    for (let j = 0; j < slice.length; j++) {
      const payload = slice[j]!.payload_json;
      if (slice[j]!.evidence_kind === "instagram_post") {
        const norm = normalizeInstagramEvidenceMedia(payload);
        if (norm.media_assets.length > 0) {
          await insertEvidenceMediaAssetsPending(
            db,
            projectId,
            rowIds[j]!,
            norm.post_url,
            norm.post_id,
            norm.owner_username,
            norm.media_assets,
            "instagram"
          );
        }
      } else if (
        slice[j]!.evidence_kind === "tiktok_video" ||
        (slice[j]!.evidence_kind === "facebook_post" && isVideoLikeEvidence(slice[j]!.evidence_kind, payload))
      ) {
        const norm = normalizeGenericVideoEvidenceMedia(slice[j]!.evidence_kind, payload);
        if (norm && norm.media_assets.length > 0) {
          await insertEvidenceMediaAssetsPending(
            db,
            projectId,
            rowIds[j]!,
            norm.post_url,
            norm.post_id,
            norm.owner_username,
            norm.media_assets,
            norm.source_platform
          );
        }
      }
    }
  }

  const health = await computeInputHealth(db, projectId, imp.id, opts.sheet_stats_json);
  await persistImportHealth(db, projectId, imp.id, health);
  await flagSparseEvidenceRows(db, projectId, imp.id);

  return { importId: imp.id, totalRows: opts.rows.length };
}
