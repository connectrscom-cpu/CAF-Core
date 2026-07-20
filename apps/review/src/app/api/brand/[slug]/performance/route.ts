import { brandAccessDeniedResponse } from "@/lib/brand-access-guard";
import { NextRequest, NextResponse } from "next/server";
import {
  getMarketerPerformanceSummary,
  pullMetaMetricsForProject,
  triggerLlmApprovalReview,
  triggerPerformanceAnalysis,
} from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  {
    const denied = await brandAccessDeniedResponse(slug);
    if (denied) return denied;
  }

  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const windowDays = req.nextUrl.searchParams.get("window_days");
  const data = await getMarketerPerformanceSummary(slug, {
    window_days: windowDays ? parseInt(windowDays, 10) : undefined,
  }).catch(() => null);
  if (!data) {
    return NextResponse.json({ error: "Failed to fetch performance summary" }, { status: 502 });
  }
  return NextResponse.json(data);
}

/**
 * Marketer-facing triggers for the performance page:
 * - performance_analysis — SQL heuristics on ingested metrics (optional pending rules)
 * - llm_review — Nemotron VL on approved (and optionally rejected/needs-edit) content
 * - pull_metrics — Meta Graph insights for published placements
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  {
    const denied = await brandAccessDeniedResponse(slug);
    if (denied) return denied;
  }

  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  if (action === "performance_analysis") {
    const result = await triggerPerformanceAnalysis(slug, {
      window_days: typeof body.window_days === "number" ? body.window_days : undefined,
      auto_create_rules: body.auto_create_rules === true,
      emit_global_observation: body.emit_global_observation !== false,
    }).catch(() => null);
    if (!result) return NextResponse.json({ error: "Performance analysis failed" }, { status: 502 });
    return NextResponse.json(result);
  }

  if (action === "llm_review") {
    const includeFailureLane = body.include_failure_lane === true;
    const decisions = includeFailureLane
      ? ["APPROVED", "REJECTED", "NEEDS_EDIT"]
      : ["APPROVED"];
    const limit =
      typeof body.limit === "number" && Number.isFinite(body.limit)
        ? Math.min(20, Math.max(1, body.limit))
        : 5;
    const result = await triggerLlmApprovalReview(slug, {
      limit,
      decisions,
      force_rereview: body.force_rereview === true,
      skip_if_reviewed_within_days:
        typeof body.skip_if_reviewed_within_days === "number"
          ? body.skip_if_reviewed_within_days
          : undefined,
    }).catch(() => null);
    if (!result) return NextResponse.json({ error: "LLM review failed" }, { status: 502 });
    return NextResponse.json(result);
  }

  if (action === "pull_metrics") {
    const result = await pullMetaMetricsForProject(slug).catch(() => null);
    if (!result) return NextResponse.json({ error: "Metrics pull failed" }, { status: 502 });
    return NextResponse.json(result);
  }

  return NextResponse.json(
    { error: "Unknown action. Use performance_analysis, llm_review, or pull_metrics." },
    { status: 400 }
  );
}
