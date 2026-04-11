import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { completePublicationPlacement } from "@/lib/caf-core-client";

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
    const body = (await request.json()) as Record<string, unknown>;
    const slug = resolveProjectSlug(request, typeof body.project_slug === "string" ? body.project_slug : undefined);
    if (!slug) {
      return NextResponse.json({ error: "Set PROJECT_SLUG or pass project_slug" }, { status: 400 });
    }
    if (typeof body.post_success !== "boolean") {
      return NextResponse.json({ error: "post_success boolean required" }, { status: 400 });
    }
    const data = await completePublicationPlacement(slug, id, {
      post_success: body.post_success,
      platform_post_id: typeof body.platform_post_id === "string" ? body.platform_post_id : undefined,
      posted_url: typeof body.posted_url === "string" ? body.posted_url : undefined,
      publish_error: typeof body.publish_error === "string" ? body.publish_error : undefined,
      external_ref: typeof body.external_ref === "string" ? body.external_ref : undefined,
      result_json: body.result_json && typeof body.result_json === "object" ? (body.result_json as Record<string, unknown>) : undefined,
    });
    return NextResponse.json({ ...data, project_slug: slug });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to complete publication" },
      { status: 500 }
    );
  }
}
