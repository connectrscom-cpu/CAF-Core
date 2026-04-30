import { NextRequest, NextResponse } from "next/server";
import { getJobDetailAll, getJobLineage } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/task/lineage?task_id=...&project=...
 *
 * Query-string variant so very long task ids don't exceed proxy path limits.
 * Mirrors `/api/task/heygen-prompt`.
 */
export async function GET(request: NextRequest) {
  const tid = request.nextUrl.searchParams.get("task_id")?.trim() ?? "";
  if (!tid) return NextResponse.json({ error: "task_id query param required" }, { status: 400 });
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

