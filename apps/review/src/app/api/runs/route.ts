import { NextResponse } from "next/server";
import { PROJECT_SLUG, REVIEW_FALLBACK_PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { listRuns, listProjects, type RunListRow } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

interface RunsApiRow extends RunListRow {
  project_slug: string;
}

function pickDisplayName(row: RunListRow): string | null {
  const md = row.metadata_json ?? {};
  const name = (md as Record<string, unknown>)["display_name"];
  return typeof name === "string" && name.trim() ? name.trim() : null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Number(url.searchParams.get("limit") ?? "100");
    const offset = Number(url.searchParams.get("offset") ?? "0");
    const project = url.searchParams.get("project")?.trim() ?? "";

    // Resolve which tenants to query. In single-project mode, just the active slug.
    // In multi-project mode, iterate over active projects (capped).
    const slugs: string[] = [];
    if (project) {
      slugs.push(project);
    } else if (reviewUsesAllProjects()) {
      const catalog = await listProjects();
      for (const p of catalog?.projects ?? []) {
        if (p.active) slugs.push(p.slug);
      }
    } else {
      slugs.push(PROJECT_SLUG || REVIEW_FALLBACK_PROJECT_SLUG || reviewQueueFallbackSlug());
    }

    const all: RunsApiRow[] = [];
    for (const slug of slugs) {
      try {
        const res = await listRuns(slug, { limit, offset });
        if (!res?.runs) continue;
        for (const run of res.runs) {
          all.push({ ...run, project_slug: slug });
        }
      } catch {
        /* skip slug on error */
      }
    }

    all.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

    const items = all.map((r) => ({
      id: r.id,
      run_id: r.run_id,
      project_slug: r.project_slug,
      status: r.status,
      source_window: r.source_window,
      signal_pack_id: r.signal_pack_id,
      display_name: pickDisplayName(r),
      total_jobs: r.total_jobs,
      jobs_completed: r.jobs_completed,
      started_at: r.started_at,
      completed_at: r.completed_at,
      created_at: r.created_at,
      updated_at: r.updated_at,
      has_context_snapshot: Boolean(r.context_snapshot_json),
      has_prompt_snapshot: Boolean(
        r.prompt_versions_snapshot && Object.keys(r.prompt_versions_snapshot).length > 0
      ),
    }));

    return NextResponse.json({
      items,
      total: items.length,
      scope: reviewUsesAllProjects() ? "all" : "single",
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed" },
      { status: 500 }
    );
  }
}
