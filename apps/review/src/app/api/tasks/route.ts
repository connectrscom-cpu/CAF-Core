import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG } from "@/lib/env";
import { getQueueTab, getQueueCounts, type ReviewTab, type QueueFilters } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

const VALID_STATUS: ReviewTab[] = ["in_review", "approved", "rejected", "needs_edit"];

export async function GET(request: NextRequest) {
  const statusParam = request.nextUrl.searchParams.get("status") ?? "in_review";
  const status: ReviewTab = VALID_STATUS.includes(statusParam as ReviewTab) ? (statusParam as ReviewTab) : "in_review";

  try {
    const filters: QueueFilters = {
      search: request.nextUrl.searchParams.get("search") ?? undefined,
      platform: request.nextUrl.searchParams.get("platform") ?? undefined,
      flow_type: request.nextUrl.searchParams.get("flow_type") ?? undefined,
      recommended_route: request.nextUrl.searchParams.get("recommended_route") ?? undefined,
      qc_status: request.nextUrl.searchParams.get("qc_status") ?? undefined,
      review_status: request.nextUrl.searchParams.get("review_status") ?? undefined,
      decision: request.nextUrl.searchParams.get("decision") ?? undefined,
      has_preview: request.nextUrl.searchParams.get("has_preview") ?? undefined,
      risk_score_min: request.nextUrl.searchParams.get("risk_score_min") ?? undefined,
      run_id: request.nextUrl.searchParams.get("run_id") ?? undefined,
      sort: request.nextUrl.searchParams.get("sort") ?? undefined,
      group_by: request.nextUrl.searchParams.get("group") ?? undefined,
    };

    const jobs = await getQueueTab(PROJECT_SLUG, status, filters);

    const page = parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10);
    const limit = parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10);
    const total = jobs.length;
    const start = (page - 1) * limit;
    const items = jobs.slice(start, start + limit).map((j) => ({
      task_id: j.task_id,
      run_id: j.run_id,
      platform: j.platform ?? "",
      flow_type: j.flow_type ?? "",
      review_status: j.status ?? "",
      decision: j.latest_decision ?? "",
      recommended_route: j.recommended_route ?? "",
      qc_status: j.qc_status ?? "",
      risk_score: j.pre_gen_score ?? "",
      generated_title: (j.generation_payload?.title ?? j.generation_payload?.generated_title ?? "") as string,
      generated_hook: (j.generation_payload?.hook ?? j.generation_payload?.generated_hook ?? "") as string,
      generated_caption: (j.generation_payload?.caption ?? j.generation_payload?.generated_caption ?? "") as string,
      generated_slides_json: j.generation_payload?.slides ? JSON.stringify(j.generation_payload.slides) : "",
      preview_url: "",
      video_url: "",
    }));

    const statusCounts: Record<string, number> = {};
    for (const j of jobs) {
      const s = (j.status ?? "").trim() || "(empty)";
      statusCounts[s] = (statusCounts[s] ?? 0) + 1;
    }

    return NextResponse.json({ items, total, page, limit, statusCounts, missingPreviewCount: 0 });
  } catch (err) {
    console.error("GET /api/tasks", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load tasks" }, { status: 500 });
  }
}
