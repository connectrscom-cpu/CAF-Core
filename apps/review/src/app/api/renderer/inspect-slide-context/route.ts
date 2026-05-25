import { NextRequest, NextResponse } from "next/server";
import {
  buildSlideRenderContext,
  carouselRenderBaseForPipeline,
  slidesFromGeneratedOutput,
} from "@caf-core-carousel/carousel-render-pack";
import { mimicSlideTypographyPatch, mimicSlideThemePatch } from "@caf-core-carousel/mimic-slide-typography";
import { mimicPromptForMode } from "@caf-core-carousel/mimic-prompt-builder";

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

    const mimicV1 = asRec(payload.mimic_v1);
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

    const renderContext = buildSlideRenderContext(renderBase, usableSlides, slideIndex, {
      instagramHandle: instagramHandle || null,
    });

    const currentSlide = asRec(usableSlides[Math.min(slideIndex - 1, usableSlides.length - 1)]);
    const mimicRenderMode = mimicV1 ? slideMimicRenderMode(mimicV1, slideIndex) : null;
    const hints = mimicV1 ? slideVisionHints(mimicV1, slideIndex) : {};
    const onImageCopy = slideOnImageCopy(currentSlide);

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
      render_context: renderContext,
    });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "inspect failed" },
      { status: 500 }
    );
  }
}
