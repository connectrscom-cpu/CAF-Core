import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RENDERER_BASE_URL = process.env.RENDERER_BASE_URL || "http://localhost:3333";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const base = RENDERER_BASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/preview-template`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return NextResponse.json(data, { status: res.status });
    if (!data.ok || !data.result_url) return NextResponse.json({ ok: false, error: "No result_url from renderer" }, { status: 502 });
    const imgUrl = data.result_url.startsWith("http") ? data.result_url : `${base}${data.result_url}`;
    const imgRes = await fetch(imgUrl);
    if (!imgRes.ok) return NextResponse.json({ ok: false, error: "Failed to fetch rendered image" }, { status: 502 });
    const blob = await imgRes.blob();
    return new NextResponse(blob, { headers: { "Content-Type": "image/png" } });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : "Preview failed" }, { status: 500 });
  }
}
