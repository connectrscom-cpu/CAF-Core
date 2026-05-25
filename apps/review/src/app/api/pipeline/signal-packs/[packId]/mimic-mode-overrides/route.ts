import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CAF_CORE_URL = process.env.CAF_CORE_URL || "http://localhost:3210";

/**
 * GET /api/pipeline/signal-packs/[packId]/mimic-mode-overrides
 * Returns the stored mimic_mode_overrides map for this signal pack.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ packId: string }> }
) {
  try {
    const { packId } = await context.params;
    const base = CAF_CORE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/v1/signal-packs/${encodeURIComponent(packId)}/mimic-mode-overrides`, {
      cache: "no-store",
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
