import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RENDERER_BASE_URL = process.env.RENDERER_BASE_URL || "http://localhost:3333";

export async function GET(request: NextRequest) {
  try {
    const name = request.nextUrl.searchParams.get("name");
    if (!name) return NextResponse.json({ ok: false, error: "Missing template name" }, { status: 400 });
    const base = RENDERER_BASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/templates/source/${encodeURIComponent(name)}`, { cache: "no-store" });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed to load template source" }, { status: 500 });
  }
}
