import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { createPublicationPlacement, listPublicationPlacements } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

function resolveProjectSlug(req: NextRequest, bodyProject?: string): string {
  const fromBody = typeof bodyProject === "string" ? bodyProject.trim() : "";
  if (fromBody) return fromBody;
  const q = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (q) return q;
  if (!reviewUsesAllProjects()) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

export async function GET(request: NextRequest) {
  try {
    const slug = resolveProjectSlug(request);
    if (!slug) {
      return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });
    }
    const task_id = request.nextUrl.searchParams.get("task_id")?.trim() || undefined;
    const status = request.nextUrl.searchParams.get("status")?.trim() || undefined;
    const due_only =
      request.nextUrl.searchParams.get("due_only") === "1" ||
      request.nextUrl.searchParams.get("due_only") === "true";
    const platform = request.nextUrl.searchParams.get("platform")?.trim() || undefined;
    const limit = request.nextUrl.searchParams.get("limit") ?? undefined;
    const offset = request.nextUrl.searchParams.get("offset") ?? undefined;
    const data = await listPublicationPlacements(slug, {
      task_id,
      status,
      due_only,
      platform,
      limit: limit ? parseInt(limit, 10) : 200,
      offset: offset ? parseInt(offset, 10) : 0,
    });
    return NextResponse.json({ ok: true, placements: data.placements ?? [], project_slug: slug });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list publications" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const slug = resolveProjectSlug(request, typeof body.project_slug === "string" ? body.project_slug : undefined);
    if (!slug) {
      return NextResponse.json({ error: "Set PROJECT_SLUG or pass project_slug" }, { status: 400 });
    }
    const task_id = typeof body.task_id === "string" ? body.task_id.trim() : "";
    const platform = typeof body.platform === "string" ? body.platform.trim() : "";
    if (!task_id || !platform) {
      return NextResponse.json({ error: "task_id and platform required" }, { status: 400 });
    }
    const data = await createPublicationPlacement(slug, {
      task_id,
      platform,
      content_format: body.content_format as "carousel" | "video" | "unknown" | undefined,
      status: body.status as "draft" | "scheduled" | undefined,
      scheduled_at: typeof body.scheduled_at === "string" || body.scheduled_at === null ? (body.scheduled_at as string | null) : undefined,
      caption_snapshot: typeof body.caption_snapshot === "string" ? body.caption_snapshot : undefined,
      title_snapshot: typeof body.title_snapshot === "string" ? body.title_snapshot : undefined,
      media_urls_json: Array.isArray(body.media_urls_json)
        ? (body.media_urls_json as unknown[]).filter((x): x is string => typeof x === "string")
        : undefined,
      video_url_snapshot: typeof body.video_url_snapshot === "string" ? body.video_url_snapshot : undefined,
    });
    return NextResponse.json({ ...data, project_slug: slug });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create publication" },
      { status: 500 }
    );
  }
}
