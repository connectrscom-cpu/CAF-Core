import { NextRequest, NextResponse } from "next/server";
import { getJobDossier } from "@/lib/caf-core-client";

export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("project")?.trim();
  const taskId = req.nextUrl.searchParams.get("task_id")?.trim();
  if (!projectSlug || !taskId) {
    return NextResponse.json({ error: "project and task_id required" }, { status: 400 });
  }
  const data = await getJobDossier(projectSlug, taskId);
  if (!data) return NextResponse.json({ error: "Failed to fetch dossier" }, { status: 502 });
  if (!data.ok) {
    return NextResponse.json(data, { status: data.error === "not_found" ? 404 : 502 });
  }
  return NextResponse.json(data);
}
