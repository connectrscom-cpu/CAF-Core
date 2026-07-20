import { NextRequest, NextResponse } from "next/server";
import {
  buildSlideRenderContext,
  carouselRenderBaseForPipeline,
  slidesFromGeneratedOutput,
  withInlinedBackgroundImage,
} from "@caf-core-carousel/carousel-render-pack";
import { mimicSlideTypographyPatch, mimicSlideThemePatch } from "@caf-core-carousel/mimic-slide-typography";
import type { MimicDocAiLayerPositionOverride } from "@caf-core-carousel/mimic-docai-layer-positions";
import {
  enrichSlideRenderContextWithMimicDocAi,
  mergeDocAiLayerPositionsIntoMimicV1,
} from "@/lib/mimic-docai-slide-render-context";
import { listBrandAssets } from "@/lib/caf-core-client";
import {
  assetIdFromBrandProxyUrl,
  resolveBrandFrameReprintUrl,
  resolveBrandLogoReprintUrl,
  resolveBrandLogoReprintUrlById,
} from "@/lib/brand-asset-url";
import { CAF_CORE_URL as ENV_CAF_CORE_URL } from "@/lib/env";

export const dynamic = "force-dynamic";

const RENDERER_BASE_URL = process.env.RENDERER_BASE_URL || "http://localhost:3333";
const CAF_CORE_URL = (ENV_CAF_CORE_URL || process.env.CAF_CORE_URL || "https://caf-core.fly.dev").replace(/\/$/, "");

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function parseLayerPosOverrides(raw: unknown): MimicDocAiLayerPositionOverride[] | null {
  if (!Array.isArray(raw)) return null;
  const out: MimicDocAiLayerPositionOverride[] = [];
  for (const row of raw) {
    const r = asRec(row);
    if (!r) continue;
    const layer_key = String(r.layer_key ?? "").trim();
    const x_px = Number(r.x_px);
    const y_px = Number(r.y_px);
    if (!layer_key || !Number.isFinite(x_px) || !Number.isFinite(y_px)) continue;
    const font_size_px = Number(r.font_size_px);
    const w_px = Number(r.w_px);
    const h_px = Number(r.h_px);
    const text = typeof r.text === "string" ? r.text.trim() : "";
    out.push({
      layer_key,
      x_px: Math.round(x_px),
      y_px: Math.round(y_px),
      ...(Number.isFinite(font_size_px) && font_size_px > 0 ? { font_size_px: Math.round(font_size_px) } : {}),
      ...(Number.isFinite(w_px) && w_px > 0 ? { w_px: Math.round(w_px) } : {}),
      ...(Number.isFinite(h_px) && h_px > 0 ? { h_px: Math.round(h_px) } : {}),
      ...(text ? { text } : {}),
      ...(r.box_locked === true ? { box_locked: true } : {}),
      ...(r.hidden === true ? { hidden: true } : {}),
    });
  }
  return out.length ? out : null;
}

async function resolveLogoOverlay(
  projectSlug: string,
  raw: unknown
): Promise<{ url: string; position: string; asset_id?: string } | undefined> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  let logoUrl = typeof (raw as Record<string, unknown>).url === "string" ? String((raw as Record<string, unknown>).url).trim() : "";
  const logoAssetId =
    typeof (raw as Record<string, unknown>).asset_id === "string"
      ? String((raw as Record<string, unknown>).asset_id).trim()
      : "";
  if (!logoUrl && !logoAssetId) return undefined;
  const slug = projectSlug.trim();
  if (slug && (logoAssetId || logoUrl.startsWith("/api/project-config/brand-assets/proxy") || !/^https?:\/\//i.test(logoUrl))) {
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
  if (!logoUrl) return undefined;
  const position =
    typeof (raw as Record<string, unknown>).position === "string"
      ? String((raw as Record<string, unknown>).position).trim()
      : "br";
  return {
    url: logoUrl,
    position: position || "br",
    ...(logoAssetId ? { asset_id: logoAssetId } : {}),
  };
}

async function resolveFrameOverlay(
  projectSlug: string,
  raw: unknown
): Promise<{ url: string; asset_id?: string } | undefined> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const slug = projectSlug.trim();
  let frameUrl = typeof (raw as Record<string, unknown>).url === "string" ? String((raw as Record<string, unknown>).url).trim() : "";
  const frameAssetId =
    typeof (raw as Record<string, unknown>).asset_id === "string"
      ? String((raw as Record<string, unknown>).asset_id).trim()
      : "";
  if (!frameUrl && !frameAssetId) return undefined;
  if (slug && (!frameUrl || frameUrl.startsWith("/api/project-config/brand-assets/proxy"))) {
    const assets = await listBrandAssets(slug);
    const pool = assets?.brand_assets ?? [];
    if (frameAssetId) {
      frameUrl = resolveBrandFrameReprintUrl(slug, pool, frameAssetId, CAF_CORE_URL);
    }
  }
  if (!frameUrl) return undefined;
  return { url: frameUrl, ...(frameAssetId ? { asset_id: frameAssetId } : {}) };
}

/** Renderer PNG preview — same DocAI overlay + fit path as text-overlay reprint. */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const template = String(body.template ?? "")
      .replace(/\.hbs$/i, "")
      .trim();
    const slideIndex = Math.max(1, Math.floor(Number(body.slide_index) || 1));
    const payload =
      body.payload && typeof body.payload === "object" && !Array.isArray(body.payload)
        ? (body.payload as Record<string, unknown>)
        : {};
    const instagramHandle = typeof body.instagram_handle === "string" ? body.instagram_handle.trim() : "";
    const projectSlug = typeof body.project_slug === "string" ? body.project_slug.trim() : "";
    const backgroundFromBody =
      typeof body.background_image_url === "string" ? body.background_image_url.trim() : "";
    const textBacking = body.text_backing !== false;
    const textBackingColor =
      typeof body.text_backing_color === "string" ? body.text_backing_color.trim() : "";
    const draftOverrides = parseLayerPosOverrides(body.docai_layer_positions);

    if (!template) {
      return NextResponse.json({ ok: false, error: "template required" }, { status: 400 });
    }

    const usableSlides =
      Array.isArray(payload.slides) && payload.slides.length > 0
        ? (payload.slides as Record<string, unknown>[]).filter((x) => x && typeof x === "object")
        : slidesFromGeneratedOutput(payload);

    if (usableSlides.length === 0) {
      return NextResponse.json({ ok: false, error: "no slides in payload" }, { status: 400 });
    }

    let mimicV1 = asRec(payload.mimic_v1);
    if (mimicV1 && draftOverrides?.length) {
      mimicV1 = mergeDocAiLayerPositionsIntoMimicV1(mimicV1, slideIndex, draftOverrides);
    }
    const backgroundFromPayload =
      typeof payload.background_image_url === "string" ? payload.background_image_url.trim() : "";
    const backgroundFromMimic =
      mimicV1 && typeof mimicV1.background_image_url === "string" ? mimicV1.background_image_url.trim() : "";
    const backgroundImageUrl = backgroundFromBody || backgroundFromPayload || backgroundFromMimic;

    let renderBase = carouselRenderBaseForPipeline(
      {
        ...payload,
        slides: usableSlides,
        ...(backgroundImageUrl ? { background_image_url: backgroundImageUrl } : {}),
        ...(mimicV1 ? { mimic_v1: mimicV1 } : {}),
      },
      usableSlides
    );
    renderBase = await withInlinedBackgroundImage(renderBase);
    if (mimicV1?.visual_guideline && typeof mimicV1.visual_guideline === "object") {
      const mimicTypo = mimicSlideTypographyPatch(
        { visual_guideline: mimicV1.visual_guideline as Record<string, unknown> },
        slideIndex,
        usableSlides.length,
        { skipIfReviewerSet: payload }
      );
      renderBase = {
        ...renderBase,
        ...mimicSlideThemePatch({ visual_guideline: mimicV1.visual_guideline as Record<string, unknown> }),
        ...mimicTypo,
      };
    }
    let ctx = buildSlideRenderContext(renderBase, usableSlides, slideIndex, {
      instagramHandle: instagramHandle || null,
    });
    if (mimicV1) {
      const enriched = enrichSlideRenderContextWithMimicDocAi(ctx, mimicV1, slideIndex, usableSlides, {
        instagramHandle,
        textBacking,
        textBackingColor: textBackingColor || undefined,
        layerPosOverrides: draftOverrides,
      });
      ctx = enriched.renderContext;
    }

    const logoOverlay = await resolveLogoOverlay(projectSlug, body.logo_overlay);
    const frameOverlay = await resolveFrameOverlay(projectSlug, body.frame_overlay);
    if (logoOverlay) ctx = { ...ctx, logo_overlay: logoOverlay };
    if (frameOverlay) ctx = { ...ctx, frame_overlay: frameOverlay };

    const base = RENDERER_BASE_URL.replace(/\/$/, "");
    const taskId = String(body.task_id ?? payload.task_id ?? "preview");
    const runId = String(body.run_id ?? payload.run_id ?? "preview");
    const renderBody = {
      template,
      task_id: taskId,
      run_id: runId,
      data: { render: ctx, task_id: taskId, run_id: runId },
      slide_index: slideIndex,
      force: true,
    };
    const res = await fetch(`${base}/preview-template?force=1`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(renderBody),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    if (!data.ok || !data.result_url) {
      return NextResponse.json({ ok: false, error: "No result_url from renderer" }, { status: 502 });
    }
    const imgUrl = data.result_url.startsWith("http") ? data.result_url : `${base}${data.result_url}`;
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) {
      return NextResponse.json({ ok: false, error: "Failed to fetch rendered image" }, { status: 502 });
    }
    const blob = await imgRes.blob();
    return new NextResponse(blob, { headers: { "Content-Type": "image/png" } });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : "Preview failed" },
      { status: 500 }
    );
  }
}
