import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { getJobDetail, getJobDetailAll } from "@/lib/caf-core-client";
import { jobGeneratedSlidesJson } from "@/lib/job-generated-slides";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  try {
    const { task_id } = await params;
    const decodedId = decodeURIComponent(task_id);
    const projectQs = request.nextUrl.searchParams.get("project")?.trim() || undefined;
    const job = reviewUsesAllProjects()
      ? await getJobDetailAll(decodedId, projectQs)
      : await getJobDetail(PROJECT_SLUG, decodedId);
    if (!job) return NextResponse.json({ error: "Task not found" }, { status: 404 });
    const data: Record<string, string | undefined> = {
      task_id: job.task_id,
      project: (job.project_slug ?? PROJECT_SLUG ?? reviewQueueFallbackSlug()).trim(),
      run_id: job.run_id,
      platform: job.platform ?? "",
      flow_type: job.flow_type ?? "",
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
