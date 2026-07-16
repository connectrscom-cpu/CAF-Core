import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import {
  getImportEvidenceStats,
  getPreLlmEvidencePreview,
  getProcessingPassProgress,
  runBroadInsightsForImport,
  runDeepCarouselInsights,
  runDeepVideoInsights,
  saveOperatorCutoffSnapshot,
} from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ slug: string }> };

const SOCIAL_KINDS = [
  "instagram_post",
  "tiktok_video",
  "facebook_post",
  "linkedin_post",
  "reddit_post",
] as const;

export async function GET(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const action = req.nextUrl.searchParams.get("action");
  const importId = req.nextUrl.searchParams.get("importId");
  const progressId = req.nextUrl.searchParams.get("progressId");

  if (action === "pass_progress" && progressId) {
    const res = await getProcessingPassProgress(progressId).catch(() => null);
    if (!res?.ok) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
    return NextResponse.json(res);
  }

  if (action === "stats" && importId) {
    const res = await getImportEvidenceStats(slug, importId).catch(() => null);
    if (!res?.ok) {
      return NextResponse.json({ ok: false, message: "Could not load evidence stats" }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      by_kind: res.stats?.by_kind ?? {},
      total_rows: res.stats?.total_rows ?? 0,
    });
  }

  return NextResponse.json({ ok: false, error: "bad_query" }, { status: 400 });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const body = (await req.json()) as {
    action?: string;
    importId?: string;
    evidence_kind?: string;
    min_score?: number;
    max_rows?: number;
    cutoffs?: Record<string, number>;
    rating_top_fraction?: number;
  };

  const importId = String(body.importId ?? "").trim();
  if (!importId) {
    return NextResponse.json({ ok: false, message: "Missing importId" }, { status: 400 });
  }

  if (body.action === "preview_cutoff") {
    const kind = String(body.evidence_kind ?? "").trim();
    const minScore = typeof body.min_score === "number" ? body.min_score : 0.35;
    const preview = await getPreLlmEvidencePreview(slug, importId, {
      evidence_kind: kind,
      min_score: minScore,
      limit: 20,
    }).catch(() => null);
    if (!preview?.ok) {
      return NextResponse.json({ ok: false, message: "Cutoff preview failed" }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      after_user_cutoff: preview.totals?.after_user_cutoff ?? 0,
      profile_min_score: preview.profile_min_score ?? 0.35,
      rows_in_kind: preview.totals?.rows_in_kind ?? 0,
    });
  }

  if (body.action === "save_cutoff") {
    const kind = String(body.evidence_kind ?? "").trim();
    const minScore = typeof body.min_score === "number" ? body.min_score : 0.35;
    const preview = await getPreLlmEvidencePreview(slug, importId, {
      evidence_kind: kind,
      min_score: minScore,
      limit: 5,
    }).catch(() => null);
    if (!preview?.ok || !preview.totals) {
      return NextResponse.json({ ok: false, message: "Could not compute cutoff" }, { status: 502 });
    }
    await saveOperatorCutoffSnapshot(slug, importId, {
      evidence_kind: kind,
      min_score_cutoff: minScore,
      profile_min_score: preview.profile_min_score ?? 0.35,
      totals: {
        rows_in_kind: preview.totals.rows_in_kind,
        sparse_text_dropped: preview.totals.sparse_text_dropped,
        below_profile_min_dropped: preview.totals.below_profile_min_dropped,
        passing_profile_min: preview.totals.passing_profile_min,
        after_user_cutoff: preview.totals.after_user_cutoff,
      },
      active_weights: preview.active_weights ?? null,
    }).catch(() => null);
    return NextResponse.json({ ok: true });
  }

  if (body.action === "run_broad_all") {
    const maxRows = Math.min(5000, Math.max(50, body.max_rows ?? 500));
    const cutoffs = body.cutoffs ?? {};
    const stats = await getImportEvidenceStats(slug, importId).catch(() => null);
    const byKind = stats?.stats?.by_kind ?? {};
    const kinds = SOCIAL_KINDS.filter((k) => (byKind[k] ?? 0) > 0);
    if (kinds.length === 0) {
      return NextResponse.json(
        { ok: false, message: "No social evidence rows found on this import." },
        { status: 400 }
      );
    }

    let totalSent = 0;
    const parts: string[] = [];
    for (const kind of kinds) {
      const minScore = typeof cutoffs[kind] === "number" ? cutoffs[kind]! : 0.35;
      const result = await runBroadInsightsForImport(slug, importId, {
        evidence_kind: kind,
        max_rows: maxRows,
        min_pre_llm_score: minScore,
        rescan: false,
      }).catch((e) => ({ ok: false as const, message: String(e) }));
      if (!result || !("ok" in result) || !result.ok) {
        parts.push(`${kind}: failed`);
        continue;
      }
      const sent = result.rows_sent ?? result.upserted ?? 0;
      totalSent += sent;
      parts.push(`${kind}: ${sent}`);
    }

    return NextResponse.json({
      ok: true,
      summary: `Analyzed ${totalSent} posts (${parts.join("; ")}).`,
      total_sent: totalSent,
    });
  }

  if (body.action === "run_tp_carousel") {
    const progressId = randomUUID();
    const result = await runDeepCarouselInsights(slug, importId, {
      max_rows: body.max_rows ?? 30,
      rating_top_fraction: body.rating_top_fraction ?? 0.05,
      rescan: false,
      progress_id: progressId,
    }).catch((e) => ({ ok: false as const, message: String(e) }));
    if (!result || !("ok" in result) || !result.ok) {
      const message =
        result && typeof result === "object" && "message" in result && result.message
          ? String(result.message)
          : "Carousel analysis failed";
      return NextResponse.json({ ok: false, message }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      progress_id: progressId,
      qualifying: result.qualifying_carousel_rows ?? result.rows_sent,
    });
  }

  if (body.action === "run_tp_video") {
    const result = await runDeepVideoInsights(slug, importId, {
      max_rows: body.max_rows ?? 16,
      rating_top_fraction: body.rating_top_fraction ?? 0.05,
      rescan: false,
    }).catch((e) => ({ ok: false as const, message: String(e) }));
    if (!result || !("ok" in result) || !result.ok) {
      const message =
        result && typeof result === "object" && "message" in result && result.message
          ? String(result.message)
          : "Video analysis failed";
      return NextResponse.json({ ok: false, message }, { status: 502 });
    }
    return NextResponse.json({
      ok: true,
      qualifying: result.qualifying_video_rows ?? result.rows_sent,
    });
  }

  return NextResponse.json({ ok: false, error: "unknown_action" }, { status: 400 });
}
