/**
 * Brand Visual System slice on `content_jobs.generation_payload.bvs_v1`.
 * Stamped at job plan time when the marketer enables BVS for an idea.
 */
import type { Pool } from "pg";
import type { BrandBibleSnapshotV1 } from "./brand-bible.js";
import {
  buildBrandBibleSnapshot,
  parseBrandBible,
  buildBibleFromBrandAssets,
  enrichBrandBibleFromAssets,
  type BrandBibleV1,
} from "./brand-bible.js";
import { getActiveBrandBible } from "../repositories/brand-bibles.js";
import { listProjectBrandAssets } from "../repositories/project-config.js";

export const BVS_V1_SCHEMA = "bvs_v1" as const;

export interface BvsV1 {
  schema_version: typeof BVS_V1_SCHEMA;
  enabled: boolean;
  bible_version: number | null;
  bible_snapshot: BrandBibleSnapshotV1 | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function parseBvsV1(raw: unknown): BvsV1 | null {
  const rec = asRecord(raw);
  if (!rec || rec.schema_version !== BVS_V1_SCHEMA) return null;
  const enabled = rec.enabled === true;
  const snapRaw = rec.bible_snapshot;
  const snapRec = asRecord(snapRaw);
  const bible = snapRec ? parseBrandBible(snapRec) : null;
  const versionRaw = rec.bible_version;
  const bible_version =
    typeof versionRaw === "number" && Number.isFinite(versionRaw) ? Math.trunc(versionRaw) : null;
  return {
    schema_version: BVS_V1_SCHEMA,
    enabled,
    bible_version,
    bible_snapshot: bible ? (snapRec as unknown as BrandBibleSnapshotV1) : null,
  };
}

export function parseBvsFromPayload(payload: Record<string, unknown> | null | undefined): BvsV1 | null {
  if (!payload) return null;
  return parseBvsV1(payload.bvs_v1);
}

export function isBvsEnabledForCandidate(candidateData: Record<string, unknown> | null | undefined): boolean {
  if (!candidateData) return false;
  return candidateData.use_brand_visual_system === true;
}

export function buildBvsSlice(
  enabled: boolean,
  bibleVersion: number | null,
  snapshot: BrandBibleSnapshotV1 | null
): BvsV1 {
  return {
    schema_version: BVS_V1_SCHEMA,
    enabled,
    bible_version: bibleVersion,
    bible_snapshot: enabled ? snapshot : null,
  };
}

/** Resolve active bible + brand assets into a frozen snapshot for a job. */
export async function resolveBvsSnapshotForProject(
  db: Pool,
  projectId: string
): Promise<{ version: number | null; snapshot: BrandBibleSnapshotV1 } | null> {
  const assets = await listProjectBrandAssets(db, projectId).catch(() => []);
  const active = await getActiveBrandBible(db, projectId);
  let parsed = active ? parseBrandBible(active.bible_json) : null;
  if (parsed) {
    parsed = enrichBrandBibleFromAssets(parsed, assets);
  } else {
    parsed = buildBibleFromBrandAssets(assets);
  }
  if (!parsed) return null;
  return {
    version: active?.version ?? null,
    snapshot: buildBrandBibleSnapshot(parsed, assets),
  };
}

/** When BVS is on but the job was planned without a snapshot, resolve now from current project state. */
export async function resolveBvsForEnabledJob(
  db: Pool,
  projectId: string,
  payload: Record<string, unknown>
): Promise<BvsV1 | null> {
  const current = parseBvsFromPayload(payload);
  if (!current?.enabled) return current;
  if (current.bible_snapshot) return current;
  const resolved = await resolveBvsSnapshotForProject(db, projectId);
  if (!resolved) return current;
  return buildBvsSlice(true, resolved.version, resolved.snapshot);
}

/** Persist a healed BVS snapshot onto an existing job (generation_payload + mimic_v1 when present). */
export async function healAndPersistBvsOnJob(
  db: Pool,
  job: { id: string; project_id: string; generation_payload: Record<string, unknown> }
): Promise<boolean> {
  const bvs = await resolveBvsForEnabledJob(db, job.project_id, job.generation_payload);
  if (!bvs?.enabled || !bvs.bible_snapshot) return false;
  const prior = parseBvsFromPayload(job.generation_payload);
  if (prior?.bible_snapshot) return false;

  let merged: Record<string, unknown> = { ...job.generation_payload, bvs_v1: bvs };
  const mimicRaw = merged.mimic_v1;
  if (mimicRaw && typeof mimicRaw === "object" && !Array.isArray(mimicRaw)) {
    merged = {
      ...merged,
      mimic_v1: {
        ...(mimicRaw as Record<string, unknown>),
        bvs_enabled: true,
        bvs_bible_snapshot: bvs.bible_snapshot as unknown as Record<string, unknown>,
      },
    };
  }

  await db.query(
    `UPDATE caf_core.content_jobs SET generation_payload = $1::jsonb, updated_at = now() WHERE id = $2`,
    [JSON.stringify(merged), job.id]
  );
  return true;
}

/** Stamp `bvs_v1` onto a planned generation_payload when the candidate requests BVS. */
export async function attachBvsToPlannedPayload(
  db: Pool,
  projectId: string,
  payload: Record<string, unknown>,
  candidateData: Record<string, unknown>,
  opts?: { force?: boolean }
): Promise<void> {
  const enabled = isBvsEnabledForCandidate(candidateData) || opts?.force === true;
  if (!enabled) {
    payload.bvs_v1 = buildBvsSlice(false, null, null);
    return;
  }
  const resolved = await resolveBvsSnapshotForProject(db, projectId);
  if (!resolved) {
    payload.bvs_v1 = buildBvsSlice(true, null, null);
    return;
  }
  payload.bvs_v1 = buildBvsSlice(true, resolved.version, resolved.snapshot);
}

/** Merge bible palette/motifs into brand profile for brand translation when BVS is on. */
export function brandProfileFromBvsSnapshot(
  snapshot: BrandBibleSnapshotV1 | null | undefined,
  baseProfile: BrandBibleV1 | null
): Record<string, unknown> | null {
  if (!snapshot) return null;
  const guide = snapshot.application_guide;
  return {
    schema_version: "brand_profile_v1",
    brand_name: null,
    palette: snapshot.palette,
    visual_style: snapshot.visual_mode_custom ?? snapshot.visual_mode?.replace(/_/g, " ") ?? null,
    tone: guide.instructions.slice(0, 300) || null,
    domain_metaphors: snapshot.allowed_motifs.slice(0, 16),
    allowed_motifs: snapshot.allowed_motifs,
    forbidden_motifs: snapshot.forbidden_motifs,
    symbol_map: baseProfile ? [] : [],
  };
}
