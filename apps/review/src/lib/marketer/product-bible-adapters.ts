import type {
  BrandBibleHeygenPresenter,
  ProductBible,
  ProductBibleApplicationGuide,
  ProductBibleAssetRef,
  ProductBibleAssetRole,
  ProductBibleFeature,
  ProductBibleModule,
} from "./types";
import { parseHeygenPresenters } from "./brand-bible-adapters";

function slugKey(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

export const PRODUCT_BIBLE_ASSET_ROLES: { id: ProductBibleAssetRole; label: string }[] = [
  { id: "screenshot", label: "App screenshot" },
  { id: "ui_screen", label: "UI screen" },
  { id: "workflow_step", label: "How-it-works step" },
  { id: "feature_demo", label: "Feature demo" },
  { id: "hero_shot", label: "Hero shot" },
  { id: "comparison", label: "Comparison" },
];

function parseGuide(raw: Record<string, unknown> | null | undefined): ProductBibleApplicationGuide {
  const g = raw ?? {};
  return {
    instructions: String(g.instructions ?? "").trim(),
    heygenPolicy: String(g.heygen_policy ?? g.heygenPolicy ?? "").trim(),
    fluxPolicy: String(g.flux_policy ?? g.fluxPolicy ?? "").trim(),
  };
}

function parseAssetRefs(raw: unknown): ProductBibleAssetRef[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductBibleAssetRef[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const assetId = String(rec.asset_id ?? rec.assetId ?? "").trim();
    if (!assetId) continue;
    const stepRaw = rec.step_order ?? rec.stepOrder;
    const stepOrder =
      typeof stepRaw === "number" && Number.isFinite(stepRaw) ? Math.trunc(stepRaw) : null;
    out.push({
      assetId,
      role: (String(rec.role ?? "screenshot") as ProductBibleAssetRole) || "screenshot",
      label: String(rec.label ?? "").trim(),
      usageNotes: String(rec.usage_notes ?? rec.usageNotes ?? "").trim(),
      stepOrder,
    });
  }
  return out;
}

function parseFeatures(raw: unknown): ProductBibleFeature[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductBibleFeature[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = String(rec.label ?? "").trim();
    const key = String(rec.key ?? "").trim() || slugKey(label);
    if (!label) continue;
    out.push({
      key,
      label,
      description: String(rec.description ?? "").trim(),
      assetRefs: parseAssetRefs(rec.asset_refs ?? rec.assetRefs),
    });
  }
  return out;
}

function parseProducts(raw: unknown): ProductBibleModule[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductBibleModule[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = String(rec.label ?? "").trim();
    const key = String(rec.key ?? "").trim() || slugKey(label);
    if (!label) continue;
    out.push({
      key,
      label,
      description: String(rec.description ?? "").trim(),
      oneLiner: String(rec.one_liner ?? rec.oneLiner ?? "").trim(),
      features: parseFeatures(rec.features),
      assetRefs: parseAssetRefs(rec.asset_refs ?? rec.assetRefs),
    });
  }
  return out;
}

export function emptyProductBible(slug: string): ProductBible {
  return {
    slug,
    applicationGuide: { instructions: "", heygenPolicy: "", fluxPolicy: "" },
    products: [],
    heygenUgcPresenters: [],
    hasActiveVersion: false,
    version: null,
  };
}

export function toProductBible(
  slug: string,
  parsed: Record<string, unknown> | null | undefined,
  version: number | null
): ProductBible {
  const rec = parsed ?? {};
  return {
    slug,
    applicationGuide: parseGuide(rec.application_guide as Record<string, unknown> | undefined),
    products: parseProducts(rec.products),
    heygenUgcPresenters: parseHeygenPresenters(rec.heygen_ugc_presenters),
    hasActiveVersion: version != null,
    version,
  };
}

function assetRefToJson(ref: ProductBibleAssetRef): Record<string, unknown> {
  return {
    asset_id: ref.assetId,
    role: ref.role,
    label: ref.label || null,
    usage_notes: ref.usageNotes || null,
    step_order: ref.stepOrder,
  };
}

export function toProductBibleJson(edit: ProductBible): Record<string, unknown> {
  return {
    schema_version: "product_bible_v1",
    application_guide: {
      instructions: edit.applicationGuide.instructions,
      heygen_policy: edit.applicationGuide.heygenPolicy || null,
      flux_policy: edit.applicationGuide.fluxPolicy || null,
    },
    products: edit.products.map((p) => ({
      key: p.key || slugKey(p.label),
      label: p.label,
      description: p.description || null,
      one_liner: p.oneLiner || null,
      features: p.features.map((f) => ({
        key: f.key || slugKey(f.label),
        label: f.label,
        description: f.description || null,
        asset_refs: f.assetRefs.map(assetRefToJson),
      })),
      asset_refs: p.assetRefs.map(assetRefToJson),
    })),
    heygen_ugc_presenters: edit.heygenUgcPresenters
      .filter((p) => p.avatarId.trim())
      .map((p) => ({
        label: p.label.trim() || null,
        avatar_id: p.avatarId.trim(),
        voice_id: p.voiceId.trim() || null,
        avatar_name: p.avatarName.trim() || null,
        voice_name: p.voiceName.trim() || null,
        preview_image_url: p.previewImageUrl.trim() || null,
      })),
  };
}

export function productBibleIsConfigured(bible: ProductBible): boolean {
  const g = bible.applicationGuide;
  const hasAssets = bible.products.some(
    (p) => p.assetRefs.length > 0 || p.features.some((f) => f.assetRefs.length > 0)
  );
  return (
    bible.products.length > 0 ||
    bible.heygenUgcPresenters.length > 0 ||
    g.instructions.length > 0 ||
    g.heygenPolicy.length > 0 ||
    hasAssets
  );
}

export function newProductModule(label = "New product"): ProductBibleModule {
  const key = slugKey(label) || `product_${Date.now()}`;
  return {
    key,
    label,
    description: "",
    oneLiner: "",
    features: [],
    assetRefs: [],
  };
}

export function newProductFeature(label = "New feature"): ProductBibleFeature {
  const key = slugKey(label) || `feature_${Date.now()}`;
  return {
    key,
    label,
    description: "",
    assetRefs: [],
  };
}

export { slugKey as productModuleSlugKey };
