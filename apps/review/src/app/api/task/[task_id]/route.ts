import { NextRequest, NextResponse } from "next/server";
import { jsonTaskDetailResponse } from "@/lib/task-api-handlers";
import { decodeTaskIdParam } from "@/lib/task-id";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  const { task_id } = await params;
  const decodedId = decodeTaskIdParam(task_id);
  const projectQs = request.nextUrl.searchParams.get("project")?.trim() || undefined;
  const includeJob = request.nextUrl.searchParams.get("include_job") === "1";
  return jsonTaskDetailResponse(decodedId, projectQs, { includeJob });
}
