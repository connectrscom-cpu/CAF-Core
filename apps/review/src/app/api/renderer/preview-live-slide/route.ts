import { NextRequest, NextResponse } from "next/server";
import {
  buildSlideRenderContext,
  carouselRenderBaseForPipeline,
  slidesFromGeneratedOutput,
  withInlinedBackgroundImage,
} from "@caf-core-carousel/carousel-render-pack";
import { mimicSlideTypographyPatch } from "@caf-core-carousel/mimic-slide-typography";

export const dynamic = "force-dynamic";

const RENDERER_BASE_URL = process.env.RENDERER_BASE_URL || "http://localhost:3333";

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

    const mimicV1 =
      payload.mimic_v1 && typeof payload.mimic_v1 === "object" && !Array.isArray(payload.mimic_v1)
        ? (payload.mimic_v1 as Record<string, unknown>)
        : null;
    const backgroundFromPayload =
      typeof payload.background_image_url === "string" ? payload.background_image_url.trim() : "";
    const backgroundFromMimic =
      mimicV1 && typeof mimicV1.background_image_url === "string"
        ? mimicV1.background_image_url.trim()
        : "";
    const backgroundImageUrl = backgroundFromBody || backgroundFromPayload || backgroundFromMimic;

    let renderBase = carouselRenderBaseForPipeline(
      {
        ...payload,
        slides: usableSlides,
        ...(backgroundImageUrl ? { background_image_url: backgroundImageUrl } : {}),
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
      renderBase = { ...renderBase, ...mimicTypo };
    }
    const ctx = buildSlideRenderContext(renderBase, usableSlides, slideIndex, {
      instagramHandle: instagramHandle || null,
    });

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
