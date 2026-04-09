import { NextRequest, NextResponse } from "next/server";
import {
  applyLearningRule,
  getLearningContextPreview,
  getLearningObservations,
  getLearningRules,
  retireLearningRule,
  triggerEditorialAnalysis,
  triggerMarketAnalysis,
  uploadPerformanceCsv,
} from "@/lib/caf-core-client";

export async function GET(req: NextRequest) {
  const projectSlug = req.nextUrl.searchParams.get("project") ?? "SNS";
  const section = req.nextUrl.searchParams.get("section");

  if (section === "observations") {
    const limit = req.nextUrl.searchParams.get("limit");
    const data = await getLearningObservations(projectSlug, limit ? parseInt(limit, 10) : undefined);
    if (!data) return NextResponse.json({ error: "Failed to fetch observations" }, { status: 502 });
    return NextResponse.json(data);
  }

  if (section === "context") {
    const flowType = req.nextUrl.searchParams.get("flow_type") ?? undefined;
    const platform = req.nextUrl.searchParams.get("platform") ?? undefined;
    const data = await getLearningContextPreview(projectSlug, flowType, platform);
    if (!data) return NextResponse.json({ error: "Failed to fetch context preview" }, { status: 502 });
    return NextResponse.json(data);
  }

  const data = await getLearningRules(projectSlug);
  if (!data) return NextResponse.json({ error: "Failed to fetch learning rules" }, { status: 502 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const ct = req.headers.get("content-type") ?? "";

  if (ct.includes("multipart/form-data")) {
    const fd = await req.formData();
    const projectSlug = (fd.get("project") as string) ?? "SNS";
    const result = await uploadPerformanceCsv(projectSlug, fd);
    if (!result) return NextResponse.json({ error: "CSV upload failed" }, { status: 502 });
    return NextResponse.json(result);
  }

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
  if (action === "apply_rule" && body.rule_id && body.storage_project) {
    const result = await applyLearningRule(body.storage_project, body.rule_id);
    return NextResponse.json(result ?? { error: "Failed" });
  }
  if (action === "retire_rule" && body.rule_id && body.storage_project) {
    const result = await retireLearningRule(body.storage_project, body.rule_id);
    return NextResponse.json(result ?? { error: "Failed" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
