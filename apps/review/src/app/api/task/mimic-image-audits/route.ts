import { NextRequest, NextResponse } from "next/server";
import { getJobDetailAll, getMimicImageAudits } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/task/mimic-image-audits?task_id=...&project=...
 *
 * Returns Qwen / mimic image-edit audit rows from `api_call_audit` (prompt text, reference URL, step).
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
    if (!slug) {
      return NextResponse.json({ error: "Could not resolve project for task" }, { status: 400 });
    }
    const audits = await getMimicImageAudits(slug, tid);
    return NextResponse.json({ audits });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
