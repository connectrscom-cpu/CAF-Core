import { NextRequest, NextResponse } from "next/server";
import {
  getJobDetail,
  getJobDetailAll,
  reprintMimicTextOverlay,
  listBrandAssets,
  type MimicDocAiLayerPositionRow,
} from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects, CAF_CORE_URL } from "@/lib/env";
import { isTpGroundedCarouselReviewFlow } from "@/lib/flow-kind";
import {
  assetIdFromBrandProxyUrl,
  resolveBrandFrameReprintUrl,
  resolveBrandLogoReprintUrl,
  resolveBrandLogoReprintUrlById,
} from "@/lib/brand-asset-url";

export const dynamic = "force-dynamic";

/**
 * POST /api/task/reprint-text-overlay
 * Body: { task_id, project?, slide_indices?: number[], render_typography?: object }
 *
 * Re-runs Puppeteer text compositing on stored MIMIC_BACKGROUND / MIMIC_VISUAL_PLATE assets (no Flux).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tid = String(body?.task_id ?? "").trim();
    if (!tid) return NextResponse.json({ error: "task_id required" }, { status: 400 });

    const rawIndices = body?.slide_indices;
    const slideIndices = Array.isArray(rawIndices)
      ? rawIndices
          .map((n: unknown) => Number(n))
          .filter((n: number) => Number.isFinite(n) && n >= 1)
      : undefined;

    const renderTypography =
      body?.render_typography && typeof body.render_typography === "object" && !Array.isArray(body.render_typography)
        ? (body.render_typography as Record<string, number>)
        : undefined;

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
    if (!isTpGroundedCarouselReviewFlow(job.flow_type, job.generation_payload)) {
      return NextResponse.json(
        { ok: false, error: "reprint_text_overlay_requires_tp_grounded_carousel_job" },
        { status: 400 }
      );
    }

    const textBacking = body?.text_backing !== false;
    const textBackingColor =
      typeof body?.text_backing_color === "string" ? body.text_backing_color.trim() : undefined;
    const rawDocAi = body?.docai_layer_positions;
    const docaiLayerPositions =
      rawDocAi && typeof rawDocAi === "object" && !Array.isArray(rawDocAi)
        ? (rawDocAi as Record<string, MimicDocAiLayerPositionRow[]>)
        : undefined;

    const rawSlideCopy = body?.slide_copy_overrides;
    const slideCopyOverrides = Array.isArray(rawSlideCopy)
      ? rawSlideCopy
          .map((row: unknown) => {
            const rec = row && typeof row === "object" && !Array.isArray(row) ? (row as Record<string, unknown>) : null;
            if (!rec) return null;
            const slide_index = Math.floor(Number(rec.slide_index));
            const llm_slide =
              rec.llm_slide && typeof rec.llm_slide === "object" && !Array.isArray(rec.llm_slide)
                ? (rec.llm_slide as Record<string, unknown>)
                : null;
            if (!Number.isFinite(slide_index) || slide_index < 1 || !llm_slide) return null;
            return { slide_index, llm_slide };
          })
          .filter(Boolean) as Array<{ slide_index: number; llm_slide: Record<string, unknown> }>
      : undefined;

    const rawLogo = body?.logo_overlay;
    let logoUrl =
      rawLogo && typeof rawLogo === "object" && !Array.isArray(rawLogo) && typeof rawLogo.url === "string"
        ? rawLogo.url.trim()
        : "";
    const logoAssetId =
      rawLogo && typeof rawLogo === "object" && !Array.isArray(rawLogo) && typeof rawLogo.asset_id === "string"
        ? rawLogo.asset_id.trim()
        : "";
    if (logoAssetId || logoUrl.startsWith("/api/project-config/brand-assets/proxy") || (logoUrl && !/^https?:\/\//i.test(logoUrl))) {
      const assets = await listBrandAssets(slug);
      const pool = assets?.brand_assets ?? [];
      const proxyId = assetIdFromBrandProxyUrl(logoUrl);
      const pickId = logoAssetId || proxyId;
      if (pickId) {
        logoUrl = resolveBrandLogoReprintUrlById(slug, pool, pickId, CAF_CORE_URL);
      } else {
        logoUrl = resolveBrandLogoReprintUrl(slug, pool, CAF_CORE_URL);
      }
    }
    const logoOverlay = logoUrl
      ? {
          url: logoUrl,
          position: typeof rawLogo?.position === "string" ? rawLogo.position.trim() : "br",
          ...(logoAssetId ? { asset_id: logoAssetId } : {}),
        }
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
      const assets = await listBrandAssets(slug);
      const pool = assets?.brand_assets ?? [];
      if (frameAssetId) {
        frameUrl = resolveBrandFrameReprintUrl(slug, pool, frameAssetId, CAF_CORE_URL);
      }
    }
    const frameOverlay = frameUrl ? { url: frameUrl, ...(frameAssetId ? { asset_id: frameAssetId } : {}) } : undefined;

    const result = await reprintMimicTextOverlay(slug, tid, {
      slideIndices,
      renderTypography,
      textBacking,
      textBackingColor,
      docaiLayerPositions,
      slideCopyOverrides,
      logoOverlay,
      frameOverlay,
    });
    if (!result.ok) {
      const status = result.error === "job_not_found" ? 404 : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result, { status: result.accepted ? 202 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
