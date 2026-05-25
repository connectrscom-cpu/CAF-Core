import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CAF_CORE_URL = process.env.CAF_CORE_URL || "http://localhost:3210";
const CAF_CORE_TOKEN = process.env.CAF_CORE_TOKEN || "";

/**
 * POST /api/pipeline/signal-packs/[packId]/mimic-mode-override
 * Body: { insights_id, mode_override: "carousel_visual" | "template_bg" | null }
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ packId: string }> }
) {
  try {
    const { packId } = await context.params;
    const body = await request.json();
    const base = CAF_CORE_URL.replace(/\/$/, "");
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (CAF_CORE_TOKEN) headers["x-caf-core-token"] = CAF_CORE_TOKEN;
    const res = await fetch(`${base}/v1/signal-packs/${encodeURIComponent(packId)}/mimic-mode-override`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
