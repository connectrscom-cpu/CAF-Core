import { CAF_CORE_URL, CAF_CORE_TOKEN } from "./env";

function headers(): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (CAF_CORE_TOKEN) h["x-caf-core-token"] = CAF_CORE_TOKEN;
  return h;
}

async function coreGet<T = unknown>(path: string): Promise<T | null> {
  const res = await fetch(`${CAF_CORE_URL}${path}`, {
    headers: headers(),
    next: { revalidate: 5 },
  });
  if (!res.ok) {
    console.error("CAF Core GET error", res.status, await res.text());
    return null;
  }
  return res.json() as Promise<T>;
}

async function corePost<T = unknown>(path: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${CAF_CORE_URL}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("CAF Core POST error", res.status, await res.text());
    return null;
  }
  return res.json() as Promise<T>;
}

// ── Types ────────────────────────────────────────────────────────────────

export type ReviewTab = "in_review" | "approved" | "rejected" | "needs_edit";

export interface ReviewQueueJob {
  id: string;
  task_id: string;
  project_id: string;
  run_id: string;
  candidate_id: string | null;
  flow_type: string | null;
  platform: string | null;
  status: string | null;
  recommended_route: string | null;
  qc_status: string | null;
  pre_gen_score: string | null;
  generation_payload: Record<string, unknown>;
  review_snapshot: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  latest_decision: string | null;
  latest_notes: string | null;
  latest_rejection_tags: unknown[];
  latest_validator: string | null;
  latest_submitted_at: string | null;
}

export interface ReviewQueueCounts {
  in_review: number;
  approved: number;
  rejected: number;
  needs_edit: number;
}

export interface ReviewJobDetail extends ReviewQueueJob {
  assets: Array<{
    id: string;
    asset_type: string | null;
    public_url: string | null;
    position: number;
  }>;
  reviews: Array<{
    id: string;
    decision: string | null;
    notes: string | null;
    rejection_tags: unknown[];
    validator: string | null;
    submitted_at: string | null;
    created_at: string;
  }>;
  auto_validation: {
    format_ok: boolean | null;
    hook_score: string | null;
    clarity_score: string | null;
    overall_score: string | null;
    pass_auto: boolean;
    banned_hits: unknown[];
  } | null;
}

export interface Facets {
  platforms: string[];
  flow_types: string[];
  routes: string[];
  runs: string[];
  statuses: string[];
}

export interface QueueFilters {
  search?: string;
  platform?: string;
  flow_type?: string;
  recommended_route?: string;
  qc_status?: string;
  review_status?: string;
  decision?: string;
  has_preview?: string;
  risk_score_min?: string;
  run_id?: string;
  sort?: string;
  group_by?: string;
}

// ── API Calls ────────────────────────────────────────────────────────────

export async function getQueueCounts(projectSlug: string): Promise<ReviewQueueCounts> {
  const data = await coreGet<{ ok: boolean; counts: ReviewQueueCounts }>(
    `/v1/review-queue/${encodeURIComponent(projectSlug)}/counts`
  );
  return data?.counts ?? { in_review: 0, approved: 0, rejected: 0, needs_edit: 0 };
}

export async function getQueueTab(
  projectSlug: string,
  tab: ReviewTab,
  filters: QueueFilters = {}
): Promise<ReviewQueueJob[]> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val) params.set(key, val);
  }
  const qs = params.toString();
  const path = `/v1/review-queue/${encodeURIComponent(projectSlug)}/${tab}${qs ? `?${qs}` : ""}`;
  const data = await coreGet<{ ok: boolean; jobs: ReviewQueueJob[] }>(path);
  return data?.jobs ?? [];
}

export async function getFacets(projectSlug: string): Promise<Facets> {
  const data = await coreGet<{ ok: boolean; facets: Facets }>(
    `/v1/review-queue/${encodeURIComponent(projectSlug)}/facets`
  );
  return data?.facets ?? { platforms: [], flow_types: [], routes: [], runs: [], statuses: [] };
}

export async function getJobDetail(projectSlug: string, taskId: string): Promise<ReviewJobDetail | null> {
  const data = await coreGet<{ ok: boolean; job: ReviewJobDetail }>(
    `/v1/review-queue/${encodeURIComponent(projectSlug)}/task/${encodeURIComponent(taskId)}`
  );
  return data?.job ?? null;
}

export async function submitDecision(
  projectSlug: string,
  taskId: string,
  body: {
    decision: string;
    notes?: string;
    rejection_tags?: string[];
    validator?: string;
  }
): Promise<boolean> {
  const data = await corePost<{ ok: boolean }>(
    `/v1/review-queue/${encodeURIComponent(projectSlug)}/task/${encodeURIComponent(taskId)}/decide`,
    body
  );
  return data?.ok ?? false;
}
