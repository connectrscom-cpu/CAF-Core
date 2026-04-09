import { NextRequest, NextResponse } from "next/server";
import { jsonTaskAssetsResponse } from "@/lib/task-api-handlers";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("task_id")?.trim() ?? "";
  if (!raw) return NextResponse.json({ assets: [] });
  const projectQs = request.nextUrl.searchParams.get("project")?.trim() || undefined;
  return jsonTaskAssetsResponse(raw, projectQs);
}
