/**
 * Product Bible slice on `content_jobs.generation_payload.product_bible_v1`.
 * Stamped at job plan time when the candidate requests product evidence or content_lens=product.
 */
import type { Pool } from "pg";
import type {
  ProductBibleResolvedAsset,
  ProductBibleSnapshotV1,
  ProductEvidenceSelection,
} from "./product-bible.js";
import {
  buildProductBibleSnapshot,
  filterProductBibleSnapshotByKey,
  parseProductBible,
  publicUrlsFromProductEvidenceSelection,
  selectProductBibleReferenceAssets,
} from "./product-bible.js";
import { getActiveProductBible } from "../repositories/product-bibles.js";
import { listProjectBrandAssets } from "../repositories/project-config.js";
import { isProductImageFlow, isProductVideoFlow } from "./product-flow-types.js";
import { pickGeneratedOutput } from "./generation-payload-output.js";
import type { MimicPayloadV1 } from "./mimic-payload.js";

export const PRODUCT_BIBLE_V1_SCHEMA = "product_bible_v1" as const;

export interface ProductBibleV1Slice {
  schema_version: typeof PRODUCT_BIBLE_V1_SCHEMA;
  enabled: boolean;
  product_key: string | null;
  bible_version: number | null;
  bible_snapshot: ProductBibleSnapshotV1 | null;
  /** Explicit feature keys from candidate_data when present. */
  feature_keys?: string[] | null;
  /** Last evidence selection used for LLM / render (observability). */
  selected_evidence?: {
    selection_mode: ProductEvidenceSelection["selection_mode"];
    matched_feature_keys: string[];
    matched_product_keys: string[];
    matched_labels: string[];
    asset_ids: string[];
  } | null;
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

/** Explicit feature key(s) from candidate_data when operators/ideas pin a feature. */
export function pickFeatureKeysFromCandidate(
  candidateData: Record<string, unknown> | null | undefined
): string[] {
  if (!candidateData) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw: unknown) => {
    if (raw == null) return;
    const key = slugKeyFromCandidate(typeof raw === "string" ? raw : String(raw));
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  };

  push(candidateData.feature_key);
  push(candidateData.featureKey);
  const multi =
    candidateData.feature_keys ?? candidateData.featureKeys ?? candidateData.features ?? null;
  if (Array.isArray(multi)) {
    for (const item of multi) {
      if (typeof item === "string") push(item);
      else {
        const rec = asRecord(item);
        if (rec) push(rec.key ?? rec.feature_key ?? rec.label);
      }
    }
  } else if (typeof multi === "string") {
    for (const part of multi.split(/[,;|]/)) push(part);
  }
  return out;
}

/**
 * Build mention corpus from candidate + generated output so feature labels in the
 * idea/script can select Product Bible screenshots.
 */
export function buildProductEvidenceMentionCorpus(args: {
  candidateData?: Record<string, unknown> | null;
  generatedOutput?: Record<string, unknown> | null;
  generationPayload?: Record<string, unknown> | null;
}): string {
  const parts: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === "string" && v.trim()) parts.push(v.trim());
    else if (Array.isArray(v)) {
      for (const item of v) {
        if (typeof item === "string" && item.trim()) parts.push(item.trim());
        else {
          const rec = asRecord(item);
          if (!rec) continue;
          for (const key of ["text", "headline", "title", "body", "label", "point"]) {
            if (typeof rec[key] === "string" && String(rec[key]).trim()) {
              parts.push(String(rec[key]).trim());
            }
          }
        }
      }
    }
  };

  const cd = args.candidateData ?? null;
  if (cd) {
    for (const key of [
      "title",
      "thesis",
      "summary_excerpt",
      "hook",
      "angle",
      "novelty_angle",
      "product_angle",
      "one_liner",
      "description",
    ]) {
      push(cd[key]);
    }
    push(cd.key_points);
    push(cd.features);
    push(cd.feature_labels);
  }

  const gen =
    args.generatedOutput ??
    (args.generationPayload ? pickGeneratedOutput(args.generationPayload) : null);
  if (gen) {
    for (const key of [
      "spoken_script",
      "script",
      "visual_direction",
      "video_prompt",
      "hook",
      "cta",
      "caption",
      "title",
      "headline",
      "body",
    ]) {
      push(gen[key]);
    }
    push(gen.slides);
    push(gen.key_points);
    push(gen.bullet_points);
  }

  return parts.join("\n").slice(0, 12000);
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
  const feature_keys = Array.isArray(rec.feature_keys)
    ? rec.feature_keys
        .map((x) => slugKeyFromCandidate(typeof x === "string" ? x : String(x ?? "")))
        .filter((x): x is string => Boolean(x))
    : null;
  const selectedRec = asRecord(rec.selected_evidence);
  let selected_evidence: ProductBibleV1Slice["selected_evidence"] = null;
  if (selectedRec) {
    const mode = String(selectedRec.selection_mode ?? "");
    if (mode === "feature_match" || mode === "product_module" || mode === "full_fallback") {
      selected_evidence = {
        selection_mode: mode,
        matched_feature_keys: Array.isArray(selectedRec.matched_feature_keys)
          ? selectedRec.matched_feature_keys.map((x) => String(x)).filter(Boolean)
          : [],
        matched_product_keys: Array.isArray(selectedRec.matched_product_keys)
          ? selectedRec.matched_product_keys.map((x) => String(x)).filter(Boolean)
          : [],
        matched_labels: Array.isArray(selectedRec.matched_labels)
          ? selectedRec.matched_labels.map((x) => String(x)).filter(Boolean)
          : [],
        asset_ids: Array.isArray(selectedRec.asset_ids)
          ? selectedRec.asset_ids.map((x) => String(x)).filter(Boolean)
          : [],
      };
    }
  }
  return {
    schema_version: PRODUCT_BIBLE_V1_SCHEMA,
    enabled,
    product_key,
    bible_version,
    bible_snapshot: bible ? (snapRec as unknown as ProductBibleSnapshotV1) : null,
    feature_keys,
    selected_evidence,
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
  snapshot: ProductBibleSnapshotV1 | null,
  opts?: { featureKeys?: string[] | null }
): ProductBibleV1Slice {
  const filtered =
    enabled && snapshot && productKey ? filterProductBibleSnapshotByKey(snapshot, productKey) : snapshot;
  return {
    schema_version: PRODUCT_BIBLE_V1_SCHEMA,
    enabled,
    product_key: enabled ? productKey : null,
    bible_version: bibleVersion,
    bible_snapshot: enabled ? filtered : null,
    feature_keys: enabled ? opts?.featureKeys ?? null : null,
    selected_evidence: null,
  };
}

function selectionToSliceMeta(selection: ProductEvidenceSelection): NonNullable<
  ProductBibleV1Slice["selected_evidence"]
> {
  return {
    selection_mode: selection.selection_mode,
    matched_feature_keys: selection.matched_feature_keys,
    matched_product_keys: selection.matched_product_keys,
    matched_labels: selection.matched_labels,
    asset_ids: selection.assets.map((a) => a.asset_id),
  };
}

/**
 * Select product screenshots for LLM / HeyGen / Flux from the job's product bible slice.
 * Prefer explicit candidate feature keys + mention matches in idea/script text.
 */
export function selectProductEvidenceForPayload(
  payload: Record<string, unknown> | null | undefined,
  opts?: {
    candidateData?: Record<string, unknown> | null;
    max?: number;
    mentionText?: string | null;
  }
): {
  slice: ProductBibleV1Slice | null;
  selection: ProductEvidenceSelection;
  assets: ProductBibleResolvedAsset[];
} {
  const slice = parseProductBibleFromPayload(payload);
  const empty = selectProductBibleReferenceAssets(null);
  if (!slice?.enabled || !slice.bible_snapshot) {
    return { slice, selection: empty, assets: [] };
  }
  const candidateData =
    opts?.candidateData ??
    (asRecord(payload?.candidate_data) as Record<string, unknown> | null) ??
    null;
  const featureKeys = [
    ...(slice.feature_keys ?? []),
    ...pickFeatureKeysFromCandidate(candidateData),
  ];
  const productKeys = [slice.product_key, pickProductKeyFromCandidate(candidateData)];
  const mentionText =
    opts?.mentionText ??
    buildProductEvidenceMentionCorpus({
      candidateData,
      generationPayload: payload ?? null,
    });
  const selection = selectProductBibleReferenceAssets(slice.bible_snapshot, {
    featureKeys,
    productKeys,
    mentionText,
    max: opts?.max,
  });
  return { slice, selection, assets: selection.assets };
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
  const featureKeys = pickFeatureKeysFromCandidate(candidateData);
  if (!enabled) {
    payload.product_bible_v1 = buildProductBibleSlice(false, productKey, null, null);
    return;
  }
  const resolved = await resolveProductBibleSnapshotForProject(db, projectId, productKey);
  if (!resolved) {
    payload.product_bible_v1 = buildProductBibleSlice(true, productKey, null, null, {
      featureKeys,
    });
    return;
  }
  const slice = buildProductBibleSlice(true, productKey, resolved.version, resolved.snapshot, {
    featureKeys,
  });
  const mentionText = buildProductEvidenceMentionCorpus({ candidateData });
  const selection = selectProductBibleReferenceAssets(slice.bible_snapshot, {
    featureKeys,
    productKeys: [productKey],
    mentionText,
  });
  slice.selected_evidence = selectionToSliceMeta(selection);
  payload.product_bible_v1 = slice;
}

/**
 * Stamp mention-matched Product Bible screenshot URLs onto `mimic_v1` for Flux multi-ref.
 * No-op when product bible is disabled or no resolvable URLs.
 */
export function attachProductEvidenceUrlsToMimicPayload(
  payload: Record<string, unknown>,
  mimic: MimicPayloadV1,
  opts?: { candidateData?: Record<string, unknown> | null; max?: number }
): MimicPayloadV1 {
  const { selection } = selectProductEvidenceForPayload(payload, {
    candidateData: opts?.candidateData,
    max: opts?.max ?? 8,
  });
  const urls = publicUrlsFromProductEvidenceSelection(selection, opts?.max ?? 8);
  const slice = asRecord(payload.product_bible_v1);
  if (slice) {
    slice.selected_evidence = selectionToSliceMeta(selection);
    payload.product_bible_v1 = slice;
  }
  if (urls.length === 0) {
    const next = { ...mimic };
    delete next.product_evidence_reference_urls;
    return next;
  }
  return { ...mimic, product_evidence_reference_urls: urls };
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
  return buildProductBibleSlice(true, current.product_key, resolved.version, resolved.snapshot, {
    featureKeys: current.feature_keys,
  });
}
