import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import {
  getQueueTab,
  getQueueTabAll,
  getQueueCounts,
  getQueueCountsAll,
  type ReviewTab,
  type QueueFilters,
} from "@/lib/caf-core-client";
import {
  pickCaptionFromGenerationPayload,
  pickHookFromGenerationPayload,
  pickTitleFromGenerationPayload,
} from "@/lib/generation-display-fields";
import { roughSlidesJsonFromGenerationPayload } from "@/lib/job-generated-slides";

export const dynamic = "force-dynamic";

const VALID_STATUS: ReviewTab[] = ["in_review", "approved", "rejected", "needs_edit"];

export async function GET(request: NextRequest) {
  const statusParam = request.nextUrl.searchParams.get("status") ?? "in_review";
  const status: ReviewTab = VALID_STATUS.includes(statusParam as ReviewTab) ? (statusParam as ReviewTab) : "in_review";

  try {
    const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10));
    const limit = Math.min(500, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "50", 10)));
    const offset = (page - 1) * limit;

    const allProjects = reviewUsesAllProjects();
    const projectFilter = request.nextUrl.searchParams.get("project")?.trim();

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
      project_slug: allProjects && projectFilter ? projectFilter : undefined,
      sort: request.nextUrl.searchParams.get("sort") ?? undefined,
      group_by: request.nextUrl.searchParams.get("group") ?? undefined,
      limit: String(limit),
      offset: String(offset),
    };

    const tabCountFilters: QueueFilters = {
      search: filters.search,
      platform: filters.platform,
      flow_type: filters.flow_type,
      recommended_route: filters.recommended_route,
      qc_status: filters.qc_status,
      review_status: filters.review_status,
      decision: filters.decision,
      has_preview: filters.has_preview,
      risk_score_min: filters.risk_score_min,
      run_id: filters.run_id,
      project_slug: filters.project_slug,
    };

    const [{ jobs, total, status_breakdown }, tabCounts] = await Promise.all([
      allProjects
        ? getQueueTabAll(status, filters)
        : getQueueTab(PROJECT_SLUG, status, filters),
      allProjects ? getQueueCountsAll(tabCountFilters) : getQueueCounts(PROJECT_SLUG),
    ]);

    const items = jobs.map((j) => {
      const gp = (j.generation_payload ?? {}) as Record<string, unknown>;
      const slidesFromPayload =
        j.generation_payload?.slides != null && typeof j.generation_payload.slides === "object"
          ? JSON.stringify(j.generation_payload.slides)
          : "";
      const generated_slides_json = slidesFromPayload || roughSlidesJsonFromGenerationPayload(gp);
      return {
        task_id: j.task_id,
        project: (j.project_slug ?? PROJECT_SLUG ?? reviewQueueFallbackSlug()).trim(),
        run_id: j.run_id,
        platform: j.platform ?? "",
        flow_type: j.flow_type ?? "",
        review_status: j.status ?? "",
        decision: j.latest_decision ?? "",
        recommended_route: j.recommended_route ?? "",
        qc_status: j.qc_status ?? "",
        risk_score: j.pre_gen_score ?? "",
        generated_title: pickTitleFromGenerationPayload(gp),
        generated_hook: pickHookFromGenerationPayload(gp),
        generated_caption: pickCaptionFromGenerationPayload(gp),
        generated_slides_json,
        preview_url: (j.preview_thumb_url ?? "").trim(),
        video_url: "",
      };
    });

    return NextResponse.json({
      items,
      total,
      page,
      limit,
      scope: allProjects ? "all" : "single",
      tabCounts,
      statusCounts: status_breakdown,
      missingPreviewCount: 0,
    });
  } catch (err) {
    console.error("GET /api/tasks", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to load tasks" }, { status: 500 });
  }
}
