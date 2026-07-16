import { NextRequest, NextResponse } from "next/server";
import { getRunDetail, listAdminJobsForRun } from "@/lib/caf-core-client";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ slug: string; runId: string }> };

/** Poll content jobs for a run (marketer cart progress). */
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { slug, runId } = await ctx.params;
  if (!slug || !runId) {
    return NextResponse.json({ error: "Missing brand or run" }, { status: 400 });
  }

  const [adminJobs, runDetail] = await Promise.all([
    listAdminJobsForRun(slug, runId, { limit: 100 }).catch(() => null),
    getRunDetail(slug, runId).catch(() => null),
  ]);

  const jobs = (adminJobs?.rows ?? []).map((row) => ({
    task_id: String(row.task_id ?? ""),
    status: String(row.status ?? "UNKNOWN"),
    flow_type: row.flow_type != null ? String(row.flow_type) : null,
    platform: row.platform != null ? String(row.platform) : null,
    title: row.flow_label != null ? String(row.flow_label) : null,
  })).filter((j) => j.task_id);

  const byStatus: Record<string, number> = {};
  for (const j of jobs) {
    byStatus[j.status] = (byStatus[j.status] ?? 0) + 1;
  }

  const run = runDetail?.run;
  return NextResponse.json({
    ok: true,
    run_id: runId,
    run_status: run?.status ?? null,
    total_jobs: run?.total_jobs ?? jobs.length,
    jobs_completed: run?.jobs_completed ?? null,
    jobs,
    by_status: byStatus,
    total: adminJobs?.total ?? jobs.length,
  });
}
