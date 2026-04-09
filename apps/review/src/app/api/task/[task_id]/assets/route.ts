import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG, reviewUsesAllProjects } from "@/lib/env";
import { getJobDetail, getJobDetailAll } from "@/lib/caf-core-client";
import { decodeTaskIdParam } from "@/lib/task-id";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  try {
    const { task_id } = await params;
    const decodedId = decodeTaskIdParam(task_id);
    const projectQs = request.nextUrl.searchParams.get("project")?.trim() || undefined;
    const job = reviewUsesAllProjects()
      ? await getJobDetailAll(decodedId, projectQs)
      : await getJobDetail(PROJECT_SLUG, decodedId);
    if (!job) return NextResponse.json({ assets: [] });
    return NextResponse.json({ assets: job.assets ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
