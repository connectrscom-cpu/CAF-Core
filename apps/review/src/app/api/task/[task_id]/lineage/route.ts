import { NextRequest, NextResponse } from "next/server";
import { decodeTaskIdParam } from "@/lib/task-id";
import { getJobDetailAll, getJobLineage } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  const { task_id } = await params;
  const tid = decodeTaskIdParam(task_id);
  const explicitSlug = request.nextUrl.searchParams.get("project")?.trim() || "";
  try {
    let slug = explicitSlug || PROJECT_SLUG;
    if (!slug && reviewUsesAllProjects()) {
      const job = await getJobDetailAll(tid);
      slug = (job?.project_slug ?? reviewQueueFallbackSlug() ?? "").trim();
    }
    if (!slug) return NextResponse.json({ error: "Could not resolve project for task" }, { status: 400 });
    const lineage = await getJobLineage(slug, tid);
    if (!lineage) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ lineage });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

