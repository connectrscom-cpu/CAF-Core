import { NextRequest, NextResponse } from "next/server";
import { PROJECT_SLUG } from "@/lib/env";
import { getJobDetail } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ task_id: string }> }) {
  try {
    const { task_id } = await params;
    const decodedId = decodeURIComponent(task_id);
    const job = await getJobDetail(PROJECT_SLUG, decodedId);
    if (!job) return NextResponse.json({ assets: [] });
    return NextResponse.json({ assets: job.assets ?? [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
