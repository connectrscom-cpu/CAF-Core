import { NextRequest, NextResponse } from "next/server";
import {
  getJobDetail,
  getJobDetailAll,
  reprintMimicTextOverlay,
  type MimicDocAiLayerPositionRow,
} from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { isMimicCarouselFlow } from "@/lib/flow-kind";

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
    if (!isMimicCarouselFlow(job.flow_type)) {
      return NextResponse.json(
        { ok: false, error: "reprint_text_overlay_requires_mimic_carousel_job" },
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

    const result = await reprintMimicTextOverlay(slug, tid, {
      slideIndices,
      renderTypography,
      textBacking,
      textBackingColor,
      docaiLayerPositions,
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
