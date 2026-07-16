/**
 * Product Bible (`product_bible_v1`) — product evidence per project.
 *
 * Complements `project_product_profile` (text copy) with structured product modules,
 * features, and screenshot / UI asset references for HeyGen, Flux, and LLM context.
 */
import type { ProjectBrandAssetRow } from "../repositories/project-config.js";

export const PRODUCT_BIBLE_SCHEMA = "product_bible_v1" as const;

/** Max product modules per bible. */
export const PRODUCT_BIBLE_MODULE_MAX = 12;

/** Max features per module. */
export const PRODUCT_BIBLE_FEATURE_MAX = 16;

/** Max asset refs per module or feature. */
export const PRODUCT_BIBLE_ASSET_REF_MAX = 20;

/** HeyGen / Flux product screenshot refs (ordered). */
export const PRODUCT_BIBLE_HEYGEN_REF_MAX = 12;

export const PRODUCT_BIBLE_ASSET_ROLES = [
  "screenshot",
  "ui_screen",
  "workflow_step",
  "feature_demo",
  "hero_shot",
  "comparison",
] as const;

export type ProductBibleAssetRole = (typeof PRODUCT_BIBLE_ASSET_ROLES)[number];

export interface ProductBibleApplicationGuide {
  instructions: string;
  heygen_policy: string | null;
  flux_policy: string | null;
}

export interface ProductBibleAssetRef {
  asset_id: string;
  role: ProductBibleAssetRole;
  label: string | null;
  usage_notes: string | null;
  step_order: number | null;
}

export interface ProductBibleFeature {
  key: string;
  label: string;
  description: string | null;
  asset_refs: ProductBibleAssetRef[];
}

export interface ProductBibleModule {
  key: string;
  label: string;
  description: string | null;
  one_liner: string | null;
  features: ProductBibleFeature[];
  asset_refs: ProductBibleAssetRef[];
}

export interface ProductBibleResolvedAsset {
  asset_id: string;
  role: ProductBibleAssetRole;
  label: string | null;
  usage_notes: string | null;
  step_order: number | null;
  public_url: string | null;
  kind: string | null;
  product_key: string | null;
  feature_key: string | null;
}

export interface ProductBibleV1 {
  schema_version: typeof PRODUCT_BIBLE_SCHEMA;
  application_guide: ProductBibleApplicationGuide;
  products: ProductBibleModule[];
  /** Creator-style hosts for product UGC videos (synced to product_ugc_avatar_pool_json). */
  heygen_ugc_presenters: ProductBibleHeygenPresenter[];
}

/** Same shape as brand bible HeyGen presenters — avatar+voice pairs. */
export interface ProductBibleHeygenPresenter {
  label: string | null;
  avatar_id: string;
  voice_id: string | null;
  avatar_name: string | null;
  voice_name: string | null;
  preview_image_url: string | null;
}

export interface ProductBibleSnapshotV1 extends ProductBibleV1 {
  resolved_assets: ProductBibleResolvedAsset[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

function str(v: unknown, max = 4000): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function slugKey(v: unknown, max = 80): string | null {
  const s = str(v, max);
  if (!s) return null;
  const normalized = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, max);
  return normalized || null;
}

function parseAssetRole(raw: unknown): ProductBibleAssetRole {
  const s = str(raw, 40);
  if (s && (PRODUCT_BIBLE_ASSET_ROLES as readonly string[]).includes(s)) return s as ProductBibleAssetRole;
  return "screenshot";
}

function parseStepOrder(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  const n = Math.trunc(raw);
  return n >= 0 && n <= 99 ? n : null;
}

function parseAssetRefs(raw: unknown, cap = PRODUCT_BIBLE_ASSET_REF_MAX): ProductBibleAssetRef[] {
  const out: ProductBibleAssetRef[] = [];
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const assetId = str(rec.asset_id ?? rec.id, 80);
    if (!assetId) continue;
    out.push({
      asset_id: assetId,
      role: parseAssetRole(rec.role),
      label: str(rec.label, 120),
      usage_notes: str(rec.usage_notes ?? rec.notes, 400),
      step_order: parseStepOrder(rec.step_order ?? rec.stepOrder),
    });
    if (out.length >= cap) break;
  }
  return out;
}

function parseFeatures(raw: unknown): ProductBibleFeature[] {
  const out: ProductBibleFeature[] = [];
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const key = slugKey(rec.key ?? rec.feature_key) ?? slugKey(rec.label);
    const label = str(rec.label, 120);
    if (!key || !label) continue;
    out.push({
      key,
      label,
      description: str(rec.description, 2000),
      asset_refs: parseAssetRefs(rec.asset_refs ?? rec.assets),
    });
    if (out.length >= PRODUCT_BIBLE_FEATURE_MAX) break;
  }
  return out;
}

function parseProducts(raw: unknown): ProductBibleModule[] {
  const out: ProductBibleModule[] = [];
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const key = slugKey(rec.key ?? rec.product_key) ?? slugKey(rec.label);
    const label = str(rec.label, 120);
    if (!key || !label) continue;
    out.push({
      key,
      label,
      description: str(rec.description, 4000),
      one_liner: str(rec.one_liner ?? rec.oneLiner, 400),
      features: parseFeatures(rec.features),
      asset_refs: parseAssetRefs(rec.asset_refs ?? rec.assets),
    });
    if (out.length >= PRODUCT_BIBLE_MODULE_MAX) break;
  }
  return out;
}

function parseApplicationGuide(raw: unknown): ProductBibleApplicationGuide {
  const rec = asRecord(raw);
  return {
    instructions: str(rec?.instructions, 8000) ?? "",
    heygen_policy: str(rec?.heygen_policy ?? rec?.heygenPolicy, 2000),
    flux_policy: str(rec?.flux_policy ?? rec?.fluxPolicy, 2000),
  };
}

function parseHeygenPresenters(raw: unknown): ProductBibleHeygenPresenter[] {
  const out: ProductBibleHeygenPresenter[] = [];
  for (const item of asArray(raw)) {
    const rec = asRecord(item);
    if (!rec) continue;
    const avatar_id = str(rec.avatar_id ?? rec.avatarId, 120);
    if (!avatar_id) continue;
    out.push({
      label: str(rec.label, 120),
      avatar_id,
      voice_id: str(rec.voice_id ?? rec.voiceId, 120),
      avatar_name: str(rec.avatar_name ?? rec.avatarName, 120),
      voice_name: str(rec.voice_name ?? rec.voiceName, 120),
      preview_image_url: str(rec.preview_image_url ?? rec.previewImageUrl, 2000),
    });
    if (out.length >= 12) break;
  }
  return out;
}

/** Tolerant parser. Returns null when there is no usable bible signal. */
export function parseProductBible(raw: unknown): ProductBibleV1 | null {
  const rec = asRecord(raw);
  if (!rec) return null;

  const bible: ProductBibleV1 = {
    schema_version: PRODUCT_BIBLE_SCHEMA,
    application_guide: parseApplicationGuide(rec.application_guide),
    products: parseProducts(rec.products),
    heygen_ugc_presenters: parseHeygenPresenters(rec.heygen_ugc_presenters),
  };

  const guide = bible.application_guide;
  const hasSignal =
    bible.products.length > 0 ||
    bible.heygen_ugc_presenters.length > 0 ||
    guide.instructions.length > 0 ||
    guide.heygen_policy ||
    guide.flux_policy;

  return hasSignal ? bible : null;
}

export function emptyProductBibleDraft(): ProductBibleV1 {
  return {
    schema_version: PRODUCT_BIBLE_SCHEMA,
    application_guide: {
      instructions: "",
      heygen_policy: null,
      flux_policy: null,
    },
    products: [],
    heygen_ugc_presenters: [],
  };
}

function resolveRefList(
  refs: ProductBibleAssetRef[],
  brandAssets: ProjectBrandAssetRow[],
  productKey: string | null,
  featureKey: string | null
): ProductBibleResolvedAsset[] {
  const byId = new Map(brandAssets.map((a) => [a.id, a]));
  const out: ProductBibleResolvedAsset[] = [];
  for (const ref of refs) {
    const row = byId.get(ref.asset_id);
    out.push({
      asset_id: ref.asset_id,
      role: ref.role,
      label: ref.label ?? row?.label ?? null,
      usage_notes: ref.usage_notes,
      step_order: ref.step_order,
      public_url: row?.public_url ?? null,
      kind: row?.kind ?? null,
      product_key: productKey,
      feature_key: featureKey,
    });
  }
  return out;
}

/** Flatten all asset refs from modules and features into resolved rows. */
export function resolveProductBibleAssets(
  bible: ProductBibleV1,
  brandAssets: ProjectBrandAssetRow[]
): ProductBibleResolvedAsset[] {
  const out: ProductBibleResolvedAsset[] = [];
  const seen = new Set<string>();
  for (const product of bible.products) {
    for (const asset of resolveRefList(product.asset_refs, brandAssets, product.key, null)) {
      const dedupe = `${asset.product_key}:${asset.feature_key}:${asset.asset_id}`;
      if (seen.has(dedupe)) continue;
      seen.add(dedupe);
      out.push(asset);
    }
    for (const feature of product.features) {
      for (const asset of resolveRefList(feature.asset_refs, brandAssets, product.key, feature.key)) {
        const dedupe = `${asset.product_key}:${asset.feature_key}:${asset.asset_id}`;
        if (seen.has(dedupe)) continue;
        seen.add(dedupe);
        out.push(asset);
      }
    }
  }
  return out;
}

export function buildProductBibleSnapshot(
  bible: ProductBibleV1,
  brandAssets: ProjectBrandAssetRow[]
): ProductBibleSnapshotV1 {
  return {
    ...bible,
    resolved_assets: resolveProductBibleAssets(bible, brandAssets),
  };
}

/** Filter snapshot to one product module (or return full snapshot when key omitted). */
export function filterProductBibleSnapshotByKey(
  snapshot: ProductBibleSnapshotV1,
  productKey: string | null | undefined
): ProductBibleSnapshotV1 {
  const key = slugKey(productKey);
  if (!key) return snapshot;
  const product = snapshot.products.find((p) => p.key === key);
  if (!product) return { ...snapshot, products: [], resolved_assets: [] };
  const filtered: ProductBibleSnapshotV1 = {
    ...snapshot,
    products: [product],
    resolved_assets: snapshot.resolved_assets.filter((a) => a.product_key === key),
  };
  return filtered;
}

function hasResolvableUrl(asset: ProductBibleResolvedAsset): boolean {
  return Boolean(asset.public_url?.trim());
}

function compareByStepOrder(a: ProductBibleResolvedAsset, b: ProductBibleResolvedAsset): number {
  const ao = a.step_order ?? 999;
  const bo = b.step_order ?? 999;
  if (ao !== bo) return ao - bo;
  return String(a.asset_id).localeCompare(String(b.asset_id));
}

/** Ordered product screenshots for HeyGen Video Agent `files`. */
export function resolveHeygenProductReferenceAssets(
  snapshot: ProductBibleSnapshotV1 | null | undefined
): ProductBibleResolvedAsset[] {
  if (!snapshot) return [];
  const resolved = Array.isArray(snapshot.resolved_assets) ? snapshot.resolved_assets : [];
  const eligible = resolved.filter((a) => hasResolvableUrl(a));
  const workflow = eligible.filter((a) => a.role === "workflow_step").sort(compareByStepOrder);
  const heroes = eligible.filter((a) => a.role === "hero_shot");
  const screenshots = eligible.filter(
    (a) => a.role === "screenshot" || a.role === "ui_screen" || a.role === "feature_demo"
  );
  const comparisons = eligible.filter((a) => a.role === "comparison");
  const out: ProductBibleResolvedAsset[] = [];
  const seen = new Set<string>();
  for (const asset of [...workflow, ...heroes, ...screenshots, ...comparisons]) {
    const id = String(asset.asset_id ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(asset);
    if (out.length >= PRODUCT_BIBLE_HEYGEN_REF_MAX) break;
  }
  return out;
}

/** Product UI refs for Flux multi-reference image generation. */
export function resolveFluxProductReferenceAssets(
  snapshot: ProductBibleSnapshotV1 | null | undefined,
  max = 8
): ProductBibleResolvedAsset[] {
  return resolveHeygenProductReferenceAssets(snapshot).slice(0, max);
}

/** Compact module list for LLM creation pack (no URLs). */
export function slimProductBibleForCreationPack(
  snapshot: ProductBibleSnapshotV1 | null | undefined
): Record<string, unknown> | null {
  if (!snapshot || snapshot.products.length === 0) return null;
  return {
    schema_version: PRODUCT_BIBLE_SCHEMA,
    application_guide: snapshot.application_guide,
    products: snapshot.products.map((p) => ({
      key: p.key,
      label: p.label,
      description: p.description,
      one_liner: p.one_liner,
      features: p.features.map((f) => ({
        key: f.key,
        label: f.label,
        description: f.description,
        asset_count: f.asset_refs.length,
      })),
      asset_count: p.asset_refs.length,
    })),
    resolved_asset_labels: snapshot.resolved_assets
      .slice(0, PRODUCT_BIBLE_HEYGEN_REF_MAX)
      .map((a) => ({
        role: a.role,
        label: a.label,
        step_order: a.step_order,
        product_key: a.product_key,
        feature_key: a.feature_key,
      })),
  };
}

const MAX_VIDEO_AGENT_PRODUCT_BIBLE_LINES = 12;

/** HeyGen Video Agent prompt block describing product modules and screenshot usage. */
export function buildProductBibleVideoAgentPromptBlock(
  snapshot: ProductBibleSnapshotV1 | null | undefined
): string | null {
  if (!snapshot || snapshot.products.length === 0) return null;
  const lines: string[] = [];
  const guide = snapshot.application_guide;

  if (guide.instructions.trim()) {
    lines.push(`Product evidence guide: ${guide.instructions.trim().slice(0, 400)}`);
  }
  if (guide.heygen_policy?.trim()) {
    lines.push(`Screenshot usage: ${guide.heygen_policy.trim().slice(0, 300)}`);
  }

  for (const product of snapshot.products) {
    const header = [product.label, product.one_liner].filter(Boolean).join(" — ");
    if (header) lines.push(`Product module: ${header}`);
    if (product.description) lines.push(`  ${product.description.slice(0, 280)}`);
    for (const feature of product.features.slice(0, 4)) {
      const feat = [feature.label, feature.description].filter(Boolean).join(": ");
      if (feat) lines.push(`  Feature: ${feat.slice(0, 200)}`);
    }
    const refs = snapshot.resolved_assets.filter((a) => a.product_key === product.key && hasResolvableUrl(a));
    if (refs.length > 0) {
      const refDesc = refs
        .slice(0, 5)
        .map((a) => {
          const parts = [a.role.replace(/_/g, " ")];
          if (a.label) parts.push(a.label);
          if (a.step_order != null) parts.push(`step ${a.step_order}`);
          return parts.join(" ");
        })
        .join("; ");
      lines.push(`  Attached screenshots: ${refDesc}`);
    }
  }

  if (lines.length === 0) return null;
  return [
    "Product bible (use attached product screenshots to show real UI — do not invent app screens):",
    ...lines.slice(0, MAX_VIDEO_AGENT_PRODUCT_BIBLE_LINES).map((l) => `- ${l}`),
  ].join("\n");
}
