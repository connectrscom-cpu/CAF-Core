import { NextRequest, NextResponse } from "next/server";
import {
  applyLearningRule,
  eraseLearningRule,
  eraseLearningRulesAll,
  getEditorialNotes,
  getLearningContextPreview,
  getLearningObservations,
  getLearningRules,
  getLearningTransparency,
  getLlmApprovalReviews,
  retireLearningRule,
  triggerEditorialAnalysis,
  triggerLlmApprovalReview,
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

  if (section === "transparency") {
    const data = await getLearningTransparency(projectSlug);
    if (!data) return NextResponse.json({ error: "Failed to fetch transparency" }, { status: 502 });
    return NextResponse.json(data);
  }

  if (section === "llm_approval_reviews") {
    const lim = req.nextUrl.searchParams.get("limit");
    const data = await getLlmApprovalReviews(projectSlug, lim ? parseInt(lim, 10) : undefined);
    if (!data) return NextResponse.json({ error: "Failed to fetch LLM reviews" }, { status: 502 });
    return NextResponse.json(data);
  }

  if (section === "editorial_notes") {
    const windowDays = req.nextUrl.searchParams.get("window_days");
    const limit = req.nextUrl.searchParams.get("limit");
    const includeEmpty = (req.nextUrl.searchParams.get("include_empty") ?? "0") === "1";
    const data = await getEditorialNotes(projectSlug, {
      window_days: windowDays ? parseInt(windowDays, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      include_empty: includeEmpty,
    });
    if (!data) return NextResponse.json({ error: "Failed to fetch editorial notes" }, { status: 502 });
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
    const result = await triggerEditorialAnalysis(projectSlug, body.window_days, {
      persist_engineering_insight: body.persist_engineering_insight,
      llm_notes_synthesis: body.llm_notes_synthesis,
    });
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
  if (action === "erase_rule" && body.rule_id && body.storage_project) {
    try {
      const result = await eraseLearningRule(body.storage_project, body.rule_id);
      return NextResponse.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg || "Failed to erase rule" }, { status: 502 });
    }
  }
  if (action === "erase_rules_all" && body.storage_project) {
    try {
      const result = await eraseLearningRulesAll(body.storage_project, body.status);
      return NextResponse.json(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return NextResponse.json({ error: msg || "Failed to erase rules" }, { status: 502 });
    }
  }

  if (action === "llm_review_approved") {
    const result = await triggerLlmApprovalReview(projectSlug, {
      limit: body.limit,
      task_ids: body.task_ids,
      skip_if_reviewed_within_days: body.skip_if_reviewed_within_days,
      force_rereview: body.force_rereview,
      mint_pending_hints_below_score:
        body.mint_pending_hints_below_score === null
          ? null
          : typeof body.mint_pending_hints_below_score === "number"
            ? body.mint_pending_hints_below_score
            : undefined,
    });
    return NextResponse.json(result ?? { error: "Failed" });
  }

  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
