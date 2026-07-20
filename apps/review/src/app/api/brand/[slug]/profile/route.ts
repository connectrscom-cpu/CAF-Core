import { brandAccessDeniedResponse } from "@/lib/brand-access-guard";
import { NextRequest, NextResponse } from "next/server";
import {
  getBrand,
  getBrandProfile,
  getPlatforms,
  getProduct,
  getStrategy,
  listProjects,
  saveBrand,
  saveBrandProfile,
  saveProduct,
  saveStrategy,
} from "@/lib/caf-core-client";
import { fromBrandProfileEdit, toBrandProfile } from "@/lib/marketer/profile-adapters";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

async function resolveDisplayName(slug: string): Promise<string> {
  const catalog = await listProjects().catch(() => null);
  const project = catalog?.projects?.find((p) => p.slug === slug);
  return (project?.display_name ?? "").trim() || slug;
}

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  {
    const denied = await brandAccessDeniedResponse(slug);
    if (denied) return denied;
  }

  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const [strategy, brand, product, platforms, brandProfile, displayName] = await Promise.all([
    getStrategy(slug).catch(() => null),
    getBrand(slug).catch(() => null),
    getProduct(slug).catch(() => null),
    getPlatforms(slug).catch(() => null),
    getBrandProfile(slug).catch(() => null),
    resolveDisplayName(slug),
  ]);

  const profile = toBrandProfile({
    slug,
    displayName,
    strategy: (strategy as { strategy?: Record<string, unknown> } | null)?.strategy ?? null,
    brand: (brand as { brand?: Record<string, unknown> } | null)?.brand ?? null,
    product: (product as { product?: Record<string, unknown> } | null)?.product ?? null,
    platforms:
      (platforms as { platforms?: Array<Record<string, unknown>> } | null)?.platforms ?? null,
    brandProfileParsed: brandProfile?.parsed ?? null,
  });

  return NextResponse.json({ ok: true, profile });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  {
    const denied = await brandAccessDeniedResponse(slug);
    if (denied) return denied;
  }

  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const body = (await req.json()) as Record<string, string | string[] | undefined>;

  const platformFocus = Array.isArray(body.platformFocus)
    ? body.platformFocus.map(String).filter(Boolean)
    : [];

  const payloads = fromBrandProfileEdit({
    description: String(body.description ?? ""),
    voice: String(body.voice ?? ""),
    audience: String(body.audience ?? ""),
    contentGoals: String(body.contentGoals ?? ""),
    positioning: String(body.positioning ?? ""),
    bannedWords: String(body.bannedWords ?? ""),
    competitors: String(body.competitors ?? ""),
    productName: String(body.productName ?? ""),
    productUrl: String(body.productUrl ?? ""),
    instagramHandle: String(body.instagramHandle ?? ""),
    visualStyle: String(body.visualStyle ?? ""),
    colors: String(body.colors ?? ""),
    domainMetaphors: String(body.domainMetaphors ?? ""),
    allowedMotifs: String(body.allowedMotifs ?? ""),
    forbiddenMotifs: String(body.forbiddenMotifs ?? ""),
    platformFocus,
  });

  const [existingStrategy, existingBrand, existingProduct, existingBp] = await Promise.all([
    getStrategy(slug).catch(() => null),
    getBrand(slug).catch(() => null),
    getProduct(slug).catch(() => null),
    getBrandProfile(slug).catch(() => null),
  ]);

  const mergedStrategy = {
    ...((existingStrategy as { strategy?: Record<string, unknown> } | null)?.strategy ?? {}),
    ...payloads.strategy,
  };
  const mergedBrand = {
    ...((existingBrand as { brand?: Record<string, unknown> } | null)?.brand ?? {}),
    ...payloads.brand,
  };
  const mergedProduct = {
    ...((existingProduct as { product?: Record<string, unknown> } | null)?.product ?? {}),
    ...payloads.product,
  };
  const mergedBp = {
    ...(existingBp?.parsed ?? {}),
    ...payloads.brandProfileV1,
  };

  const results = await Promise.all([
    saveStrategy(slug, mergedStrategy).catch((e) => ({ error: String(e) })),
    saveBrand(slug, mergedBrand).catch((e) => ({ error: String(e) })),
    saveProduct(slug, mergedProduct).catch((e) => ({ error: String(e) })),
    saveBrandProfile(slug, mergedBp).catch((e) => ({ error: String(e) })),
  ]);

  if (results.some((r) => r && "error" in r)) {
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
