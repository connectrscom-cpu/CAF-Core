import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RENDERER_BASE_URL = process.env.RENDERER_BASE_URL || "http://localhost:3333";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const base = RENDERER_BASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/render-carousel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string; slides?: Array<{ slide_index: number; result_url: string }> };
    if (!res.ok) return NextResponse.json({ ok: false, error: data.error || "Renderer error" }, { status: res.status });
    if (!data.ok || !Array.isArray(data.slides) || data.slides.length === 0) return NextResponse.json({ ok: false, error: "No slides from renderer" }, { status: 502 });
    const urls = data.slides.map((s) => s.result_url.startsWith("http") ? s.result_url : `${base}${s.result_url}`);
    return NextResponse.json({ ok: true, urls });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Preview failed" }, { status: 500 });
  }
}
