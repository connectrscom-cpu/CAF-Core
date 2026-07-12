import { NextRequest, NextResponse } from "next/server";
import {
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
    const fullPacks = await Promise.all(
      packs.map((p) =>
        getSignalPackForProject(slug, p.id, { hydrate_visual_media: true }).catch(() => null)
      )
    );
    const seenIdea = new Set<string>();
    const seenTp = new Set<string>();
    const importIds = new Set<string>();
    for (const brief of briefs) {
      if (brief.importId) importIds.add(brief.importId);
    }
    const insightsByImport = new Map<string, Record<string, unknown>[]>();
    await Promise.all(
      [...importIds].map(async (importId) => {
        const res = await listEvidenceInsightsForImport(slug, importId, { limit: 300 }).catch(() => null);
        insightsByImport.set(importId, (res?.insights ?? []) as Record<string, unknown>[]);
      })
    );
    for (let i = 0; i < fullPacks.length; i++) {
      const resp = fullPacks[i];
      const pack = resp?.signal_pack ?? null;
      if (!pack) continue;
      const brief = briefs[i];
      const importId = importIdForPack(pack, brief?.importId);
      const rows = importId ? insightsByImport.get(importId) ?? [] : [];
      const thumbMap = rows.length ? buildEvidenceThumbnailMap(rows, pack) : new Map<string, string | null>();
      for (const idea of enrichIdeasWithPreviews(parseIdeasFromPack(pack), thumbMap)) {
        if (seenIdea.has(idea.id)) continue;
        seenIdea.add(idea.id);
        ideas.push(idea);
      }
      let packTps = parseTopPerformersForPack(pack);
      if (rows.length) {
        packTps = enrichTopPerformersWithEvidence(packTps, thumbMap);
      }
      for (const tp of packTps) {
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
      getSignalPackForProject(slug, target.id, {
        hydrate_visual_media: true,
      }).catch(() => null),
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