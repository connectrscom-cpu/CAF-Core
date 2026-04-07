import { NextRequest, NextResponse } from "next/server";
import { getLearningRules, triggerEditorialAnalysis, triggerMarketAnalysis } from "@/lib/caf-core-client";

export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("project") ?? "SNS";
  const data = await getLearningRules(projectSlug);
  if (!data) return NextResponse.json({ error: "Failed to fetch learning rules" }, { status: 502 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const projectSlug = body.project ?? "SNS";
  const action = body.action as string;

  if (action === "editorial") {
    const result = await triggerEditorialAnalysis(projectSlug, body.window_days);
    return NextResponse.json(result ?? { error: "Failed" });
  }
  if (action === "market") {
    const result = await triggerMarketAnalysis(projectSlug, body.window_days);
    return NextResponse.json(result ?? { error: "Failed" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
