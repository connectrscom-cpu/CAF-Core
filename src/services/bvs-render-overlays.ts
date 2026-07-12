/**
 * Resolve BVS frame/logo overlays for carousel renderer (Puppeteer fetchable URLs).
 */
import type { AppConfig } from "../config.js";
import type { BvsRenderPlanV1 } from "../domain/bvs-render-plan.js";
import { pickBvsRenderPlanFromMimic } from "../domain/bvs-render-plan.js";
import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import type { ProjectBrandAssetRow } from "../repositories/project-config.js";
import { listProjectBrandAssets } from "../repositories/project-config.js";
import type { Pool } from "pg";

export type BvsCarouselRenderOverlays = {
  logoOverlay?: { url: string; position: string };
  frameOverlay?: { url: string; asset_id: string };
};

function corePublicBase(config: AppConfig): string {
  const fromEnv = config.CAF_PUBLIC_URL?.trim();
  if (fromEnv) return fromEnv.replace(/\/$/, "");
  return `http://127.0.0.1:${config.PORT}`;
}

export function brandAssetRenderFileUrl(
  config: AppConfig,
  projectSlug: string,
  assetId: string
): string {
  const slug = projectSlug.trim();
  const id = assetId.trim();
  if (!slug || !id) return "";
  return `${corePublicBase(config)}/v1/projects/${encodeURIComponent(slug)}/brand-assets/${encodeURIComponent(id)}/file`;
}

export function resolveBrandAssetRenderUrl(
  config: AppConfig,
  projectSlug: string,
  assetId: string,
  assets: ProjectBrandAssetRow[],
  publicUrlHint?: string | null
): string {
  const core = brandAssetRenderFileUrl(config, projectSlug, assetId);
  if (core) return core;
  const pub = typeof publicUrlHint === "string" ? publicUrlHint.trim() : "";
  if (pub && /^https?:\/\//i.test(pub)) return pub;
  const row = assets.find((a) => String(a.id ?? "").trim() === assetId.trim());
  const rowPub = typeof row?.public_url === "string" ? row.public_url.trim() : "";
  if (rowPub && /^https?:\/\//i.test(rowPub)) return rowPub;
  return "";
}

export function resolveBvsOverlaysFromPlan(
  config: AppConfig,
  projectSlug: string,
  plan: BvsRenderPlanV1 | null | undefined,
  assets: ProjectBrandAssetRow[]
): BvsCarouselRenderOverlays {
  if (!plan?.enabled) return {};
  const out: BvsCarouselRenderOverlays = {};
  if (plan.logo?.asset_id) {
    const url = resolveBrandAssetRenderUrl(config, projectSlug, plan.logo.asset_id, assets);
    if (url) {
      out.logoOverlay = { url, position: plan.logo.position?.trim() || "br" };
    }
  }
  if (plan.frame?.asset_id) {
    const url = resolveBrandAssetRenderUrl(config, projectSlug, plan.frame.asset_id, assets);
    if (url) {
      out.frameOverlay = { url, asset_id: plan.frame.asset_id };
    }
  }
  return out;
}

export async function resolveBvsCarouselRenderOverlays(
  db: Pool,
  config: AppConfig,
  projectId: string,
  projectSlug: string,
  mimic: MimicPayloadV1 | null | undefined
): Promise<BvsCarouselRenderOverlays> {
  if (!mimic?.bvs_enabled) return {};
  const plan = pickBvsRenderPlanFromMimic(mimic);
  if (!plan?.enabled) return {};
  const assets = await listProjectBrandAssets(db, projectId).catch(() => []);
  return resolveBvsOverlaysFromPlan(config, projectSlug, plan, assets);
}
