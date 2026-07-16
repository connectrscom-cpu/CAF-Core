import { NextRequest, NextResponse } from "next/server";
import {
  buildIdeasFromImport,
  buildSignalPackFromImport,
  getContentRoutes,
  getMarketIntelligenceForPack,
  getSignalPackForProject,
  listEvidenceInsightsForImport,
  listInputsScraperRuns,
  listProjects,
  listSignalPacksForProject,
} from "@/lib/caf-core-client";
import { parseHashtagsFromPack, toResearchBrief, enrichResearchBriefFromScraperRun } from "@/lib/marketer/idea-adapters";
import { mapEnrichedRowToEvidencePost } from "@/lib/marketer/intel-evidence";
import { buildMarketIntelligenceView } from "@/lib/marketer/market-intelligence-adapters";
import type { IntelEvidencePost } from "@/lib/marketer/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Ctx = { params: Promise<{ slug: string }> };

async function resolveDisplayName(slug: string): Promise<string> {
  const catalog = await listProjects().catch(() => null);
  const project = catalog?.projects?.find((p) => p.slug === slug);
  return (project?.display_name ?? "").trim() || slug;
}

async function loadPack(
  slug: string,
  packId: string | null,
  displayName: string,
  scraperRuns: Array<{
    evidence_import_id?: string | null;
    config_snapshot_json?: Record<string, unknown>;
  }>
) {
  const list = await listSignalPacksForProject(slug, { limit: 20 }).catch(() => null);
  const packs = list?.signal_packs ?? [];
  const target = packId && packId !== "all" ? packs.find((p) => p.id === packId) : packs[0];
  if (!target) return { pack: null, packs, brief: null, synthesized: null as Record<string, unknown> | null };

  const [full, synthesizedRes] = await Promise.all([
    getSignalPackForProject(slug, target.id).catch(() => null),
    getMarketIntelligenceForPack(slug, target.id).catch(() => null),
  ]);

  const pack = full?.signal_pack ?? null;
  const synthesized = synthesizedRes?.ok ? synthesizedRes.market_intelligence_v1 : null;

  return {
    pack,
    packs,
    synthesized,
    brief: enrichResearchBriefFromScraperRun(
      toResearchBrief(
        {
          id: target.id,
          created_at: target.created_at,
          source_window: target.source_window,
          notes: target.notes,
          ideas_count: target.ideas_count,
          upload_filename: target.upload_filename,
          derived_globals_json: pack?.derived_globals_json,
          source_inputs_import_id: str(pack?.source_inputs_import_id) || undefined,
        },
        displayName
      ),
      scraperRuns,
      displayName
    ),
  };
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const displayName = await resolveDisplayName(slug);
  const packId = req.nextUrl.searchParams.get("packId");
  const runs = await listInputsScraperRuns(slug, 10).catch(() => null);
  const scraperRuns = (runs?.runs ?? []) as Array<{
    evidence_import_id?: string | null;
    config_snapshot_json?: Record<string, unknown>;
  }>;
  const { pack, packs, brief, synthesized } = await loadPack(slug, packId, displayName, scraperRuns);

  const intelligence = buildMarketIntelligenceView(pack, [], synthesized);

  let evidencePosts: IntelEvidencePost[] = [];
  const importId = brief?.importId ?? str(pack?.source_inputs_import_id);
  if (importId) {
    const insightsRes = await listEvidenceInsightsForImport(slug, importId, { limit: 200 }).catch(() => null);
    const rows = insightsRes?.insights ?? [];
    evidencePosts = rows
      .map((row) => mapEnrichedRowToEvidencePost(row, pack))
      .filter((p): p is IntelEvidencePost => p != null);
  }

  const briefOptions = packs.map((p) =>
    enrichResearchBriefFromScraperRun(
      toResearchBrief(
        {
          id: p.id,
          created_at: p.created_at,
          source_window: p.source_window,
          notes: p.notes,
          ideas_count: p.ideas_count,
          upload_filename: p.upload_filename,
          source_inputs_import_id: p.source_inputs_import_id ?? null,
        },
        displayName
      ),
      scraperRuns,
      displayName
    )
  );

  return NextResponse.json({
    ok: true,
    intelligence,
    packId: brief?.id ?? null,
    brief,
    briefs: briefOptions,
    importId: brief?.importId ?? null,
    hashtags: parseHashtagsFromPack(pack),
    evidencePosts,
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const body = (await req.json()) as {
    packId?: string;
    routeQuotas?: Record<string, number>;
    targetIdeaCount?: number;
  };

  const displayName = await resolveDisplayName(slug);
  const runs = await listInputsScraperRuns(slug, 10).catch(() => null);
  const scraperRuns = (runs?.runs ?? []) as Array<{
    evidence_import_id?: string | null;
    config_snapshot_json?: Record<string, unknown>;
  }>;
  const { brief } = await loadPack(slug, body.packId ?? null, displayName, scraperRuns);
  const importId = brief?.importId;
  if (!importId) {
    return NextResponse.json(
      { ok: false, error: "no_import", message: "Select a research brief linked to processed evidence." },
      { status: 400 }
    );
  }

  const routeQuotas = body.routeQuotas ?? {};
  // Quotas only drive idea_quotas buckets — do not rewrite enabled content routes
  // (a lane with 0 ideas this run should stay enabled for cart/strategy).
  const routes = await getContentRoutes(slug).catch(() => null);
  const buckets: Record<string, number> = {};
  // Map lane counts onto primary idea buckets (same ids as Core content-routes).
  const LANE_BUCKETS: Record<string, string[]> = {
    niche_carousels: ["niche_carousel_text"],
    product_carousels: ["product_carousel_text"],
    visual_first_carousels: ["niche_carousel_visual", "product_carousel_visual"],
    avatar_video_script: ["niche_video_script_avatar"],
    avatar_video_prompt: ["niche_video_prompt_avatar"],
    video_no_avatar: ["niche_video_no_avatar"],
    hook_first_video: ["niche_video_hook_first"],
    ugc_video: ["niche_video_ugc", "product_video_ugc"],
    product_marketing_videos: ["product_video"],
    linkedin_posts: ["niche_linkedin_text", "niche_linkedin_document"],
    reddit_posts: ["niche_reddit_post"],
    instagram_threads: ["niche_instagram_thread"],
  };
  for (const [laneId, count] of Object.entries(routeQuotas)) {
    const n = Math.max(0, Math.min(50, Number(count) || 0));
    if (n <= 0) continue;
    const ids = LANE_BUCKETS[laneId] ?? [];
    if (!ids.length) continue;
    const each = Math.max(1, Math.floor(n / ids.length));
    let left = n;
    ids.forEach((bid, i) => {
      const take = i === ids.length - 1 ? left : Math.min(each, left);
      buckets[bid] = (buckets[bid] ?? 0) + take;
      left -= take;
    });
  }
  const target =
    body.targetIdeaCount ??
    (Object.values(buckets).reduce((a, n) => a + n, 0) || 30);

  try {
    const ideasResult = await buildIdeasFromImport(slug, importId, {
      title: `Ideas from ${brief?.userTitle ?? brief?.label ?? "research"}`,
      target_idea_count: target,
      idea_quotas:
        Object.keys(buckets).length > 0
          ? {
              buckets,
              product_angles_enabled: Boolean(
                routes?.enabled_lane_ids?.includes("product_marketing_videos")
              ),
            }
          : undefined,
    });

    if (!ideasResult?.ok || !ideasResult.idea_list_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "generate_failed",
          message: "Could not generate ideas. Try again in a minute or browse existing ideas for this brief.",
        },
        { status: 502 }
      );
    }

    const packResult = await buildSignalPackFromImport(slug, importId, {
      idea_list_id: ideasResult.idea_list_id,
      notes: `Marketer-generated from intelligence · ${brief?.label ?? importId}`,
    });

    if (!packResult?.ok || !packResult.signal_pack_id) {
      return NextResponse.json(
        {
          ok: false,
          error: "pack_failed",
          message:
            "Ideas were generated but compiling the research brief failed. Your operator can finish in Processing.",
          ideaListId: ideasResult.idea_list_id,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      ideasCount: packResult.ideas_count ?? ideasResult.ideas_count,
      ideaListId: ideasResult.idea_list_id,
      signalPackId: packResult.signal_pack_id,
      message: `Created a new research brief with ${packResult.ideas_count ?? ideasResult.ideas_count ?? 0} ideas. Open Ideas to review them.`,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        error: "timeout",
        message:
          "Generation is taking longer than expected. Browse existing ideas for this brief, or try again with fewer formats selected.",
      },
      { status: 504 }
    );
  }
}
