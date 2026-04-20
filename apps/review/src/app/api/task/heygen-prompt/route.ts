import { NextRequest, NextResponse } from "next/server";
import { getHeygenLastSubmit, getJobDetailAll } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/task/heygen-prompt?task_id=...&project=...
 *
 * Query-string variant of /api/task/[task_id]/heygen-prompt. Long n8n-style / rework-suffixed
 * task ids occasionally exceed proxy URL limits when placed in a single path segment; the
 * review client prefers this query-string path for exactly that reason (mirrors the
 * /api/task vs /api/task/[task_id] split).
 */
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("task_id")?.trim() ?? "";
  if (!raw) {
    return NextResponse.json({ error: "task_id query param required" }, { status: 400 });
  }
  const explicitSlug = request.nextUrl.searchParams.get("project")?.trim() || "";
  try {
    let slug = explicitSlug || PROJECT_SLUG;
    if (!slug && reviewUsesAllProjects()) {
      const job = await getJobDetailAll(raw);
      slug = (job?.project_slug ?? reviewQueueFallbackSlug() ?? "").trim();
    }
    if (!slug) {
      return NextResponse.json(
        { error: "Could not resolve project for task" },
        { status: 400 }
      );
    }
    const submit = await getHeygenLastSubmit(slug, raw);
    return NextResponse.json({ submit });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
