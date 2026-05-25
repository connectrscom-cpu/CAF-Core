import { NextRequest, NextResponse } from "next/server";
import { decodeTaskIdParam } from "@/lib/task-id";
import { getJobDetailAll, getMimicImageAudits } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/task/[task_id]/mimic-image-audits
 *
 * Returns Qwen / mimic image-edit audit rows for the task.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  const { task_id } = await params;
  const decodedId = decodeTaskIdParam(task_id);
  const explicitSlug = request.nextUrl.searchParams.get("project")?.trim() || "";
  try {
    let slug = explicitSlug || PROJECT_SLUG;
    if (!slug && reviewUsesAllProjects()) {
      const job = await getJobDetailAll(decodedId);
      slug = (job?.project_slug ?? reviewQueueFallbackSlug() ?? "").trim();
    }
    if (!slug) {
      return NextResponse.json({ error: "Could not resolve project for task" }, { status: 400 });
    }
    const audits = await getMimicImageAudits(slug, decodedId);
    return NextResponse.json({ audits });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
