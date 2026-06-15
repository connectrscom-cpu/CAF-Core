import { NextRequest, NextResponse } from "next/server";
import {
  buildSlideRenderContext,
  carouselRenderBaseForPipeline,
  pickSlideByCarouselIndex,
  slidesFromGeneratedOutput,
} from "@caf-core-carousel/carousel-render-pack";
import { mimicPromptForMode } from "@caf-core-carousel/mimic-prompt-builder";
import {
  mimicSlideTypographyPatch,
  mimicSlideThemePatch,
} from "@caf-core-carousel/mimic-slide-typography";
import {
  enrichSlideRenderContextWithMimicDocAi,
  mergeDocAiLayerPositionsIntoMimicV1,
} from "@/lib/mimic-docai-slide-render-context";
import type { MimicDocAiLayerPositionOverride } from "@caf-core-carousel/mimic-docai-layer-positions";

export const dynamic = "force-dynamic";

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function slideOnImageCopy(slide: Record<string, unknown> | null): string {
  if (!slide) return "";
  const headline = String(slide.headline ?? slide.title ?? slide.cover_title ?? "").trim();
  const body = String(slide.body ?? slide.subtitle ?? slide.cover_subtitle ?? "").trim();
  return [headline, body].filter(Boolean).join("\n\n");
}

function slideVisionHints(mimic: Record<string, unknown>, slideIndex: number): { layout?: string; visual?: string } {
  const vg = asRec(mimic.visual_guideline);
  const slides = Array.isArray(vg?.slides) ? vg!.slides : [];
  const match =
    slides
      .map((raw) => asRec(raw))
      .find((s) => s && Number(s.slide_index) === slideIndex) ?? asRec(slides[slideIndex - 1]);
  if (!match) return {};
  const layout = String(match.layout_template ?? "").trim();
  const visual = String(match.visual_description ?? "").trim();
  return {
    ...(layout ? { layout } : {}),
    ...(visual ? { visual } : {}),
  };
}

function slideMimicRenderMode(mimic: Record<string, unknown>, slideIndex: number): "full_bleed" | "hbs" | null {
  const mode = String(mimic.mode ?? "").trim();
  if (mode === "template_bg") return "hbs";
  if (mode !== "carousel_visual") return null;
  const plans = Array.isArray(mimic.slide_plans) ? mimic.slide_plans : [];
  const plan = plans.map((p) => asRec(p)).find((p) => p && Number(p.slide_index) === slideIndex);
  const renderMode = String(plan?.render_mode ?? "full_bleed").trim();
  return renderMode === "hbs" ? "hbs" : "full_bleed";
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
      ...(Number.isFinite(Number(r.font_weight)) && Number(r.font_weight) >= 100
        ? { font_weight: Math.round(Number(r.font_weight) / 100) * 100 }
        : {}),
      ...(typeof r.color_hex === "string" && /^#[0-9a-fA-F]{3,8}$/.test(r.color_hex.trim())
        ? { color_hex: r.color_hex.trim() }
        : {}),
      ...(typeof r.font_family === "string" && r.font_family.trim() ? { font_family: r.font_family.trim() } : {}),
      ...(r.font_style_italic === true ? { font_style_italic: true } : {}),
    });
  }
  return out.length ? out : null;
}

/**
 * POST /api/renderer/inspect-slide-context
 *
 * Returns the Handlebars render context Core would send to the renderer for one slide,
 * plus the Qwen prompt that would be used for mimic full-bleed / bg-extract paths.
 */
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

    let renderContext = buildSlideRenderContext(renderBase, usableSlides, slideIndex, {
      instagramHandle: instagramHandle || null,
    });

    const currentSlide = asRec(pickSlideByCarouselIndex(usableSlides, slideIndex));
    const mimicRenderMode = mimicV1 ? slideMimicRenderMode(mimicV1, slideIndex) : null;
    const hints = mimicV1 ? slideVisionHints(mimicV1, slideIndex) : {};
    const onImageCopy = slideOnImageCopy(currentSlide);

    let docai_layer_count = 0;
    let docaiTextLayers: Array<Record<string, unknown>> = [];
    let docaiLayerPositions: MimicDocAiLayerPositionOverride[] = [];
    if (mimicV1) {
      const enriched = enrichSlideRenderContextWithMimicDocAi(
        renderContext,
        mimicV1,
        slideIndex,
        usableSlides,
        {
          instagramHandle,
          textBacking,
          textBackingColor: textBackingColor || undefined,
          layerPosOverrides: draftOverrides,
        }
      );
      renderContext = enriched.renderContext;
      docai_layer_count = enriched.docaiLayerCount;
      docaiTextLayers = enriched.docaiTextLayers;
      docaiLayerPositions = enriched.docaiLayerPositions;
    }

    let expectedQwenPrompt: string | null = null;
    if (mimicV1) {
      if (mimicRenderMode === "hbs") {
        expectedQwenPrompt = mimicPromptForMode("template_bg");
      } else if (mimicRenderMode === "full_bleed") {
        expectedQwenPrompt = mimicPromptForMode("carousel_visual", {
          index: slideIndex,
          layout: hints.layout,
          visual: hints.visual,
          onImageCopy,
        });
      }
    }

    return NextResponse.json({
      ok: true,
      template,
      slide_index: slideIndex,
      mimic_render_mode: mimicRenderMode,
      background_image_url: backgroundImageUrl || null,
      expected_qwen_prompt: expectedQwenPrompt,
      docai_layer_count,
      docai_text_layers: docaiTextLayers,
      docai_layer_positions: docaiLayerPositions,
      render_context: renderContext,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "inspect failed" },
      { status: 500 }
    );
  }
}
