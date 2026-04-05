import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RENDERER_BASE_URL = process.env.RENDERER_BASE_URL || "http://localhost:3333";

export async function GET() {
  try {
    const base = RENDERER_BASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/templates`, { cache: "no-store" });
    const data = await res.json().catch(() => ({ ok: false, templates: [] }));
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Failed to fetch templates", templates: [] }, { status: 502 });
  }
}
