import { NextRequest, NextResponse } from "next/server";
import { agentInspectionDisabledResponse, isAgentInspectionAuthorized } from "@/lib/agent-inspection/config";
import { buildAgentQueueManifest, parseAgentQueueTab } from "@/lib/agent-inspection/queue-manifest";

export const dynamic = "force-dynamic";

/**
 * Slim, paginated review queue for external agents.
 * Prefer this over raw `/v1/review-queue/.../in_review` (multi-MB payloads).
 */
export async function GET(request: NextRequest) {
  if (!isAgentInspectionAuthorized(request)) {
    return agentInspectionDisabledResponse();
  }

  const projectSlug = (request.nextUrl.searchParams.get("project") ?? "SNS").trim() || "SNS";
  const tab = parseAgentQueueTab(request.nextUrl.searchParams.get("tab"));
  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? "25", 10) || 25));

  try {
    const manifest = await buildAgentQueueManifest({ projectSlug, tab, page, limit });
    return NextResponse.json(manifest);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : "Failed to load agent queue",
        project_slug: projectSlug,
        tab,
      },
      { status: 502 }
    );
  }
}
