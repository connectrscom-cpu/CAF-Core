import { NextRequest, NextResponse } from "next/server";
import { getBrandBible, saveBrandBible } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const data = await getBrandBible(slug).catch(() => null);
  if (!data?.ok) {
    return NextResponse.json({ ok: false, error: "load_failed" }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    parsed: data.parsed,
    version: data.active?.version ?? null,
    brandAssets: data.brand_assets ?? [],
    snapshot: data.snapshot,
  });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const body = (await req.json()) as { bible_json?: Record<string, unknown> };
  if (!body.bible_json || typeof body.bible_json !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_body" }, { status: 400 });
  }

  const saved = await saveBrandBible(slug, body.bible_json, "Marketer workspace").catch(() => null);
  if (!saved?.ok) {
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, version: saved.version, parsed: saved.parsed });
}
