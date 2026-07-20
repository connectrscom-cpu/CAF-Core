import { NextRequest, NextResponse } from "next/server";
import {
  createProject,
  getBrandProfile,
  getQueueCounts,
  getStrategy,
  listInputsEvidenceImports,
  listProjects,
  listPublicationPlacements,
  listSignalPacksForProject,
} from "@/lib/caf-core-client";
import {
  coreAuthFetch,
  fetchAuthMe,
  fetchAuthStatus,
  getSessionTokenFromCookies,
} from "@/lib/account-access";
import { toBrandSummary, toLiteBrandSummary } from "@/lib/marketer/brand-adapters";
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

export async function GET(req: NextRequest) {
  const multi = reviewUsesAllProjects();
  const authStatus = await fetchAuthStatus().catch(() => ({
    auth_enforced: false,
    signup_enabled: true,
  }));
  const me = await fetchAuthMe().catch(() => null);

  if (authStatus.auth_enforced && !me?.user) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const catalog = await listProjects();
  let projects = filterMarketerBrands((catalog?.projects ?? []).filter((p) => p.active));

  // Logged-in users only see brands their account membership allows (Connectrs owner = all Connectrs brands).
  if (me?.user) {
    const allowed = new Set(me.project_slugs ?? []);
    projects = projects.filter((p) => allowed.has(p.slug));
  } else if (authStatus.auth_enforced) {
    projects = [];
  }

  let slugs = projects.map((p) => p.slug);
  if (!multi && PROJECT_SLUG.trim()) {
    slugs = slugs.filter((s) => s === PROJECT_SLUG.trim());
    if (slugs.length === 0 && !authStatus.auth_enforced) slugs = [PROJECT_SLUG.trim()];
  }

  const scoped = projects.filter((p) => slugs.includes(p.slug));
  const lite = req.nextUrl.searchParams.get("lite") === "1";

  const brands = lite
    ? scoped.map((project) => toLiteBrandSummary(project))
    : (
        await Promise.all(scoped.map((project) => summarizeBrand(project.slug, project)))
      ).filter((b): b is BrandSummary => b !== null);

  brands.sort((a, b) => a.displayName.localeCompare(b.displayName));

  return NextResponse.json({
    ok: true,
    multiProject: multi,
    lite,
    brands,
    auth: {
      enforced: authStatus.auth_enforced,
      authenticated: !!me?.user,
      accounts: me?.accounts ?? [],
    },
  });
}

function normalizeSlug(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    slug?: string;
    displayName?: string;
    color?: string;
    enabledContentRoutes?: string[];
    onboardingPack?: string;
    accountSlug?: string;
  };

  const displayName = (body.displayName ?? "").trim();
  const slug = normalizeSlug(body.slug || displayName);
  if (!slug || slug.length < 2) {
    return NextResponse.json(
      { ok: false, error: "invalid_slug", message: "Enter a brand name or slug (at least 2 characters)." },
      { status: 400 }
    );
  }

  const color =
    typeof body.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(body.color) ? body.color : undefined;

  const authStatus = await fetchAuthStatus().catch(() => ({
    auth_enforced: false,
    signup_enabled: true,
  }));
  const me = await fetchAuthMe().catch(() => null);
  if (authStatus.auth_enforced && !me?.user) {
    return NextResponse.json({ ok: false, error: "unauthorized", message: "Sign in to create a brand." }, { status: 401 });
  }

  const adminAccounts = (me?.accounts ?? []).filter((a) => a.role === "owner" || a.role === "admin");
  const accountSlug =
    (body.accountSlug ?? "").trim() ||
    adminAccounts[0]?.slug ||
    "";

  // Prefer account-scoped create so caps + Connectrs ownership stay correct.
  if (accountSlug && me?.user) {
    const token = await getSessionTokenFromCookies();
    const pack = typeof body.onboardingPack === "string" ? body.onboardingPack.trim() : "";
    if (pack.length > 40) {
      return NextResponse.json(
        {
          ok: false,
          error: "pack_via_account_unsupported",
          message: "Import onboarding pack from an unscoped create, or create the brand first then import.",
        },
        { status: 400 }
      );
    }

    const { status, json } = await coreAuthFetch<{
      ok?: boolean;
      error?: string;
      max_projects?: number;
      project?: { slug: string; display_name: string | null; color?: string | null };
    }>(`/v1/accounts/${encodeURIComponent(accountSlug)}/projects`, {
      method: "POST",
      sessionToken: token,
      body: {
        slug,
        display_name: displayName || slug,
        color,
        enabled_content_routes: body.enabledContentRoutes,
        apply_default_content_routes: !body.enabledContentRoutes?.length,
      },
    });

    if (status >= 400 || !json.ok || !json.project) {
      const message =
        json.error === "project_cap_reached"
          ? `Account project limit reached (${json.max_projects ?? "cap"}).`
          : json.error === "forbidden"
            ? "You need owner/admin access on the account to create brands."
            : "Could not create brand under your account.";
      return NextResponse.json({ ok: false, error: json.error ?? "create_failed", message }, { status });
    }

    return NextResponse.json({
      ok: true,
      created: true,
      brand: {
        slug: json.project.slug,
        displayName: json.project.display_name ?? json.project.slug,
        color: json.project.color ?? color ?? null,
      },
    });
  }

  const pack = typeof body.onboardingPack === "string" ? body.onboardingPack.trim() : "";
  if (pack.length > 40) {
    const { importOnboardingPack } = await import("@/lib/caf-core-client");
    const imported = await importOnboardingPack({
      pack,
      slug,
      default_display_name: displayName || slug,
    }).catch((e) => ({ ok: false as const, error: String(e) }));
    if (!imported || !("ok" in imported) || !imported.ok || !imported.project?.slug) {
      return NextResponse.json(
        {
          ok: false,
          error: "import_failed",
          message:
            "Could not import onboarding pack. Check it uses CAF Project Onboarding Pack sections, or create without the pack.",
        },
        { status: 502 }
      );
    }
    if (color) {
      const { updateProject } = await import("@/lib/caf-core-client");
      await updateProject(imported.project.slug, { color }).catch(() => null);
    }
    return NextResponse.json({
      ok: true,
      created: true,
      brand: {
        slug: imported.project.slug,
        displayName: imported.project.display_name ?? imported.project.slug,
        color: color ?? null,
      },
    });
  }

  const result = await createProject(slug, displayName || slug, {
    color,
    enabled_content_routes: body.enabledContentRoutes,
    apply_default_content_routes: !body.enabledContentRoutes?.length,
  }).catch((e) => ({ ok: false as const, error: String(e) }));

  if (!result || !("ok" in result) || !result.ok || !("project" in result)) {
    return NextResponse.json(
      { ok: false, error: "create_failed", message: "Could not create brand. Try a different slug." },
      { status: 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    created: result.created ?? true,
    brand: {
      slug: result.project.slug,
      displayName: result.project.display_name ?? result.project.slug,
      color: result.project.color ?? color ?? null,
    },
  });
}
