import { NextRequest, NextResponse } from "next/server";
import { syncBrandAssetToHeygen } from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

function resolveProjectSlug(req: NextRequest, bodyProject?: string): string {
  const fromBody = typeof bodyProject === "string" ? bodyProject.trim() : "";
  if (fromBody) return fromBody;
  const q = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (q) return q;
  if (!reviewUsesAllProjects()) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params;
  let bodyProject: string | undefined;
  try {
    const b = (await req.json()) as Record<string, unknown>;
    bodyProject = typeof b.project_slug === "string" ? b.project_slug : undefined;
  } catch {
    /* empty body is fine */
  }
  const slug = resolveProjectSlug(req, bodyProject);
  if (!slug) return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });
  try {
    const data = await syncBrandAssetToHeygen(slug, id);
    return NextResponse.json(data);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /HTTP 404/.test(msg) ? 404 : /HTTP 400/.test(msg) ? 400 : 502;
    return NextResponse.json({ error: msg }, { status });
  }
}
