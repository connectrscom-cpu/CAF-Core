import { brandAccessDeniedResponse } from "@/lib/brand-access-guard";
import { NextRequest, NextResponse } from "next/server";
import {
  appendSignalPackIdea,
  getMarketIntelligenceForPack,
  getSignalPackForProject,
  listEvidenceInsightsForImport,
  listInputsScraperRuns,
  listProjects,
  listSignalPacksForProject,
} from "@/lib/caf-core-client";
import {
  parseIdeasFromPack,
  parseTopPerformersForPack,
  enrichTopPerformersWithEvidence,
  enrichIdeasWithPreviews,
  toResearchBrief,
  enrichResearchBriefFromScraperRun,
  toContentIdea,
} from "@/lib/marketer/idea-adapters";
import { buildEvidenceThumbnailMap } from "@/lib/marketer/intel-evidence";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function importIdForPack(pack: Record<string, unknown> | null, briefImportId?: string | null): string | null {
  const derived = pack?.derived_globals_json;
  const dg =
    derived != null && typeof derived === "object" && !Array.isArray(derived)
      ? (derived as Record<string, unknown>)
      : null;
  return (
    str(dg?.from_inputs_evidence_import_id) ||
    str(pack?.source_inputs_import_id) ||
    str(briefImportId) ||
    null
  );
}

async function enrichTopPerformersFromImport(
  slug: string,
  pack: Record<string, unknown> | null,
  refs: ReturnType<typeof parseTopPerformersForPack>,
  importId: string | null
): Promise<ReturnType<typeof parseTopPerformersForPack>> {
  if (!importId || !refs.length) return refs;
  const insightsRes = await listEvidenceInsightsForImport(slug, importId, { limit: 300 }).catch(() => null);
  const rows = (insightsRes?.insights ?? []) as Record<string, unknown>[];
  if (!rows.length) return refs;
  const thumbMap = buildEvidenceThumbnailMap(rows, pack);
  return enrichTopPerformersWithEvidence(refs, thumbMap);
}

async function resolveDisplayName(slug: string): Promise<string> {
  const catalog = await listProjects().catch(() => null);
  const project = catalog?.projects?.find((p) => p.slug === slug);
  return (project?.display_name ?? "").trim() || slug;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  {
    const denied = await brandAccessDeniedResponse(slug);
    if (denied) return denied;
  }

  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const displayName = await resolveDisplayName(slug);
  const packIdParam = req.nextUrl.searchParams.get("packId");
  const [list, runs] = await Promise.all([
    listSignalPacksForProject(slug, { limit: 20 }).catch(() => null),
    listInputsScraperRuns(slug, 10).catch(() => null),
  ]);
  const packs = list?.signal_packs ?? [];
  const scraperRuns = (runs?.runs ?? []) as Array<{
    evidence_import_id?: string | null;
    config_snapshot_json?: Record<string, unknown>;
  }>;

  const briefs = packs.map((p) =>
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

  if (!packs.length) {
    return NextResponse.json({
      ok: true,
      ideas: [],
      topPerformers: [],
      packId: null,
      briefs,
      sourceWindow: null,
    });
  }

  let ideas = [] as ReturnType<typeof parseIdeasFromPack>;
  let topPerformers = [] as ReturnType<typeof parseTopPerformersForPack>;
  let activePackId: string | null = null;
  let sourceWindow: string | null = null;

  if (packIdParam === "all") {
    // Aggregate ideas across briefs without visual-media hydrate or per-import evidence scans.
    const fullPacks = await Promise.all(
      packs.map((p) => getSignalPackForProject(slug, p.id).catch(() => null))
    );
    const seenIdea = new Set<string>();
    const seenTp = new Set<string>();
    for (let i = 0; i < fullPacks.length; i++) {
      const resp = fullPacks[i];
      const pack = resp?.signal_pack ?? null;
      if (!pack) continue;
      for (const idea of parseIdeasFromPack(pack)) {
        if (seenIdea.has(idea.id)) continue;
        seenIdea.add(idea.id);
        ideas.push(idea);
      }
      for (const tp of parseTopPerformersForPack(pack)) {
        if (seenTp.has(tp.id)) continue;
        seenTp.add(tp.id);
        topPerformers.push(tp);
      }
    }
    activePackId = "all";
  } else {
    const target = packIdParam ? packs.find((p) => p.id === packIdParam) : packs[0];
    if (!target) {
      return NextResponse.json({
        ok: true,
        ideas: [],
        topPerformers: [],
        packId: null,
        briefs,
        packIdStale: Boolean(packIdParam && packIdParam !== "all"),
      });
    }
    const [packResp, synthesizedRes] = await Promise.all([
      getSignalPackForProject(slug, target.id).catch(() => null),
      getMarketIntelligenceForPack(slug, target.id).catch(() => null),
    ]);
    const pack = packResp?.signal_pack ?? null;
    const synthesized = synthesizedRes?.ok ? synthesizedRes.market_intelligence_v1 : null;
    const brief = briefs.find((b) => b.id === target.id);
    const importId = importIdForPack(pack, brief?.importId);
    let thumbMap = new Map<string, string | null>();
    if (importId) {
      const insightsRes = await listEvidenceInsightsForImport(slug, importId, { limit: 300 }).catch(() => null);
      const rows = (insightsRes?.insights ?? []) as Record<string, unknown>[];
      if (rows.length) thumbMap = buildEvidenceThumbnailMap(rows, pack);
    }
    ideas = enrichIdeasWithPreviews(parseIdeasFromPack(pack), thumbMap);
    topPerformers = parseTopPerformersForPack(pack, synthesized);
    topPerformers = await enrichTopPerformersFromImport(
      slug,
      pack,
      topPerformers,
      importId
    );
    activePackId = target.id;
    sourceWindow = target.source_window ?? null;
  }

  return NextResponse.json({
    ok: true,
    ideas,
    topPerformers,
    packId: activePackId,
    briefs,
    sourceWindow,
  });
}

/**
 * POST — append a marketer-authored idea (title + concept + destination flow) to a research brief pack.
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  {
    const denied = await brandAccessDeniedResponse(slug);
    if (denied) return denied;
  }

  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const packId = str(body.packId);
  const title = str(body.title);
  const concept = str(body.concept);
  const targetFlowType = str(body.target_flow_type) || str(body.destination) || str(body.flowType);
  const platform = str(body.platform);
  const contentLensRaw = str(body.content_lens).toLowerCase();
  const content_lens = contentLensRaw === "product" ? ("product" as const) : ("niche" as const);

  if (!packId || packId === "all") {
    return NextResponse.json(
      { error: "Select a research brief before adding a manual idea." },
      { status: 400 }
    );
  }
  if (!title) {
    return NextResponse.json({ error: "Title is required." }, { status: 400 });
  }
  if (!targetFlowType.startsWith("FLOW_")) {
    return NextResponse.json({ error: "Pick a generation destination." }, { status: 400 });
  }

  try {
    const result = await appendSignalPackIdea(slug, packId, {
      title,
      concept: concept || undefined,
      target_flow_type: targetFlowType,
      platform: platform || undefined,
      content_lens,
    });
    const idea = toContentIdea(result.idea ?? {}, 0);
    return NextResponse.json({
      ok: true,
      idea,
      ideas_count: result.ideas_count,
      packId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const status = /invalid_destination|title_required|invalid_body|invalid_idea/i.test(msg) ? 400 : 502;
    return NextResponse.json({ error: msg.slice(0, 400) }, { status });
  }
}
