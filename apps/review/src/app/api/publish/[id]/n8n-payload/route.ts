import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { getPublicationN8nPayload } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

function resolveProjectSlug(req: NextRequest): string {
  const q = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (q) return q;
  if (!reviewUsesAllProjects()) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const slug = resolveProjectSlug(request);
    if (!slug) {
      return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });
    }
    const data = await getPublicationN8nPayload(slug, id);
    return NextResponse.json({ ...data, project_slug: slug });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load n8n payload" },
      { status: 500 }
    );
  }
}
