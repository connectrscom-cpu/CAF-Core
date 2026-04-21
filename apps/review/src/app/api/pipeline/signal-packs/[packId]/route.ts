import { NextResponse } from "next/server";
import { getSignalPackForProject } from "@/lib/caf-core-client";
import { reviewQueueFallbackSlug } from "@/lib/env";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ packId: string }> }
) {
  try {
    const { packId } = await context.params;
    const url = new URL(request.url);
    const project = url.searchParams.get("project")?.trim() || reviewQueueFallbackSlug();
    const data = await getSignalPackForProject(project, packId);
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
