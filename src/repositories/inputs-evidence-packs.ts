import type { Pool } from "pg";
import { q, qOne } from "../db/queries.js";

export const EVIDENCE_PACK_PLATFORMS = [
  "instagram",
  "tiktok",
  "reddit",
  "facebook",
  "html",
] as const;

export type EvidencePackPlatform = (typeof EVIDENCE_PACK_PLATFORMS)[number];

export interface EvidencePackSlotRef {
  scraper_run_id: string;
  evidence_import_id: string;
  row_count?: number;
}

export interface EvidencePackRow {
  id: string;
  project_id: string;
  label: string | null;
  slots_json: Record<string, EvidencePackSlotRef>;
  evidence_import_id: string | null;
  stats_json: Record<string, unknown>;
  created_at: string;
}

export async function insertEvidencePack(
  db: Pool,
  data: {
    project_id: string;
    label: string | null;
    slots_json: Record<string, EvidencePackSlotRef>;
    evidence_import_id: string;
    stats_json: Record<string, unknown>;
  }
): Promise<{ id: string }> {
  const row = await qOne<{ id: string }>(
    db,
    `INSERT INTO caf_core.inputs_evidence_packs
      (project_id, label, slots_json, evidence_import_id, stats_json)
     VALUES ($1, $2, $3::jsonb, $4::uuid, $5::jsonb)
     RETURNING id::text AS id`,
    [
      data.project_id,
      data.label,
      JSON.stringify(data.slots_json),
      data.evidence_import_id,
      JSON.stringify(data.stats_json),
    ]
  );
  if (!row) throw new Error("insertEvidencePack failed");
  return row;
}

export async function listEvidencePacks(
  db: Pool,
  projectId: string,
  limit: number
): Promise<EvidencePackRow[]> {
  const lim = Math.min(Math.max(limit, 1), 100);
  return q(
    db,
    `SELECT id::text, project_id::text, label, slots_json, evidence_import_id::text,
            stats_json, created_at::text
       FROM caf_core.inputs_evidence_packs
      WHERE project_id = $1
      ORDER BY created_at DESC
      LIMIT $2`,
    [projectId, lim]
  );
}

export async function getEvidencePack(
  db: Pool,
  projectId: string,
  packId: string
): Promise<EvidencePackRow | null> {
  return qOne(
    db,
    `SELECT id::text, project_id::text, label, slots_json, evidence_import_id::text,
            stats_json, created_at::text
       FROM caf_core.inputs_evidence_packs
      WHERE id = $1::uuid AND project_id = $2`,
    [packId, projectId]
  );
}
