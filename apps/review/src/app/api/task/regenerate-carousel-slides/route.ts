import { NextRequest, NextResponse } from "next/server";
import {
  getJobDetail,
  getJobDetailAll,
  regenerateMimicCarouselSlides,
} from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { isMimicCarouselFlow } from "@/lib/flow-kind";

export const dynamic = "force-dynamic";

/**
 * POST /api/task/regenerate-carousel-slides
 * Body: { task_id, project?, slide_indices: number[] }
 *
 * Re-runs Flux/Qwen image generation for selected mimic carousel slides (billed).
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
      : [];
    if (slideIndices.length === 0) {
      return NextResponse.json({ ok: false, error: "slide_indices_required" }, { status: 400 });
    }

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
        { ok: false, error: "regenerate_slide_requires_mimic_carousel_job" },
        { status: 400 }
      );
    }

    const result = await regenerateMimicCarouselSlides(slug, tid, slideIndices);
    if (!result.ok) {
      const status = result.error === "job_not_found" ? 404 : 400;
      return NextResponse.json(result, { status });
    }
    return NextResponse.json(result, { status: result.accepted ? 202 : 200 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
