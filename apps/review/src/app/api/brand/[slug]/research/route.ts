import { NextRequest, NextResponse } from "next/server";
import {
  createProject,
  listInputsEvidenceImports,
  listInputsScraperRuns,
  listInputsSourceRows,
  listProjects,
  listSignalPacksForProject,
  replaceInputsSourceTabRows,
  runBroadInsightsForImport,
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
  parseResearchPaste,
  toResearchSourceGroups,
} from "@/lib/marketer/research-adapters";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
    finished_at?: string | null;
    error_message: string | null;
    evidence_import_id?: string | null;
    config_snapshot_json?: Record<string, unknown>;
  }>;

  const briefs = (packs?.signal_packs ?? []).map((p) =>
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
    scraperRuns: scraperRuns.map((run) => {
      const snap = run.config_snapshot_json ?? {};
      const runOpts =
        snap.run_options && typeof snap.run_options === "object"
          ? (snap.run_options as Record<string, unknown>)
          : {};
      const rawPlatforms = runOpts.platforms ?? snap.platforms ?? snap.selected_platforms;
      const platforms = Array.isArray(rawPlatforms)
        ? rawPlatforms.map((p) => String(p)).filter(Boolean)
        : [];
      return {
        id: run.id,
        scraper_key: run.scraper_key,
        status: run.status,
        started_at: run.started_at,
        finished_at: run.finished_at ?? null,
        error_message: run.error_message,
        evidence_import_id: run.evidence_import_id ?? null,
        platforms,
      };
    }),
    latestImportId:
      scraperRuns.find((r) => r.evidence_import_id && r.status === "completed")?.evidence_import_id ??
      (imports?.imports ?? [])[0]?.id ??
      null,
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
    importId?: string;
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

  if (body.action === "build_research_brief") {
    const importId =
      (typeof body.importId === "string" && body.importId.trim()) ||
      (
        await listInputsScraperRuns(slug, 10).catch(() => null)
      )?.runs?.find((r) => r.evidence_import_id && r.status === "completed")?.evidence_import_id ||
      (await listInputsEvidenceImports(slug, { limit: 1 }).catch(() => null))?.imports?.[0]?.id;

    if (!importId) {
      return NextResponse.json(
        {
          ok: false,
          error: "no_import",
          message: "No scraped evidence yet. Start market research first, then build a brief.",
        },
        { status: 400 }
      );
    }

    const insights = await runBroadInsightsForImport(slug, importId, {
      rescan: false,
      max_rows: 500,
    }).catch((e) => ({ ok: false as const, error: String(e) }));

    if (!insights || !("ok" in insights) || !insights.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "insights_failed",
          message:
            "Could not analyze evidence. Wait for the scraper to finish, then try again.",
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      importId,
      message:
        "Research brief analysis finished. Open Intelligence to generate ideas, or Ideas if a brief already exists.",
      insights,
    });
  }

  const group = RESEARCH_SOURCE_GROUPS.find((g) => g.tab === body.tab || g.id === body.tab);
  if (!group) {
    return NextResponse.json({ ok: false, error: "unknown_tab" }, { status: 400 });
  }

  const handles =
    body.handles?.length
      ? body.handles
      : body.paste
        ? parseResearchPaste(body.paste, group.tab)
        : [];

  const rows = handlesToSourceRows(handles, group.tab, group.platformLabel);
  const saved = await replaceInputsSourceTabRows(slug, group.tab, rows).catch(() => null);
  if (!saved?.ok) {
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, tab: group.tab, count: rows.length });
}
