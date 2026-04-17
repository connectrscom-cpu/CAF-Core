import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { deletePublicationPlacement, patchPublicationPlacement } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

function resolveProjectSlug(req: NextRequest, bodyProject?: string): string {
  const fromBody = typeof bodyProject === "string" ? bodyProject.trim() : "";
  if (fromBody) return fromBody;
  const q = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (q) return q;
  if (!reviewUsesAllProjects()) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await request.json()) as Record<string, unknown>;
    const slug = resolveProjectSlug(request, typeof body.project_slug === "string" ? body.project_slug : undefined);
    if (!slug) {
      return NextResponse.json({ error: "Set PROJECT_SLUG or pass project_slug" }, { status: 400 });
    }
    const patch: Parameters<typeof patchPublicationPlacement>[2] = {};
    if (typeof body.status === "string") patch.status = body.status as typeof patch.status;
    if (body.scheduled_at === null || typeof body.scheduled_at === "string") patch.scheduled_at = body.scheduled_at;
    if (typeof body.caption_snapshot === "string") patch.caption_snapshot = body.caption_snapshot;
    if (typeof body.title_snapshot === "string") patch.title_snapshot = body.title_snapshot;
    if (Array.isArray(body.media_urls_json)) {
      patch.media_urls_json = (body.media_urls_json as unknown[]).filter((x): x is string => typeof x === "string");
    }
    if (typeof body.video_url_snapshot === "string") patch.video_url_snapshot = body.video_url_snapshot;
    if (typeof body.platform === "string") patch.platform = body.platform;
    const data = await patchPublicationPlacement(slug, id, patch);
    return NextResponse.json({ ...data, project_slug: slug });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update publication" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const slug = resolveProjectSlug(request);
    if (!slug) {
      return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });
    }
    const data = await deletePublicationPlacement(slug, id);
    return NextResponse.json({ ...data, project_slug: slug });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to delete publication";
    const m = msg.match(/HTTP (\d+)/);
    const status = m ? parseInt(m[1]!, 10) : 500;
    const clientStatus = status === 404 || status === 409 ? status : 500;
    return NextResponse.json({ error: msg }, { status: clientStatus });
  }
}
