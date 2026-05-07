import { NextRequest, NextResponse } from "next/server";
import {
  buildSlideRenderContext,
  carouselRenderBaseForPipeline,
  slidesFromGeneratedOutput,
} from "@caf-core-carousel/carousel-render-pack";

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

    const renderBase = carouselRenderBaseForPipeline({ ...payload, slides: usableSlides }, usableSlides);
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
