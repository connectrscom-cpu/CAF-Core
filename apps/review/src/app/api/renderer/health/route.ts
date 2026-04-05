import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const RENDERER_BASE_URL = process.env.RENDERER_BASE_URL || "http://localhost:3333";

export async function GET() {
  try {
    const base = RENDERER_BASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/health`, { cache: "no-store" });
    const data = await res.json().catch(() => ({ ok: false, error: "Invalid JSON" }));
    return NextResponse.json({ base_url: RENDERER_BASE_URL, reachable: res.ok, ...data });
  } catch (e) {
    return NextResponse.json({ base_url: RENDERER_BASE_URL, reachable: false, ok: false, error: e instanceof Error ? e.message : "Failed to reach renderer" }, { status: 502 });
  }
}
