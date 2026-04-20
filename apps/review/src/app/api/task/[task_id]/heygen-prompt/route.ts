import { NextRequest, NextResponse } from "next/server";
import { decodeTaskIdParam } from "@/lib/task-id";
import { getHeygenLastSubmit, getJobDetailAll } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * GET /api/task/[task_id]/heygen-prompt
 *
 * Returns the most recent HeyGen submission for the task (read from
 * `caf_core.api_call_audit` on the backend). The review console's VideoReviewEdits
 * panel uses this to show the *actual* prompt string that was POSTed to HeyGen —
 * the LLM-authored `video_prompt` plus the appended rubric / brand / product /
 * per-flow blocks — instead of only the upstream LLM draft.
 *
 * Resolves the project slug in this order:
 *   1. `?project=` query string (explicit — used by the all-projects workbench).
 *   2. `PROJECT_SLUG` env (single-tenant deploys).
 *   3. Cross-project lookup via `getJobDetailAll` to discover the owning project.
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
      return NextResponse.json(
        { error: "Could not resolve project for task" },
        { status: 400 }
      );
    }
    const submit = await getHeygenLastSubmit(slug, decodedId);
    return NextResponse.json({ submit });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
