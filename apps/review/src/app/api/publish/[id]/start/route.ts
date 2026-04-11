import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { startPublicationPlacement } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

function resolveProjectSlug(req: NextRequest, bodyProject?: string): string {
  const fromBody = typeof bodyProject === "string" ? bodyProject.trim() : "";
  if (fromBody) return fromBody;
  const q = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (q) return q;
  if (!reviewUsesAllProjects()) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const slug = resolveProjectSlug(request, typeof body.project_slug === "string" ? body.project_slug : undefined);
    if (!slug) {
      return NextResponse.json({ error: "Set PROJECT_SLUG or pass project_slug / ?project=" }, { status: 400 });
    }
    const data = await startPublicationPlacement(slug, id, {
      allow_not_yet_due: body.allow_not_yet_due === true,
      allow_from_draft: body.allow_from_draft === true,
    });
    return NextResponse.json({ ...data, project_slug: slug });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to start publication";
    const st = msg.includes("HTTP 409") ? 409 : 500;
    return NextResponse.json({ error: msg, ok: false }, { status: st });
  }
}
