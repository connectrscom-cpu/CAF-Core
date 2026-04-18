import { NextResponse } from "next/server";
import { PROJECT_SLUG, reviewQueueFallbackSlug, reviewUsesAllProjects } from "@/lib/env";
import { getQueueTab, getQueueTabAll } from "@/lib/caf-core-client";
import {
  pickCaptionFromGenerationPayload,
  pickHookFromGenerationPayload,
  pickTitleFromGenerationPayload,
} from "@/lib/generation-display-fields";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const { jobs, total } = reviewUsesAllProjects()
      ? await getQueueTabAll("approved", { limit: "500", offset: "0" })
      : await getQueueTab(PROJECT_SLUG, "approved", { limit: "500", offset: "0" });
    const items = jobs.map((j) => {
      const gp = (j.generation_payload ?? {}) as Record<string, unknown>;
      return {
        task_id: j.task_id,
        project: (j.project_slug ?? PROJECT_SLUG ?? reviewQueueFallbackSlug()).trim(),
        run_id: j.run_id,
        platform: j.platform ?? "",
        flow_type: j.flow_type ?? "",
        review_status: j.status ?? "",
        decision: j.latest_decision ?? "",
        recommended_route: j.recommended_route ?? "",
        qc_status: j.qc_status ?? "",
        risk_score: j.pre_gen_score ?? "",
        generated_title: pickTitleFromGenerationPayload(gp),
        generated_hook: pickHookFromGenerationPayload(gp),
        generated_caption: pickCaptionFromGenerationPayload(gp),
        preview_url: (j.preview_thumb_url ?? "").trim(),
      };
    });
    return NextResponse.json({
      items,
      total,
      scope: reviewUsesAllProjects() ? "all" : "single",
    });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
