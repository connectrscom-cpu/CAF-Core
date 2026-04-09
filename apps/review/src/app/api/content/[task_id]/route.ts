import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { getJobDetail, getJobDetailAll } from "@/lib/caf-core-client";
import { jobGeneratedSlidesJson } from "@/lib/job-generated-slides";
import { previewFieldsFromJob } from "@/lib/job-preview-fields";
import { decodeTaskIdParam } from "@/lib/task-id";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  try {
    const { task_id } = await params;
    const decodedId = decodeTaskIdParam(task_id);
    const projectQs = request.nextUrl.searchParams.get("project")?.trim() || undefined;
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
