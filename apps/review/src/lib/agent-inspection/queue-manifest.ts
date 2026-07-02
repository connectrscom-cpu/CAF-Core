import {
  getQueueCounts,
  getQueueTab,
  type QueueFilters,
  type ReviewQueueJob,
  type ReviewTab,
} from "@/lib/caf-core-client";
import {
  pickCaptionFromGenerationPayload,
  pickHookFromGenerationPayload,
  pickTitleFromGenerationPayload,
} from "@/lib/generation-display-fields";

const VALID_TABS: ReviewTab[] = ["in_review", "approved", "rejected", "needs_edit"];

export function parseAgentQueueTab(raw: string | null | undefined): ReviewTab {
  const tab = (raw ?? "in_review").trim() as ReviewTab;
  return VALID_TABS.includes(tab) ? tab : "in_review";
}

export type AgentQueueManifestItem = {
  task_id: string;
  project_slug: string;
  run_id: string;
  platform: string;
  flow_type: string;
  flow_label: string;
  flow_detail: string;
  is_mimic_replication: boolean;
  review_status: string;
  decision: string;
  qc_status: string;
  recommended_route: string;
  risk_score: string;
  generated_title: string;
  generated_hook: string;
  generated_caption: string;
  slide_count: number | null;
  preview_url: string;
  task_href: string;
  workbench_href: string;
};

function pickSlideCount(job: ReviewQueueJob): number | null {
  const slim = (job as ReviewQueueJob & { slide_count?: number | null }).slide_count;
  if (typeof slim === "number") return slim;
  const gp = (job.generation_payload ?? {}) as Record<string, unknown>;
  const go = gp.generated_output;
  if (!go || typeof go !== "object" || Array.isArray(go)) return null;
  const out = go as Record<string, unknown>;
  for (const key of ["carousel_slides", "slides"]) {
    const arr = out[key];
    if (Array.isArray(arr)) return arr.length;
  }
  return null;
}

export function mapReviewJobToAgentManifestItem(
  job: ReviewQueueJob,
  projectSlug: string,
  tab: ReviewTab
): AgentQueueManifestItem {
  const gp = (job.generation_payload ?? {}) as Record<string, unknown>;
  const slim = job as ReviewQueueJob & {
    generated_title?: string | null;
    generated_hook?: string | null;
    generated_caption?: string | null;
  };
  const project = ((job as ReviewQueueJob & { project_slug?: string }).project_slug ?? projectSlug).trim() || projectSlug;
  const taskId = job.task_id;
  return {
    task_id: taskId,
    project_slug: project,
    run_id: job.run_id ?? "",
    platform: job.platform ?? "",
    flow_type: job.flow_type ?? "",
    flow_label: job.flow_label ?? job.flow_type ?? "",
    flow_detail: job.flow_detail ?? "",
    is_mimic_replication: Boolean(job.is_mimic_replication),
    review_status: job.status ?? "",
    decision: job.latest_decision ?? "",
    qc_status: job.qc_status ?? "",
    recommended_route: job.recommended_route ?? "",
    risk_score: job.pre_gen_score ?? "",
    generated_title: slim.generated_title?.trim() || pickTitleFromGenerationPayload(gp),
    generated_hook: slim.generated_hook?.trim() || pickHookFromGenerationPayload(gp),
    generated_caption: slim.generated_caption?.trim() || pickCaptionFromGenerationPayload(gp),
    slide_count: pickSlideCount(job),
    preview_url: (job.preview_thumb_url ?? "").trim(),
    task_href: `/t/${encodeURIComponent(taskId)}?project=${encodeURIComponent(project)}`,
    workbench_href: `/admin/workbench?project=${encodeURIComponent(project)}&status=${encodeURIComponent(tab)}`,
  };
}

export async function buildAgentQueueManifest(opts: {
  projectSlug: string;
  tab: ReviewTab;
  page: number;
  limit: number;
}): Promise<{
  ok: true;
  data_source: "live_core_api";
  project_slug: string;
  tab: ReviewTab;
  total: number;
  page: number;
  limit: number;
  tab_counts: Awaited<ReturnType<typeof getQueueCounts>>;
  status_breakdown: Record<string, number>;
  items: AgentQueueManifestItem[];
  next_page: number | null;
  detail_api_hint: string;
}> {
  const page = Math.max(1, opts.page);
  const limit = Math.min(100, Math.max(1, opts.limit));
  const offset = (page - 1) * limit;
  const filters: QueueFilters = {
    limit: String(limit),
    offset: String(offset),
    slim: "1",
  };

  const [tabCounts, queue] = await Promise.all([
    getQueueCounts(opts.projectSlug),
    getQueueTab(opts.projectSlug, opts.tab, filters),
  ]);

  const items = queue.jobs.map((job) => mapReviewJobToAgentManifestItem(job, opts.projectSlug, opts.tab));
  const total = queue.total;
  const hasMore = offset + items.length < total;

  return {
    ok: true,
    data_source: "live_core_api",
    project_slug: opts.projectSlug,
    tab: opts.tab,
    total,
    page,
    limit,
    tab_counts: tabCounts,
    status_breakdown: queue.status_breakdown,
    items,
    next_page: hasMore ? page + 1 : null,
    detail_api_hint: `GET /v1/review-queue/${opts.projectSlug}/task?task_id={task_id} for full generation_payload`,
  };
}
