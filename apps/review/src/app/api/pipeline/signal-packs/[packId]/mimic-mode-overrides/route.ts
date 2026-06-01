import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const CAF_CORE_URL = process.env.CAF_CORE_URL || "http://localhost:3210";
const CAF_CORE_TOKEN = process.env.CAF_CORE_TOKEN || "";

/**
 * GET /api/pipeline/signal-packs/[packId]/mimic-mode-overrides
 * Returns the stored mimic_mode_overrides map for this signal pack.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ packId: string }> }
) {
  try {
    const { packId } = await context.params;
    const url = new URL(request.url);
    const project = url.searchParams.get("project")?.trim();
    const base = CAF_CORE_URL.replace(/\/$/, "");
    const headers: Record<string, string> = { Accept: "application/json" };
    if (CAF_CORE_TOKEN) headers["x-caf-core-token"] = CAF_CORE_TOKEN;
    const corePath = project
      ? `/v1/signal-packs/${encodeURIComponent(project)}/${encodeURIComponent(packId)}/mimic-mode-overrides`
      : `/v1/signal-packs/${encodeURIComponent(packId)}/mimic-mode-overrides`;
    const res = await fetch(`${base}${corePath}`, {
      cache: "no-store",
      headers,
    });
    const json = await res.json();
    return NextResponse.json(json, { status: res.status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
