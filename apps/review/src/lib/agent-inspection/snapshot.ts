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
import { MARKETER_LABELS } from "@/lib/marketer/language";
import type { BrandSummary } from "@/lib/marketer/types";
import { PROJECT_SLUG, reviewUsesAllProjects } from "@/lib/env";
import { isAgentInspectionEnabled } from "./config";
import { buildCopyInventory } from "./copy-inventory";
import { brandRoutes, MAIN_ROUTE_DESCRIPTIONS } from "./route-map";
import { buildDashboardExample, describePage } from "./page-descriptors";
import { scanTechnicalTermsInCopy } from "./technical-terms";

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

export async function fetchBrandsForInspection(): Promise<{
  brands: BrandSummary[];
  data_source: "live_core_api" | "static_route_map";
  error?: string;
}> {
  try {
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
    return { brands, data_source: "live_core_api" };
  } catch (e) {
    return {
      brands: [],
      data_source: "static_route_map",
      error: e instanceof Error ? e.message : "Failed to load brands",
    };
  }
}

function buildNavigation(brands: BrandSummary[], exampleSlug: string) {
  const slug = brands.find((b) => b.slug === exampleSlug)?.slug ?? brands[0]?.slug ?? exampleSlug;
  const brandNav = brandRoutes(slug).map((r, i) => ({
    label: r.title,
    href: r.path,
    ...(i === 0 ? { active_example: true } : {}),
  }));

  return {
    workspace: [{ label: MARKETER_LABELS.brands, href: "/workspace" }],
    brand: brandNav,
    example_brand_slug: slug,
  };
}

export async function buildAgentSnapshot() {
  const { brands, data_source, error } = await fetchBrandsForInspection();
  const exampleBrand = brands.find((b) => b.slug === "SNS") ?? brands[0] ?? null;
  const exampleSlug = exampleBrand?.slug ?? "SNS";

  const technical_terms_visible = scanTechnicalTermsInCopy();

  return {
    app: "CAF Review",
    surface: "marketer_workspace",
    inspection_mode: isAgentInspectionEnabled(),
    generated_at: new Date().toISOString(),
    data_source,
    ...(error ? { load_warning: error } : {}),
    current_known_route: exampleBrand ? `/brand/${exampleBrand.slug}` : "/workspace",
    brands: brands.map((b) => ({
      name: b.displayName,
      slug: b.slug,
      display_label: b.displayName,
      href: `/brand/${encodeURIComponent(b.slug)}`,
    })),
    current_brand: exampleBrand
      ? {
          name: exampleBrand.displayName,
          slug: exampleBrand.slug,
          display_label: exampleBrand.displayName,
        }
      : null,
    navigation: buildNavigation(brands, exampleSlug),
    route_descriptions: MAIN_ROUTE_DESCRIPTIONS,
    dashboard_example: exampleBrand ? buildDashboardExample(exampleBrand) : null,
    copy_inventory: buildCopyInventory(),
    technical_terms_visible,
    build_info: {
      node_env: process.env.NODE_ENV ?? "unknown",
      inspection_flag: isAgentInspectionEnabled(),
    },
  };
}

export async function buildPageSnapshot(path: string) {
  const { brands, data_source } = await fetchBrandsForInspection();
  const parsed = path.match(/^\/brand\/([^/]+)/);
  const slug = parsed ? decodeURIComponent(parsed[1]!) : null;
  const brand = slug ? brands.find((b) => b.slug === slug) ?? null : null;

  const descriptor = describePage(path, brand);
  if (!descriptor) {
    return { ok: false as const, error: "Unknown path", path, data_source };
  }

  return {
    ok: true as const,
    data_source,
    ...descriptor,
    ...(brand && path.replace(/\/+$/, "") === `/brand/${brand.slug}`
      ? { live_dashboard: buildDashboardExample(brand) }
      : {}),
  };
}
