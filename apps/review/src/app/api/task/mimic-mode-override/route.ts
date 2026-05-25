import { NextRequest, NextResponse } from "next/server";
import { getJobDetailAll, setMimicModeOverride } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * POST /api/task/mimic-mode-override
 * Body: { task_id, mode_override: "carousel_visual" | "template_bg" | null, project?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tid = String(body?.task_id ?? "").trim();
    if (!tid) return NextResponse.json({ error: "task_id required" }, { status: 400 });

    const modeOverride = body?.mode_override ?? null;
    if (modeOverride !== null && modeOverride !== "carousel_visual" && modeOverride !== "template_bg") {
      return NextResponse.json({ error: "mode_override must be 'carousel_visual', 'template_bg', or null" }, { status: 400 });
    }

    let slug = String(body?.project ?? "").trim() || PROJECT_SLUG;
    if (!slug && reviewUsesAllProjects()) {
      const job = await getJobDetailAll(tid);
      slug = (job?.project_slug ?? reviewQueueFallbackSlug() ?? "").trim();
    }
    if (!slug) {
      return NextResponse.json({ error: "Could not resolve project for task" }, { status: 400 });
    }

    const result = await setMimicModeOverride(slug, tid, modeOverride);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
