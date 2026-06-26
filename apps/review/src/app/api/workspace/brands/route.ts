import { NextResponse } from "next/server";
import {
  getBrandProfile,
  getQueueCounts,
  getStrategy,
  listInputsEvidenceImports,
  listProjects,
  listPublicationPlacements,
  listSignalPacksForProject,
} from "@/lib/caf-core-client";
import { toBrandSummary } from "@/lib/marketer/brand-adapters";
import { filterMarketerBrands } from "@/lib/marketer/project-filters";
import type { BrandSummary } from "@/lib/marketer/types";
import { PROJECT_SLUG, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

async function summarizeBrand(
  slug: string,
  project: NonNullable<Awaited<ReturnType<typeof listProjects>>>["projects"][number]
): Promise<BrandSummary | null> {
  const [counts, placements, evidence, packs, brandProfile, strategy] = await Promise.all([
    getQueueCounts(slug).catch(() => ({ in_review: 0, approved: 0, rejected: 0, needs_edit: 0 })),
    listPublicationPlacements(slug, { upcoming_only: true, limit: 50 }).catch(() => ({
      ok: true,
      placements: [],
    })),
    listInputsEvidenceImports(slug, { limit: 1 }).catch(() => ({ ok: true, imports: [], count: 0 })),
    listSignalPacksForProject(slug, { limit: 1 }).catch(() => ({ ok: true, signal_packs: [], count: 0 })),
    getBrandProfile(slug).catch(() => null),
    getStrategy(slug).catch(() => null),
  ]);

  const strategyRow = (strategy as { strategy?: Record<string, unknown> } | null)?.strategy ?? null;
  const hasStrategyContent =
    !!strategyRow &&
    [strategyRow.core_offer, strategyRow.target_audience, strategyRow.positioning_statement].some(
      (v) => typeof v === "string" && v.trim().length > 0
    );

  const scheduled =
    placements.placements?.filter((p) => p.status === "scheduled" || p.status === "draft").length ?? 0;
  const latestPack = packs.signal_packs?.[0];
  const ideasCount = latestPack?.ideas_count ?? 0;

  return toBrandSummary({
    project,
    counts,
    scheduledPosts: scheduled,
    evidenceImportCount: evidence.count ?? evidence.imports?.length ?? 0,
    signalPackCount: packs.signal_packs?.length ?? packs.count ?? 0,
    latestPackIdeasCount: ideasCount,
    hasBrandProfile: !!brandProfile?.parsed || !!brandProfile?.active || hasStrategyContent,
  });
}

export async function GET() {
  const multi = reviewUsesAllProjects();
  const catalog = await listProjects();
  const projects = filterMarketerBrands((catalog?.projects ?? []).filter((p) => p.active));

  let slugs = projects.map((p) => p.slug);
  if (!multi && PROJECT_SLUG.trim()) {
    slugs = slugs.filter((s) => s === PROJECT_SLUG.trim());
    if (slugs.length === 0) slugs = [PROJECT_SLUG.trim()];
  }

  const brands = (
    await Promise.all(
      projects
        .filter((p) => slugs.includes(p.slug))
        .map((project) => summarizeBrand(project.slug, project))
    )
  ).filter((b): b is BrandSummary => b !== null);

  brands.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return NextResponse.json({
    ok: true,
    multiProject: multi,
    brands,
  });
}
