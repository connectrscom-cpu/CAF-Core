import { NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import {
  getJobDetail,
  getJobDetailAll,
  getQueueTab,
  getQueueTabAll,
  type ReviewTab,
} from "@/lib/caf-core-client";
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
    if (!job) {
      const row = await lookupQueueRowByTaskId(decodedId, projectQs);
      if (!row) return NextResponse.json({ error: "Task not found" }, { status: 404 });
      return NextResponse.json({ rowIndex: 0, data: row });
    }
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

function generationVal(payload: Record<string, unknown> | null | undefined, key: string): string {
  const v = payload?.[key];
  return typeof v === "string" ? v : "";
}

async function lookupQueueRowByTaskId(
  taskId: string,
  projectSlug?: string
): Promise<Record<string, string | undefined> | null> {
  const tid = taskId.trim();
  if (!tid) return null;

  const tabs: ReviewTab[] = ["in_review", "approved", "rejected", "needs_edit"];
  for (const tab of tabs) {
    const { jobs } = reviewUsesAllProjects()
      ? await getQueueTabAll(tab, {
          search: tid,
          project_slug: projectSlug?.trim() || undefined,
          limit: "50",
          offset: "0",
        })
      : await getQueueTab(PROJECT_SLUG, tab, { search: tid, limit: "50", offset: "0" });

    const match = (jobs ?? []).find((j) => (j.task_id ?? "").trim() === tid) ?? (jobs ?? [])[0];
    if (!match) continue;

    const gen = (match.generation_payload ?? {}) as Record<string, unknown>;
    const project = (match.project_slug ?? PROJECT_SLUG ?? reviewQueueFallbackSlug()).trim();
    const preview_url = (match.preview_thumb_url ?? "").trim();

    return {
      task_id: (match.task_id ?? "").trim(),
      project,
      run_id: match.run_id,
      platform: match.platform ?? "",
      flow_type: match.flow_type ?? "",
      preview_url,
      video_url: "",
      review_status: match.status ?? "",
      decision: match.latest_decision ?? "",
      notes: match.latest_notes ?? "",
      recommended_route: match.recommended_route ?? "",
      qc_status: match.qc_status ?? "",
      risk_score: match.pre_gen_score ?? "",
      generated_title: generationVal(gen, "title") || generationVal(gen, "generated_title"),
      generated_hook: generationVal(gen, "hook") || generationVal(gen, "generated_hook"),
      generated_caption: generationVal(gen, "caption") || generationVal(gen, "generated_caption"),
      generated_slides_json: gen.slides ? JSON.stringify(gen.slides) : "",
      validator: match.latest_validator ?? "",
    };
  }
  return null;
}
