import { NextRequest, NextResponse } from "next/server";
import { jsonTaskDetailResponse } from "@/lib/task-api-handlers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("task_id")?.trim() ?? "";
  if (!raw) return NextResponse.json({ error: "task_id query param required" }, { status: 400 });
  const projectQs = request.nextUrl.searchParams.get("project")?.trim() || undefined;
  return jsonTaskDetailResponse(raw, projectQs);
}
