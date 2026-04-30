import { NextRequest, NextResponse } from "next/server";
import {
  getStrategy, saveStrategy,
  getBrand, saveBrand,
  getProduct, saveProduct,
  getPlatforms, savePlatform,
  getFlowTypes, saveFlowType,
  getProjectRiskRules, saveProjectRiskRule,
  getHeygenConfig, saveHeygenConfig,
  saveHeygenDefaults,
  getSystemConstraints, saveSystemConstraints,
} from "@/lib/caf-core-client";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ section: string }> };

const getters: Record<string, (slug: string) => Promise<unknown>> = {
  strategy: getStrategy,
  brand: getBrand,
  product: getProduct,
  constraints: getSystemConstraints,
  platforms: getPlatforms,
  "flow-types": getFlowTypes,
  "project-risk-rules": getProjectRiskRules,
  "heygen-config": getHeygenConfig,
};

const savers: Record<string, (slug: string, data: Record<string, unknown>) => Promise<unknown>> = {
  strategy: saveStrategy,
  brand: saveBrand,
  product: saveProduct,
  constraints: saveSystemConstraints,
  platforms: savePlatform,
  "flow-types": saveFlowType,
  "project-risk-rules": saveProjectRiskRule,
  "heygen-config": saveHeygenConfig,
  "heygen-defaults": (slug, data) =>
    saveHeygenDefaults(slug, {
      voice_id: typeof data.voice_id === "string" ? data.voice_id : (data.voice_id as string | null | undefined),
      avatar_id: typeof data.avatar_id === "string" ? data.avatar_id : (data.avatar_id as string | null | undefined),
      avatar_pool_json:
        typeof data.avatar_pool_json === "string"
          ? data.avatar_pool_json
          : (data.avatar_pool_json as string | null | undefined),
    }),
};

function resolveProjectSlug(req: NextRequest, bodyProject?: string): string {
  const fromBody = typeof bodyProject === "string" ? bodyProject.trim() : "";
  if (fromBody) return fromBody;
  const q = req.nextUrl.searchParams.get("project")?.trim() ?? "";
  if (q) return q;
  if (!reviewUsesAllProjects()) return PROJECT_SLUG;
  return reviewQueueFallbackSlug();
}

export async function GET(req: NextRequest, ctx: Ctx) {
  const { section } = await ctx.params;
  const getter = getters[section];
  if (!getter) return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  const slug = resolveProjectSlug(req);
  if (!slug) return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });
  const data = await getter(slug);
  if (!data) return NextResponse.json({ error: "Failed to fetch" }, { status: 502 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { section } = await ctx.params;
  const saver = savers[section];
  if (!saver) return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  const body = await req.json();
  const slug = resolveProjectSlug(req, typeof body.project_slug === "string" ? body.project_slug : undefined);
  if (!slug) return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });
  const data = await saver(slug, body);
  if (!data) return NextResponse.json({ error: "Failed to save" }, { status: 502 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { section } = await ctx.params;
  const saver = savers[section];
  if (!saver) return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  const body = await req.json();
  const slug = resolveProjectSlug(req, typeof body.project_slug === "string" ? body.project_slug : undefined);
  if (!slug) return NextResponse.json({ error: "Set PROJECT_SLUG or pass ?project=" }, { status: 400 });
  const data = await saver(slug, body);
  if (!data) return NextResponse.json({ error: "Failed to save" }, { status: 502 });
  return NextResponse.json(data);
}
