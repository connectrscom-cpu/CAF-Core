import { NextRequest, NextResponse } from "next/server";
import { getSignalPackForProject, listProjects, listSignalPacksForProject } from "@/lib/caf-core-client";
import {
  parseIdeasFromPack,
  parseTopPerformersFromPack,
  toResearchBrief,
} from "@/lib/marketer/idea-adapters";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

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
  const list = await listSignalPacksForProject(slug, { limit: 20 }).catch(() => null);
  const packs = list?.signal_packs ?? [];

  const briefs = packs.map((p) =>
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
  let topPerformers = [] as ReturnType<typeof parseTopPerformersFromPack>;
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
    for (const resp of fullPacks) {
      const pack = resp?.signal_pack;
      if (!pack) continue;
      for (const idea of parseIdeasFromPack(pack)) {
        if (seenIdea.has(idea.id)) continue;
        seenIdea.add(idea.id);
        ideas.push(idea);
      }
      for (const tp of parseTopPerformersFromPack(pack)) {
        if (seenTp.has(tp.id)) continue;
        seenTp.add(tp.id);
        topPerformers.push(tp);
      }
    }
    activePackId = "all";
  } else {
    const target = packIdParam ? packs.find((p) => p.id === packIdParam) : packs[0];
    if (!target) {
      return NextResponse.json({ ok: true, ideas: [], topPerformers: [], packId: null, briefs });
    }
    const packResp = await getSignalPackForProject(slug, target.id, {
      hydrate_visual_media: true,
    }).catch(() => null);
    const pack = packResp?.signal_pack ?? null;
    ideas = parseIdeasFromPack(pack);
    topPerformers = parseTopPerformersFromPack(pack);
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