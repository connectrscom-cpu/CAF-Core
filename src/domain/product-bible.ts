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

function normalizeMentionHaystack(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function mentionMatchesLabel(haystack: string, label: string | null | undefined): boolean {
  const needle = normalizeMentionHaystack(String(label ?? ""));
  if (needle.length < 3) return false;
  if (haystack.includes(needle)) return true;
  const tokens = needle.split(" ").filter((t) => t.length >= 3);
  if (tokens.length === 0) return false;
  return tokens.every((t) => haystack.includes(t));
}

export type ProductBibleMentionMatch = {
  feature_keys: string[];
  product_keys: string[];
  matched_labels: string[];
};

/**
 * Scan free text (idea / script / visual direction) for Product Bible product + feature labels/keys.
 */
export function matchProductBibleMentions(
  text: string | null | undefined,
  snapshot: ProductBibleSnapshotV1 | null | undefined
): ProductBibleMentionMatch {
  const empty: ProductBibleMentionMatch = { feature_keys: [], product_keys: [], matched_labels: [] };
  if (!snapshot || snapshot.products.length === 0) return empty;
  const haystack = normalizeMentionHaystack(String(text ?? ""));
  if (!haystack) return empty;

  const featureKeys = new Set<string>();
  const productKeys = new Set<string>();
  const labels: string[] = [];

  for (const product of snapshot.products) {
    const productHit =
      mentionMatchesLabel(haystack, product.key) ||
      mentionMatchesLabel(haystack, product.label) ||
      mentionMatchesLabel(haystack, product.one_liner);
    if (productHit) {
      productKeys.add(product.key);
      if (product.label) labels.push(product.label);
    }
    for (const feature of product.features) {
      const featureHit =
        mentionMatchesLabel(haystack, feature.key) ||
        mentionMatchesLabel(haystack, feature.label) ||
        mentionMatchesLabel(haystack, feature.description);
      if (featureHit) {
        featureKeys.add(feature.key);
        productKeys.add(product.key);
        if (feature.label) labels.push(feature.label);
      }
    }
  }

  return {
    feature_keys: [...featureKeys],
    product_keys: [...productKeys],
    matched_labels: labels.slice(0, 24),
  };
}

export type ProductEvidenceSelectionMode = "feature_match" | "product_module" | "full_fallback";

export type ProductEvidenceSelection = {
  selection_mode: ProductEvidenceSelectionMode;
  matched_feature_keys: string[];
  matched_product_keys: string[];
  matched_labels: string[];
  assets: ProductBibleResolvedAsset[];
};

function uniqueKeys(raw: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const key = slugKey(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function orderAssetsLikeHeygen(
  assets: ProductBibleResolvedAsset[],
  max: number
): ProductBibleResolvedAsset[] {
  const eligible = assets.filter((a) => hasResolvableUrl(a));
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
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Prefer screenshots for mentioned features/products; fall back to the full ordered evidence set.
 *
 * Ladder:
 * 1. Assets tagged to matched feature_keys
 * 2. Module-level / all assets for matched product_keys
 * 3. Full HeyGen-ordered evidence list (legacy behavior)
 */
export function selectProductBibleReferenceAssets(
  snapshot: ProductBibleSnapshotV1 | null | undefined,
  opts?: {
    featureKeys?: Array<string | null | undefined> | null;
    productKeys?: Array<string | null | undefined> | null;
    mentionText?: string | null;
    max?: number;
  }
): ProductEvidenceSelection {
  const max = Math.max(1, Math.min(PRODUCT_BIBLE_HEYGEN_REF_MAX, Math.trunc(opts?.max ?? PRODUCT_BIBLE_HEYGEN_REF_MAX)));
  const empty: ProductEvidenceSelection = {
    selection_mode: "full_fallback",
    matched_feature_keys: [],
    matched_product_keys: [],
    matched_labels: [],
    assets: [],
  };
  if (!snapshot) return empty;

  const mentions = matchProductBibleMentions(opts?.mentionText, snapshot);
  const featureKeys = uniqueKeys([...(opts?.featureKeys ?? []), ...mentions.feature_keys]);
  const productKeys = uniqueKeys([...(opts?.productKeys ?? []), ...mentions.product_keys]);
  const full = resolveHeygenProductReferenceAssets(snapshot);
  const labels = mentions.matched_labels;

  if (featureKeys.length > 0) {
    const featureSet = new Set(featureKeys);
    const featureAssets = orderAssetsLikeHeygen(
      full.filter((a) => a.feature_key != null && featureSet.has(a.feature_key)),
      max
    );
    if (featureAssets.length > 0) {
      return {
        selection_mode: "feature_match",
        matched_feature_keys: featureKeys,
        matched_product_keys: productKeys,
        matched_labels: labels,
        assets: featureAssets,
      };
    }
  }

  if (productKeys.length > 0) {
    const productSet = new Set(productKeys);
    const productAssets = orderAssetsLikeHeygen(
      full.filter((a) => a.product_key != null && productSet.has(a.product_key)),
      max
    );
    if (productAssets.length > 0) {
      return {
        selection_mode: "product_module",
        matched_feature_keys: featureKeys,
        matched_product_keys: productKeys,
        matched_labels: labels,
        assets: productAssets,
      };
    }
  }

  return {
    selection_mode: "full_fallback",
    matched_feature_keys: featureKeys,
    matched_product_keys: productKeys,
    matched_labels: labels,
    assets: full.slice(0, max),
  };
}

/** Public image URLs from a product evidence selection (Flux / multi-ref). */
export function publicUrlsFromProductEvidenceSelection(
  selection: ProductEvidenceSelection | null | undefined,
  max = 8
): string[] {
  if (!selection) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const asset of selection.assets) {
    const url = asset.public_url?.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

/** Product UI refs for Flux multi-reference image generation (mention-aware). */
export function resolveFluxProductReferenceAssets(
  snapshot: ProductBibleSnapshotV1 | null | undefined,
  opts?: {
    featureKeys?: Array<string | null | undefined> | null;
    productKeys?: Array<string | null | undefined> | null;
    mentionText?: string | null;
    max?: number;
  }
): ProductBibleResolvedAsset[] {
  return selectProductBibleReferenceAssets(snapshot, { ...opts, max: opts?.max ?? 8 }).assets;
}

function roleLabelForProductPrompt(role: ProductBibleAssetRole): string {
  return role.replace(/_/g, " ");
}

/** Prefer feature label, then humanized role — used in File N [scope] lines. */
export function productAssetScopeLabel(
  asset: ProductBibleResolvedAsset,
  snapshot: ProductBibleSnapshotV1 | null | undefined
): string {
  const featureKey = asset.feature_key?.trim();
  if (featureKey && snapshot) {
    const product = snapshot.products.find((p) => p.key === asset.product_key);
    const feature = product?.features.find((f) => f.key === featureKey);
    if (feature?.label?.trim()) return feature.label.trim();
    return featureKey.replace(/_/g, " ");
  }
  return roleLabelForProductPrompt(asset.role);
}

/**
 * One HeyGen / LLM line that maps File N → feature/role + marketer label.
 * Order must match `files[]` attachment order from `resolveHeygenProductReferenceAssets`
 * (optionally offset when brand/BVS files were already merged onto the request).
 */
export function formatProductHeygenPromptAssetLine(
  asset: ProductBibleResolvedAsset,
  index1Based: number,
  snapshot: ProductBibleSnapshotV1 | null | undefined
): string {
  const scope = productAssetScopeLabel(asset, snapshot);
  const label = asset.label?.trim();
  const notes = asset.usage_notes?.trim();
  const step = asset.step_order != null ? `flow step ${asset.step_order}` : null;
  const role = roleLabelForProductPrompt(asset.role);
  const detail = [label, step, notes].filter(Boolean).join(" — ");
  const suffix = detail || role;
  return `- File ${index1Based} [${scope}]: ${suffix} — insert this real product UI when that feature/flow step is shown; do not invent app screens.`;
}

/** Compact module list for LLM creation pack (no URLs). */
export function slimProductBibleForCreationPack(
  snapshot: ProductBibleSnapshotV1 | null | undefined,
  opts?: { selection?: ProductEvidenceSelection | null }
): Record<string, unknown> | null {
  if (!snapshot || snapshot.products.length === 0) return null;
  const selection = opts?.selection ?? selectProductBibleReferenceAssets(snapshot);
  const orderedRefs = selection.assets.length > 0 ? selection.assets : resolveHeygenProductReferenceAssets(snapshot);
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
    evidence_selection: {
      mode: selection.selection_mode,
      matched_feature_keys: selection.matched_feature_keys,
      matched_product_keys: selection.matched_product_keys,
      matched_labels: selection.matched_labels,
    },
    /**
     * Ordered evidence refs — `file_index` is 1-based within the product evidence set.
     * Prefer feature-matched screenshots when the idea/script mentions them; otherwise
     * the full ordered set. At HeyGen render, indices are offset to match the full
     * `files[]` array when BVS brand files were already attached.
     */
    product_evidence_files: orderedRefs.map((a, i) => ({
      file_index: i + 1,
      role: a.role,
      label: a.label,
      usage_notes: a.usage_notes,
      step_order: a.step_order,
      product_key: a.product_key,
      feature_key: a.feature_key,
      scope_label: productAssetScopeLabel(a, snapshot),
    })),
    /** @deprecated prefer product_evidence_files (includes file_index + scope_label) */
    resolved_asset_labels: orderedRefs.map((a) => ({
      role: a.role,
      label: a.label,
      step_order: a.step_order,
      product_key: a.product_key,
      feature_key: a.feature_key,
    })),
  };
}

const MAX_VIDEO_AGENT_PRODUCT_MODULE_LINES = 8;

export interface ProductBibleVideoAgentPromptOpts {
  /** Add to 1-based File N so indices match final HeyGen `files[]` after prior merges (e.g. BVS). */
  fileIndexOffset?: number;
}

/**
 * HeyGen Video Agent prompt block describing product modules and numbered screenshot files.
 * Pass the same `attachedAssets` array used to build `files[]` so File N labels stay aligned.
 */
export function buildProductBibleVideoAgentPromptBlock(
  snapshot: ProductBibleSnapshotV1 | null | undefined,
  attachedAssets?: ProductBibleResolvedAsset[],
  opts?: ProductBibleVideoAgentPromptOpts
): string | null {
  if (!snapshot || snapshot.products.length === 0) return null;
  const moduleLines: string[] = [];
  const guide = snapshot.application_guide;
  const refs =
    attachedAssets && attachedAssets.length > 0
      ? attachedAssets
      : resolveHeygenProductReferenceAssets(snapshot);
  const offset = Math.max(0, Math.trunc(opts?.fileIndexOffset ?? 0));

  if (guide.instructions.trim()) {
    moduleLines.push(`Product evidence guide: ${guide.instructions.trim().slice(0, 400)}`);
  }
  if (guide.heygen_policy?.trim()) {
    moduleLines.push(`Screenshot usage: ${guide.heygen_policy.trim().slice(0, 300)}`);
  }

  for (const product of snapshot.products) {
    const header = [product.label, product.one_liner].filter(Boolean).join(" — ");
    if (header) moduleLines.push(`Product module: ${header}`);
    if (product.description) moduleLines.push(`  ${product.description.slice(0, 280)}`);
    for (const feature of product.features.slice(0, 4)) {
      const feat = [feature.label, feature.description].filter(Boolean).join(": ");
      if (feat) moduleLines.push(`  Feature: ${feat.slice(0, 200)}`);
    }
  }

  const lines: string[] = [
    "Product bible (use attached product screenshots to show real UI — do not invent app screens):",
    ...moduleLines.slice(0, MAX_VIDEO_AGENT_PRODUCT_MODULE_LINES).map((l) => `- ${l}`),
  ];

  if (refs.length > 0) {
    const firstN = offset + 1;
    const lastN = offset + refs.length;
    lines.push(
      `- Uploaded product evidence files (${refs.length} attached as File ${firstN}–${lastN} on this request — File N matches files[] order; insert the matching screenshot when that feature/flow step appears):`
    );
    for (let i = 0; i < refs.length; i++) {
      lines.push(formatProductHeygenPromptAssetLine(refs[i]!, offset + i + 1, snapshot));
    }
  }

  if (lines.length <= 1) return null;
  return lines.join("\n");
}
