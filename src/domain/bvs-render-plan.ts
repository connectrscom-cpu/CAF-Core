/**
 * BVS render plan — frozen overlay + background strategy for templated (`template_bg`) mimic carousels.
 */
import type { BrandBibleResolvedAsset, BrandBibleSnapshotV1 } from "./brand-bible.js";
import type { MimicPayloadV1 } from "./mimic-payload.js";
import { whyMimicTemplateBgUsesInventedPlates } from "./why-mimic-execution.js";

export const BVS_RENDER_PLAN_SCHEMA = "bvs_render_plan_v1" as const;

export type BvsTemplateBgBackgroundMode = "invent" | "reference_strip" | "bible_asset";

export interface BvsRenderPlanAssetRef {
  asset_id: string;
  role: string;
  label: string | null;
}

export interface BvsRenderPlanV1 {
  schema_version: typeof BVS_RENDER_PLAN_SCHEMA;
  enabled: boolean;
  /** Invented Flux plates (BVS-driven) vs strip-text from reference frames. */
  background_mode: BvsTemplateBgBackgroundMode;
  frame: BvsRenderPlanAssetRef | null;
  logo: (BvsRenderPlanAssetRef & { position: string }) | null;
  palette: string[];
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function assetRef(row: BrandBibleResolvedAsset): BvsRenderPlanAssetRef {
  return {
    asset_id: String(row.asset_id ?? "").trim(),
    role: String(row.role ?? "").trim(),
    label: typeof row.label === "string" && row.label.trim() ? row.label.trim() : null,
  };
}

function pickFrameAsset(assets: BrandBibleResolvedAsset[]): BvsRenderPlanAssetRef | null {
  const frames = assets.filter((a) => a.role === "slide_frame" && String(a.asset_id ?? "").trim());
  if (frames.length === 0) return null;
  const cover = frames.find((f) => /cover/i.test(String(f.label ?? "")));
  return assetRef(cover ?? frames[0]!);
}

function pickLogoAsset(assets: BrandBibleResolvedAsset[]): (BvsRenderPlanAssetRef & { position: string }) | null {
  const logos = assets.filter((a) => a.role === "logo" && String(a.asset_id ?? "").trim());
  if (logos.length === 0) return null;
  const row = logos[0]!;
  return { ...assetRef(row), position: "br" };
}

export function buildBvsRenderPlanFromSnapshot(
  snapshot: BrandBibleSnapshotV1 | null | undefined
): BvsRenderPlanV1 | null {
  if (!snapshot) return null;
  const resolved = Array.isArray(snapshot.resolved_assets) ? snapshot.resolved_assets : [];
  const palette = Array.isArray(snapshot.palette)
    ? snapshot.palette.filter((c) => /^#[0-9a-fA-F]{6}$/i.test(String(c))).slice(0, 16)
    : [];
  const frame = pickFrameAsset(resolved);
  const logo = pickLogoAsset(resolved);
  if (!frame && !logo && palette.length === 0) {
    return {
      schema_version: BVS_RENDER_PLAN_SCHEMA,
      enabled: true,
      background_mode: "invent",
      frame: null,
      logo: null,
      palette: [],
    };
  }
  return {
    schema_version: BVS_RENDER_PLAN_SCHEMA,
    enabled: true,
    background_mode: "invent",
    frame,
    logo,
    palette,
  };
}

export function parseBvsRenderPlan(raw: unknown): BvsRenderPlanV1 | null {
  const rec = asRecord(raw);
  if (!rec || rec.schema_version !== BVS_RENDER_PLAN_SCHEMA) return null;
  const parseAsset = (v: unknown): BvsRenderPlanAssetRef | null => {
    const o = asRecord(v);
    if (!o) return null;
    const asset_id = String(o.asset_id ?? "").trim();
    if (!asset_id) return null;
    return {
      asset_id,
      role: String(o.role ?? "").trim(),
      label: typeof o.label === "string" && o.label.trim() ? o.label.trim() : null,
    };
  };
  const frame = parseAsset(rec.frame);
  const logoRaw = asRecord(rec.logo);
  const logoAsset = logoRaw ? parseAsset(logoRaw) : null;
  const logo =
    logoAsset != null
      ? {
          ...logoAsset,
          position:
            typeof logoRaw?.position === "string" && logoRaw.position.trim()
              ? logoRaw.position.trim()
              : "br",
        }
      : null;
  const palette = Array.isArray(rec.palette)
    ? rec.palette.map((c) => String(c ?? "").trim()).filter((c) => /^#[0-9a-fA-F]{6}$/i.test(c))
    : [];
  const bgModeRaw = String(rec.background_mode ?? "").trim();
  const bgMode: BvsTemplateBgBackgroundMode =
    bgModeRaw === "reference_strip"
      ? "reference_strip"
      : bgModeRaw === "bible_asset"
        ? "bible_asset"
        : "invent";
  return {
    schema_version: BVS_RENDER_PLAN_SCHEMA,
    enabled: rec.enabled !== false,
    background_mode: bgMode,
    frame,
    logo,
    palette,
  };
}

export function pickBvsRenderPlanFromMimic(
  mimic: Pick<MimicPayloadV1, "bvs_render_plan"> | null | undefined
): BvsRenderPlanV1 | null {
  return parseBvsRenderPlan(mimic?.bvs_render_plan);
}

/**
 * Classic TP mimic listicle with BVS: invent brand plates (analysis_t2i) instead of reference_edit strip.
 */
export function bvsTemplateBgUsesInventedPlates(
  mimic: Pick<MimicPayloadV1, "bvs_enabled" | "mode" | "execution_mode"> | null | undefined
): boolean {
  if (mimic?.bvs_enabled !== true) return false;
  if (String(mimic?.mode ?? "").trim() !== "template_bg") return false;
  if (whyMimicTemplateBgUsesInventedPlates(mimic)) return false;
  const plan = parseBvsRenderPlan(
    mimic && "bvs_render_plan" in mimic ? (mimic as MimicPayloadV1).bvs_render_plan : null
  );
  if (plan?.background_mode === "reference_strip") return false;
  if (plan?.background_mode === "bible_asset") return false;
  return true;
}

/** FLOW_CAROUSEL + BVS: use moodboard background plates directly (no Flux invent). */
export function bvsTextCarouselUsesBibleAssetPlates(
  mimic: Pick<MimicPayloadV1, "bvs_render_plan"> | null | undefined
): boolean {
  const plan = parseBvsRenderPlan(
    mimic && "bvs_render_plan" in mimic ? (mimic as MimicPayloadV1).bvs_render_plan : null
  );
  return plan?.background_mode === "bible_asset";
}

export function enrichMimicWithBvsRenderPlan(
  mimic: MimicPayloadV1,
  snapshot: BrandBibleSnapshotV1 | null | undefined
): MimicPayloadV1 {
  if (!snapshot) return mimic;
  const plan = buildBvsRenderPlanFromSnapshot(snapshot);
  return {
    ...mimic,
    bvs_enabled: true,
    bvs_bible_snapshot: snapshot as unknown as Record<string, unknown>,
    ...(plan ? { bvs_render_plan: plan } : {}),
  };
}
