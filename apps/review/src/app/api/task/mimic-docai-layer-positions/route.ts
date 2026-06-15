import { NextRequest, NextResponse } from "next/server";
import { getJobDetail, getJobDetailAll } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { isMimicCarouselFlow } from "@/lib/flow-kind";

export const dynamic = "force-dynamic";

const CAF_CORE_URL = process.env.CAF_CORE_URL?.replace(/\/$/, "") ?? "";

function coreHeaders(): HeadersInit {
  const h: HeadersInit = { "Content-Type": "application/json" };
  const token = process.env.CAF_CORE_API_TOKEN?.trim();
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

/**
 * POST /api/task/mimic-docai-layer-positions
 * Body: { task_id, project?, slide_index, positions: [{ layer_key, x_px, y_px }] }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tid = String(body?.task_id ?? "").trim();
    const slideIndex = Math.floor(Number(body?.slide_index));
    const positions = Array.isArray(body?.positions) ? body.positions : [];
    if (!tid || !Number.isFinite(slideIndex) || slideIndex < 1) {
      return NextResponse.json({ error: "task_id and slide_index required" }, { status: 400 });
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
      return NextResponse.json({ error: "job_not_found" }, { status: 404 });
    }
    if (!isMimicCarouselFlow(job.flow_type)) {
      return NextResponse.json(
        { ok: false, error: "mimic_docai_layer_positions_requires_mimic_carousel_job" },
        { status: 400 }
      );
    }

    const useQuery = tid.length >= 120;
    const path = useQuery
      ? `/v1/review-queue/${encodeURIComponent(slug)}/mimic-docai-layer-positions`
      : `/v1/review-queue/${encodeURIComponent(slug)}/task/${encodeURIComponent(tid)}/mimic-docai-layer-positions`;

    const res = await fetch(`${CAF_CORE_URL}${path}`, {
      method: "POST",
      headers: coreHeaders(),
      body: JSON.stringify({
        task_id: tid,
        slide_index: slideIndex,
        positions,
      }),
      cache: "no-store",
    });
    const json = await res.json();
    if (!res.ok) {
      return NextResponse.json(json, { status: res.status });
    }
    return NextResponse.json(json);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
