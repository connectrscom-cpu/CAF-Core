import { NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { getJobDetail, getJobDetailAll } from "@/lib/caf-core-client";
import { jobGeneratedSlidesJson } from "@/lib/job-generated-slides";
import { previewFieldsFromJob } from "@/lib/job-preview-fields";

/** Long n8n-style task ids break some hosts when used as a single path segment; prefer ?task_id= for API too. */
export async function jsonTaskDetailResponse(
  decodedId: string,
  projectQs: string | undefined
): Promise<NextResponse> {
  try {
    const job = reviewUsesAllProjects()
      ? await getJobDetailAll(decodedId, projectQs)
      : await getJobDetail(PROJECT_SLUG, decodedId);
    if (!job) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const { preview_url, video_url } = previewFieldsFromJob(job);
    const data: Record<string, string | undefined> = {
      task_id: job.task_id,
      project: (job.project_slug ?? PROJECT_SLUG ?? reviewQueueFallbackSlug()).trim(),
      run_id: job.run_id,
      platform: job.platform ?? "",
      flow_type: job.flow_type ?? "",
      preview_url,
      video_url,
      review_status: job.status ?? "",
      decision: job.latest_decision ?? "",
      notes: job.latest_notes ?? "",
      recommended_route: job.recommended_route ?? "",
      qc_status: job.qc_status ?? "",
      risk_score: job.pre_gen_score ?? "",
      generated_title: (job.generation_payload?.title ?? job.generation_payload?.generated_title ?? "") as string,
      generated_hook: (job.generation_payload?.hook ?? job.generation_payload?.generated_hook ?? "") as string,
      generated_caption: (job.generation_payload?.caption ?? job.generation_payload?.generated_caption ?? "") as string,
      generated_slides_json: jobGeneratedSlidesJson(job),
      validator: job.latest_validator ?? "",
    };
    return NextResponse.json({ rowIndex: 0, data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

export async function jsonTaskAssetsResponse(
  decodedId: string,
  projectQs: string | undefined
): Promise<NextResponse> {
  try {
    const job = reviewUsesAllProjects()
      ? await getJobDetailAll(decodedId, projectQs)
      : await getJobDetail(PROJECT_SLUG, decodedId);
    if (!job) return NextResponse.json({ assets: [] });
    return NextResponse.json({ assets: job.assets ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

/** Lighter payload for approved / content-only view. */
export async function jsonContentDetailResponse(
  decodedId: string,
  projectQs: string | undefined
): Promise<NextResponse> {
  try {
    const job = reviewUsesAllProjects()
      ? await getJobDetailAll(decodedId, projectQs)
      : await getJobDetail(PROJECT_SLUG, decodedId);
    if (!job) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const { preview_url, video_url } = previewFieldsFromJob(job);
    const data: Record<string, string | undefined> = {
      task_id: job.task_id,
      project: (job.project_slug ?? PROJECT_SLUG ?? reviewQueueFallbackSlug()).trim(),
      run_id: job.run_id,
      platform: job.platform ?? "",
      flow_type: job.flow_type ?? "",
      preview_url,
      video_url,
      review_status: job.status ?? "",
      decision: job.latest_decision ?? "",
      generated_title: (job.generation_payload?.title ?? job.generation_payload?.generated_title ?? "") as string,
      generated_hook: (job.generation_payload?.hook ?? job.generation_payload?.generated_hook ?? "") as string,
      generated_caption: (job.generation_payload?.caption ?? job.generation_payload?.generated_caption ?? "") as string,
      generated_slides_json: jobGeneratedSlidesJson(job),
    };
    return NextResponse.json({ data });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
