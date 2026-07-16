import { NextRequest, NextResponse } from "next/server";
import { getProductBible, saveHeygenDefaults, saveProductBible } from "@/lib/caf-core-client";
import { heygenPoolJsonFromPresenters } from "@/lib/marketer/brand-bible-adapters";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const data = await getProductBible(slug).catch(() => null);
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

  const saved = await saveProductBible(slug, body.bible_json, "Marketer workspace").catch(() => null);
  if (!saved?.ok) {
    return NextResponse.json({ ok: false, error: "save_failed" }, { status: 502 });
  }

  const ugcRaw = body.bible_json.heygen_ugc_presenters;
  if (Array.isArray(ugcRaw) && ugcRaw.length > 0) {
    const poolRows = ugcRaw
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const rec = row as Record<string, unknown>;
        const avatar_id = String(rec.avatar_id ?? "").trim();
        if (!avatar_id) return null;
        return {
          avatarId: avatar_id,
          voiceId: String(rec.voice_id ?? "").trim(),
          label: "",
          avatarName: "",
          voiceName: "",
          previewImageUrl: "",
        };
      })
      .filter(Boolean) as Array<{
      avatarId: string;
      voiceId: string;
      label: string;
      avatarName: string;
      voiceName: string;
      previewImageUrl: string;
    }>;

    if (poolRows.length > 0) {
      await saveHeygenDefaults(slug, {
        product_ugc_avatar_pool_json: heygenPoolJsonFromPresenters(poolRows),
      }).catch(() => null);
    }
  }

  return NextResponse.json({ ok: true, version: saved.version, parsed: saved.parsed });
}
