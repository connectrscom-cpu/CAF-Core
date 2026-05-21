import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug } from "@/lib/env";
import { queuePendingRework } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

/** POST — queue background rework for all NEEDS_EDIT jobs (optional run filter). */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const projectSlug =
      (typeof body.project_slug === "string" && body.project_slug.trim()) ||
      PROJECT_SLUG ||
      reviewQueueFallbackSlug() ||
      "";
    if (!projectSlug) {
      return NextResponse.json({ ok: false, error: "project_slug required" }, { status: 400 });
    }
    const runId = typeof body.run_id === "string" ? body.run_id.trim() : undefined;
    const limit =
      typeof body.limit === "number" && Number.isFinite(body.limit)
        ? Math.min(500, Math.max(1, Math.floor(body.limit)))
        : 200;

    const out = await queuePendingRework({
      project_slug: projectSlug,
      run_id: runId,
      limit,
    });
    return NextResponse.json(out, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 502 });
  }
}
