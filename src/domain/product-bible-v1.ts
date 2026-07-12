/**
 * Product Bible slice on `content_jobs.generation_payload.product_bible_v1`.
 * Stamped at job plan time when the candidate requests product evidence or content_lens=product.
 */
import type { Pool } from "pg";
import type { ProductBibleSnapshotV1 } from "./product-bible.js";
import {
  buildProductBibleSnapshot,
  filterProductBibleSnapshotByKey,
  parseProductBible,
} from "./product-bible.js";
import { getActiveProductBible } from "../repositories/product-bibles.js";
import { listProjectBrandAssets } from "../repositories/project-config.js";
import { isProductImageFlow, isProductVideoFlow } from "./product-flow-types.js";

export const PRODUCT_BIBLE_V1_SCHEMA = "product_bible_v1" as const;

export interface ProductBibleV1Slice {
  schema_version: typeof PRODUCT_BIBLE_V1_SCHEMA;
  enabled: boolean;
  product_key: string | null;
  bible_version: number | null;
  bible_snapshot: ProductBibleSnapshotV1 | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function slugKeyFromCandidate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return s || null;
}

/** Normalize product_key from candidate_data (supports product_key, productKey, product_module). */
export function pickProductKeyFromCandidate(
  candidateData: Record<string, unknown> | null | undefined
): string | null {
  if (!candidateData) return null;
  const raw =
    candidateData.product_key ??
    candidateData.productKey ??
    candidateData.product_module ??
    candidateData.productModule;
  return slugKeyFromCandidate(raw);
}

export function parseProductBibleV1(raw: unknown): ProductBibleV1Slice | null {
  const rec = asRecord(raw);
  if (!rec || rec.schema_version !== PRODUCT_BIBLE_V1_SCHEMA) return null;
  const enabled = rec.enabled === true;
  const snapRec = asRecord(rec.bible_snapshot);
  const bible = snapRec ? parseProductBible(snapRec) : null;
  const versionRaw = rec.bible_version;
  const bible_version =
    typeof versionRaw === "number" && Number.isFinite(versionRaw) ? Math.trunc(versionRaw) : null;
  const product_key = slugKeyFromCandidate(rec.product_key ?? rec.productKey);
  return {
    schema_version: PRODUCT_BIBLE_V1_SCHEMA,
    enabled,
    product_key,
    bible_version,
    bible_snapshot: bible ? (snapRec as unknown as ProductBibleSnapshotV1) : null,
  };
}

export function parseProductBibleFromPayload(
  payload: Record<string, unknown> | null | undefined
): ProductBibleV1Slice | null {
  if (!payload) return null;
  return parseProductBibleV1(payload.product_bible_v1);
}

export function isProductBibleEnabledForCandidate(
  candidateData: Record<string, unknown> | null | undefined,
  opts?: { flowType?: string | null }
): boolean {
  if (!candidateData) {
    const ft = opts?.flowType ?? null;
    return isProductVideoFlow(ft) || isProductImageFlow(ft);
  }
  if (candidateData.use_product_bible === true) return true;
  const lens = String(candidateData.content_lens ?? candidateData.contentLens ?? "")
    .trim()
    .toLowerCase();
  if (lens === "product") return true;
  const ft = opts?.flowType ?? String(candidateData.target_flow_type ?? candidateData.flow_type ?? "");
  return isProductVideoFlow(ft) || isProductImageFlow(ft);
}

export function buildProductBibleSlice(
  enabled: boolean,
  productKey: string | null,
  bibleVersion: number | null,
  snapshot: ProductBibleSnapshotV1 | null
): ProductBibleV1Slice {
  const filtered =
    enabled && snapshot && productKey ? filterProductBibleSnapshotByKey(snapshot, productKey) : snapshot;
  return {
    schema_version: PRODUCT_BIBLE_V1_SCHEMA,
    enabled,
    product_key: enabled ? productKey : null,
    bible_version: bibleVersion,
    bible_snapshot: enabled ? filtered : null,
  };
}

/** Resolve active bible + brand assets into a frozen snapshot for a job. */
export async function resolveProductBibleSnapshotForProject(
  db: Pool,
  projectId: string,
  productKey?: string | null
): Promise<{ version: number | null; snapshot: ProductBibleSnapshotV1 } | null> {
  const assets = await listProjectBrandAssets(db, projectId).catch(() => []);
  const active = await getActiveProductBible(db, projectId);
  const parsed = active ? parseProductBible(active.bible_json) : null;
  if (!parsed) return null;
  const snapshot = buildProductBibleSnapshot(parsed, assets);
  return {
    version: active?.version ?? null,
    snapshot: productKey ? filterProductBibleSnapshotByKey(snapshot, productKey) : snapshot,
  };
}

/** Stamp `product_bible_v1` onto a planned generation_payload when the candidate requests it. */
export async function attachProductBibleToPlannedPayload(
  db: Pool,
  projectId: string,
  payload: Record<string, unknown>,
  candidateData: Record<string, unknown>,
  opts?: { flowType?: string | null; force?: boolean }
): Promise<void> {
  const enabled =
    isProductBibleEnabledForCandidate(candidateData, { flowType: opts?.flowType }) || opts?.force === true;
  const productKey = pickProductKeyFromCandidate(candidateData);
  if (!enabled) {
    payload.product_bible_v1 = buildProductBibleSlice(false, productKey, null, null);
    return;
  }
  const resolved = await resolveProductBibleSnapshotForProject(db, projectId, productKey);
  if (!resolved) {
    payload.product_bible_v1 = buildProductBibleSlice(true, productKey, null, null);
    return;
  }
  payload.product_bible_v1 = buildProductBibleSlice(
    true,
    productKey,
    resolved.version,
    resolved.snapshot
  );
}

/** When product bible is on but snapshot missing, resolve from current project state. */
export async function resolveProductBibleForEnabledJob(
  db: Pool,
  projectId: string,
  payload: Record<string, unknown>
): Promise<ProductBibleV1Slice | null> {
  const current = parseProductBibleFromPayload(payload);
  if (!current?.enabled) return current;
  if (current.bible_snapshot) return current;
  const resolved = await resolveProductBibleSnapshotForProject(db, projectId, current.product_key);
  if (!resolved) return current;
  return buildProductBibleSlice(true, current.product_key, resolved.version, resolved.snapshot);
}
