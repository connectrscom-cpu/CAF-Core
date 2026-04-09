import { NextResponse } from "next/server";
import { PROJECT_SLUG } from "@/lib/env";
import { getQueueTab } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const jobs = await getQueueTab(PROJECT_SLUG, "approved");
    const items = jobs.map((j) => ({
      task_id: j.task_id,
      run_id: j.run_id,
      platform: j.platform ?? "",
      flow_type: j.flow_type ?? "",
      review_status: j.status ?? "",
      decision: j.latest_decision ?? "",
      recommended_route: j.recommended_route ?? "",
      qc_status: j.qc_status ?? "",
      risk_score: j.pre_gen_score ?? "",
      generated_title: (j.generation_payload?.title ?? j.generation_payload?.generated_title ?? "") as string,
    }));
    return NextResponse.json({ items, total: items.length });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
