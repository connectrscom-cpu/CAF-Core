import { NextRequest, NextResponse } from "next/server";
import {
  getJobDetail,
  getJobDetailAll,
  reprintVideoBrandOverlays,
  listBrandAssets,
} from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects, CAF_CORE_URL } from "@/lib/env";
import { isVideoFlow } from "@/lib/flow-kind";
import {
  assetIdFromBrandProxyUrl,
  resolveBrandFrameReprintUrl,
  resolveBrandLogoReprintUrl,
  resolveBrandLogoReprintUrlById,
} from "@/lib/brand-asset-url";

export const dynamic = "force-dynamic";

/**
 * POST /api/task/reprint-video-brand-overlays
 * Body: { task_id, project?, logo_enabled?, frame_enabled?, logo_overlay?, frame_overlay? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tid = String(body?.task_id ?? "").trim();
    if (!tid) return NextResponse.json({ error: "task_id required" }, { status: 400 });

    let slug = String(body?.project ?? "").trim() || PROJECT_SLUG;
    if (!slug && reviewUsesAllProjects()) {
      const job = await getJobDetailAll(tid);
      slug = (job?.project_slug ?? reviewQueueFallbackSlug() ?? "").trim();
    }
    if (!slug) {
      return NextResponse.json({ error: "Could not resolve project for task" }, { status: 400 });
    }

    const job = await getJobDetail(slug, tid);
    if (!job) {
      return NextResponse.json({ ok: false, error: "job_not_found" }, { status: 404 });
    }
    const flowType = String(job.flow_type ?? "");
    if (!isVideoFlow(flowType)) {
      return NextResponse.json(
        { ok: false, error: "video_brand_overlay_requires_video_job" },
        { status: 400 }
      );
    }

    const brandAssetsRes = await listBrandAssets(slug);
    const pool = brandAssetsRes?.brand_assets ?? [];

    const enableLogo = body?.logo_enabled === true;
    const enableFrame = body?.frame_enabled === true;

    const rawLogo = body?.logo_overlay;
    let logoUrl =
      rawLogo && typeof rawLogo === "object" && !Array.isArray(rawLogo) && typeof rawLogo.url === "string"
        ? rawLogo.url.trim()
        : "";
    const logoAssetId =
      rawLogo && typeof rawLogo === "object" && !Array.isArray(rawLogo) && typeof rawLogo.asset_id === "string"
        ? rawLogo.asset_id.trim()
        : "";
    if (logoAssetId || logoUrl.startsWith("/api/project-config/brand-assets/proxy") || (enableLogo && !logoUrl)) {
      const proxyId = assetIdFromBrandProxyUrl(logoUrl);
      const pickId = logoAssetId || proxyId;
      if (pickId) {
        logoUrl = resolveBrandLogoReprintUrlById(slug, pool, pickId, CAF_CORE_URL);
      } else if (enableLogo) {
        logoUrl = resolveBrandLogoReprintUrl(slug, pool, CAF_CORE_URL);
      }
    }
    const logoPosition =
      rawLogo && typeof rawLogo === "object" && !Array.isArray(rawLogo) && typeof rawLogo.position === "string"
        ? rawLogo.position.trim() || "br"
        : "br";
    const logoOverlay =
      enableLogo && logoUrl
        ? { url: logoUrl, position: logoPosition, ...(logoAssetId ? { asset_id: logoAssetId } : {}) }
        : undefined;

    const rawFrame = body?.frame_overlay;
    let frameUrl =
      rawFrame && typeof rawFrame === "object" && !Array.isArray(rawFrame) && typeof rawFrame.url === "string"
        ? rawFrame.url.trim()
        : "";
    const frameAssetId =
      rawFrame && typeof rawFrame === "object" && !Array.isArray(rawFrame) && typeof rawFrame.asset_id === "string"
        ? rawFrame.asset_id.trim()
        : "";
    if (!frameUrl || frameUrl.startsWith("/api/project-config/brand-assets/proxy")) {
      if (frameAssetId) {
        frameUrl = resolveBrandFrameReprintUrl(slug, pool, frameAssetId, CAF_CORE_URL);
      }
    }
    const frameOverlay =
      enableFrame && frameUrl ? { url: frameUrl, ...(frameAssetId ? { asset_id: frameAssetId } : {}) } : undefined;

    const result = await reprintVideoBrandOverlays(slug, tid, {
      logoOverlay,
      frameOverlay,
    });

    if (!result.ok) {
      const status = result.error === "job_not_found" ? 404 : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
