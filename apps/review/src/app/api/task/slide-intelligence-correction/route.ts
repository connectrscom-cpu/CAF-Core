import { NextRequest, NextResponse } from "next/server";
import { getJobDetailAll, submitSlideIntelligenceCorrection } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * POST /api/task/slide-intelligence-correction
 * Body: { task_id, slide_index, field, corrected_value, original_value?, project? }
 * Records a Why Mimic slide-intelligence correction as a learning observation.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tid = String(body?.task_id ?? "").trim();
    if (!tid) return NextResponse.json({ error: "task_id required" }, { status: 400 });

    const slideIndex = Number(body?.slide_index);
    if (!Number.isFinite(slideIndex) || slideIndex < 1) {
      return NextResponse.json({ error: "slide_index must be a positive integer" }, { status: 400 });
    }
    const field = String(body?.field ?? "").trim();
    const correctedValue = String(body?.corrected_value ?? "").trim();
    if (!field || !correctedValue) {
      return NextResponse.json({ error: "field and corrected_value required" }, { status: 400 });
    }

    let slug = String(body?.project ?? "").trim() || PROJECT_SLUG;
    if (!slug && reviewUsesAllProjects()) {
      const job = await getJobDetailAll(tid);
      slug = (job?.project_slug ?? reviewQueueFallbackSlug() ?? "").trim();
    }
    if (!slug) {
      return NextResponse.json({ error: "Could not resolve project for task" }, { status: 400 });
    }

    const result = await submitSlideIntelligenceCorrection(slug, {
      taskId: tid,
      slideIndex,
      field,
      correctedValue,
      originalValue: body?.original_value != null ? String(body.original_value) : null,
    });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
