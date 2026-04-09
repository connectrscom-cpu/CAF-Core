import { NextRequest, NextResponse } from "next/server";
import {
  getStrategy, saveStrategy,
  getBrand, saveBrand,
  getPlatforms, savePlatform,
  getFlowTypes, saveFlowType,
  getRiskRules, saveRiskRule,
  getHeygenConfig, saveHeygenConfig,
  getSystemConstraints, saveSystemConstraints,
} from "@/lib/caf-core-client";
import { PROJECT_SLUG } from "@/lib/env";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ section: string }> };

const getters: Record<string, (slug: string) => Promise<unknown>> = {
  strategy: getStrategy,
  brand: getBrand,
  constraints: getSystemConstraints,
  platforms: getPlatforms,
  "flow-types": getFlowTypes,
  "risk-rules": getRiskRules,
  "heygen-config": getHeygenConfig,
};

const savers: Record<string, (slug: string, data: Record<string, unknown>) => Promise<unknown>> = {
  strategy: saveStrategy,
  brand: saveBrand,
  constraints: saveSystemConstraints,
  platforms: savePlatform,
  "flow-types": saveFlowType,
  "risk-rules": saveRiskRule,
  "heygen-config": saveHeygenConfig,
};

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { section } = await ctx.params;
  const getter = getters[section];
  if (!getter) return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  const data = await getter(PROJECT_SLUG);
  if (!data) return NextResponse.json({ error: "Failed to fetch" }, { status: 502 });
  return NextResponse.json(data);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { section } = await ctx.params;
  const saver = savers[section];
  if (!saver) return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  const body = await req.json();
  const data = await saver(PROJECT_SLUG, body);
  if (!data) return NextResponse.json({ error: "Failed to save" }, { status: 502 });
  return NextResponse.json(data);
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { section } = await ctx.params;
  const saver = savers[section];
  if (!saver) return NextResponse.json({ error: "Unknown section" }, { status: 400 });
  const body = await req.json();
  const data = await saver(PROJECT_SLUG, body);
  if (!data) return NextResponse.json({ error: "Failed to save" }, { status: 502 });
  return NextResponse.json(data);
}
