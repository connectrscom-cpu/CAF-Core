import { NextResponse } from "next/server";
import { getHeygenCatalog } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  if (!slug) return NextResponse.json({ error: "Missing brand" }, { status: 400 });

  const data = await getHeygenCatalog(slug).catch(() => null);
  if (!data?.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: data && "error" in data ? data.error : "heygen_catalog_failed",
        message: data && "message" in data ? (data as { message?: string }).message : "Could not load HeyGen catalog",
        avatars: [],
        voices: [],
      },
      { status: data && "error" in data && data.error === "heygen_not_configured" ? 503 : 502 }
    );
  }

  return NextResponse.json({
    ok: true,
    avatars: data.avatars ?? [],
    voices: data.voices ?? [],
  });
}
