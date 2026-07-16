import { NextRequest, NextResponse } from "next/server";
import { getContentRoutes, saveContentRoutes } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });
  const res = await getContentRoutes(slug);
  if (!res?.ok) {
    return NextResponse.json({ ok: false, error: "load_failed" }, { status: 502 });
  }
  return NextResponse.json(res);
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });
  const body = (await req.json()) as { enabled_lane_ids?: string[]; target_idea_count?: number };
  if (!Array.isArray(body.enabled_lane_ids)) {
    return NextResponse.json({ ok: false, error: "enabled_lane_ids required" }, { status: 400 });
  }
  const res = await saveContentRoutes(slug, {
    enabled_lane_ids: body.enabled_lane_ids,
    target_idea_count: body.target_idea_count,
  });
  if (!res?.ok) {
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 502 });
  }
  return NextResponse.json(res);
}
