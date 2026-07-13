import { NextRequest, NextResponse } from "next/server";
import {
  createProject,
  getSignalPackForProject,
  listInputsEvidenceImports,
  listInputsScraperRuns,
  listInputsSourceRows,
  listProjects,
  listSignalPacksForProject,
  replaceInputsSourceTabRows,
  runInputsScraper,
} from "@/lib/caf-core-client";
import { toResearchBrief, enrichResearchBriefFromScraperRun } from "@/lib/marketer/idea-adapters";
import {
  DEFAULT_RESEARCH_PLATFORMS,
  DEFAULT_RESEARCH_POST_AGE_DAYS,
  RESEARCH_POST_AGE_OPTIONS,
  RESEARCH_RUN_PLATFORMS,
  RESEARCH_SOURCE_GROUPS,
  handlesToSourceRows,
  parseHandlesInput,
  toResearchSourceGroups,
} from "@/lib/marketer/research-adapters";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

async function resolveDisplayName(slug: string): Promise<string> {
  const catalog = await listProjects().catch(() => null);
  const project = catalog?.projects?.find((p) => p.slug === slug);
  return (project?.display_name ?? "").trim() || slug;
}

/** Ensure a CAF project row exists for this brand slug (idempotent). */
async function ensureBrandProject(slug: string, displayName?: string): Promise<boolean> {
  const created = await createProject(slug, displayName?.trim() || slug).catch(() => null);
  return created?.ok === true;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const displayName = await resolveDisplayName(slug);
  const projectReady = await ensureBrandProject(slug, displayName);
  if (!projectReady) {
    return NextResponse.json({ ok: false, error: "project_unavailable" }, { status: 502 });
  }
  const tabs = RESEARCH_SOURCE_GROUPS.map((g) => g.tab);
  const [rowResults, packs, imports, runs] = await Promise.all([
    Promise.all(tabs.map((tab) => listInputsSourceRows(slug, tab).catch(() => null))),
    listSignalPacksForProject(slug, { limit: 20 }).catch(() => null),
    listInputsEvidenceImports(slug, { limit: 10 }).catch(() => null),
    listInputsScraperRuns(slug, 10).catch(() => null),
  ]);

  const rowsByTab: Record<string, Array<{ payload_json?: Record<string, unknown> }>> = {};
  tabs.forEach((tab, i) => {
    rowsByTab[tab] = rowResults[i]?.rows ?? [];
  });

  const scraperRuns = (runs?.runs ?? []) as Array<{
    id: string;
    scraper_key: string;
    status: string;
    started_at: string | null;
    error_message: string | null;
    evidence_import_id?: string | null;
    config_snapshot_json?: Record<string, unknown>;
  }>;

  const briefs = await Promise.all(
    (packs?.signal_packs ?? []).map(async (p) => {
      const full = await getSignalPackForProject(slug, p.id).catch(() => null);
      return enrichResearchBriefFromScraperRun(
        toResearchBrief(
          {
            id: p.id,
            created_at: p.created_at,
            source_window: p.source_window,
            notes: p.notes,
            ideas_count: p.ideas_count,
            upload_filename: p.upload_filename,
            derived_globals_json: full?.signal_pack?.derived_globals_json,
          },
          displayName
        ),
        scraperRuns,
        displayName
      );
    })
  );

  return NextResponse.json({
    ok: true,
    sources: toResearchSourceGroups(rowsByTab),
    briefs,
    runOptions: {
      platforms: RESEARCH_RUN_PLATFORMS,
      postAgeOptions: RESEARCH_POST_AGE_OPTIONS,
      defaultPlatforms: [...DEFAULT_RESEARCH_PLATFORMS],
      defaultPostAgeDays: DEFAULT_RESEARCH_POST_AGE_DAYS,
    },
    evidenceImports: (imports?.imports ?? []).map((imp) => ({
      id: imp.id,
      filename: imp.upload_filename,
      createdAt: imp.created_at,
      rowCount: Number(imp.stored_row_count) || 0,
    })),
    scraperRuns: scraperRuns.map((run) => ({
      id: run.id,
      scraper_key: run.scraper_key,
      status: run.status,
      started_at: run.started_at,
      error_message: run.error_message,
    })),
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const displayName = await resolveDisplayName(slug);
  const projectReady = await ensureBrandProject(slug, displayName);
  if (!projectReady) {
    return NextResponse.json({ ok: false, error: "project_unavailable" }, { status: 502 });
  }

  const body = (await req.json()) as {
    action?: string;
    tab?: string;
    handles?: string[];
    paste?: string;
    platforms?: Array<"instagram" | "tiktok" | "html" | "facebook" | "reddit" | "linkedin">;
    postMaxAgeDays?: number;
  };

  if (body.action === "run_scraper") {
    const platforms = body.platforms?.length ? body.platforms : [...DEFAULT_RESEARCH_PLATFORMS];
    const postMaxAgeDays = body.postMaxAgeDays ?? DEFAULT_RESEARCH_POST_AGE_DAYS;
    const result = await runInputsScraper(slug, {
      scraper: "all",
      platforms,
      postMaxAgeDays,
    }).catch((e) => ({
      ok: false,
      error: String(e),
    }));
    if (!result?.ok) {
      return NextResponse.json({ ok: false, error: "research_failed" }, { status: 502 });
    }
    return NextResponse.json({ ...result, platforms, postMaxAgeDays, startedAt: new Date().toISOString() });
  }

  const group = RESEARCH_SOURCE_GROUPS.find((g) => g.tab === body.tab || g.id === body.tab);
  if (!group) {
    return NextResponse.json({ ok: false, error: "unknown_tab" }, { status: 400 });
  }

  const handles =
    body.handles?.length ? body.handles : body.paste ? parseHandlesInput(body.paste) : [];

  const rows = handlesToSourceRows(handles, group.tab, group.platformLabel);
  const saved = await replaceInputsSourceTabRows(slug, group.tab, rows).catch(() => null);
  if (!saved?.ok) {
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, tab: group.tab, count: rows.length });
}
