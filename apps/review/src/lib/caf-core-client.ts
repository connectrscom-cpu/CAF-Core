import { CAF_CORE_URL, CAF_CORE_TOKEN, reviewQueueFallbackSlug } from "./env";

function isMissingReviewQueueAllRoute(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.includes("404") && msg.includes("/v1/review-queue-all/");
}

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

/** Same as coreGet but throws so API routes can surface misconfiguration (e.g. localhost CAF_CORE_URL on Vercel). */
async function coreGetRequired<T>(path: string): Promise<T> {
  const base = CAF_CORE_URL.replace(/\/$/, "");
  const url = `${base}${path}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: headers(), next: { revalidate: 5 } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const localhostHint =
      /localhost|127\.0\.0\.1/i.test(base) && process.env.VERCEL === "1"
        ? " Set CAF_CORE_URL in Vercel → Settings → Environment Variables to your public Core URL (e.g. https://caf-core.fly.dev), not localhost."
        : /localhost|127\.0\.0\.1/i.test(base)
          ? " This server cannot reach Core on localhost; set CAF_CORE_URL to a URL reachable from here."
          : "";
    throw new Error(`Cannot reach CAF Core (${url}): ${msg}.${localhostHint}`);
  }
  if (!res.ok) {
    const body = await res.text();
    const authHint =
      res.status === 401
        ? " Set CAF_CORE_TOKEN to match Core's CAF_CORE_API_TOKEN, or disable CAF_CORE_REQUIRE_AUTH on Core."
        : "";
    throw new Error(`CAF Core HTTP ${res.status} for ${path}: ${body.slice(0, 400)}${authHint}`);
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

async function corePut<T = unknown>(path: string, body: unknown): Promise<T | null> {
  const res = await fetch(`${CAF_CORE_URL}${path}`, {
    method: "PUT",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error("CAF Core PUT error", res.status, await res.text());
    return null;
  }
  return res.json() as Promise<T>;
}

async function coreDelete<T = unknown>(path: string): Promise<T | null> {
  const res = await fetch(`${CAF_CORE_URL}${path}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!res.ok) {
    console.error("CAF Core DELETE error", res.status, await res.text());
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
  /** Present on `/v1/review-queue-all/...` responses. */
  project_slug?: string;
  project_display_name?: string | null;
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
  projects?: string[];
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
  /** Tenant filter when using the cross-project queue API. */
  project_slug?: string;
  sort?: string;
  group_by?: string;
  /** Server-side pagination (CAF Core `/v1/review-queue/...` supports up to 500). */
  limit?: string;
  offset?: string;
}

// ── API Calls ────────────────────────────────────────────────────────────

export async function getQueueCounts(projectSlug: string): Promise<ReviewQueueCounts> {
  const data = await coreGetRequired<{ ok: boolean; counts: ReviewQueueCounts }>(
    `/v1/review-queue/${encodeURIComponent(projectSlug)}/counts`
  );
  return data.counts ?? { in_review: 0, approved: 0, rejected: 0, needs_edit: 0 };
}

/** Tab counts aggregated over all active projects. */
export async function getQueueCountsAll(): Promise<ReviewQueueCounts> {
  try {
    const data = await coreGetRequired<{ ok: boolean; counts: ReviewQueueCounts }>(
      `/v1/review-queue-all/counts`
    );
    return data.counts ?? { in_review: 0, approved: 0, rejected: 0, needs_edit: 0 };
  } catch (e) {
    if (!isMissingReviewQueueAllRoute(e)) throw e;
    return getQueueCounts(reviewQueueFallbackSlug());
  }
}

export async function getQueueTab(
  projectSlug: string,
  tab: ReviewTab,
  filters: QueueFilters = {}
): Promise<{ jobs: ReviewQueueJob[]; total: number; status_breakdown: Record<string, number> }> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val) params.set(key, val);
  }
  const qs = params.toString();
  const path = `/v1/review-queue/${encodeURIComponent(projectSlug)}/${tab}${qs ? `?${qs}` : ""}`;
  const data = await coreGetRequired<{
    ok: boolean;
    jobs: ReviewQueueJob[];
    total?: number;
    status_breakdown?: Record<string, number>;
  }>(path);
  const jobs = data.jobs ?? [];
  return {
    jobs,
    total: typeof data.total === "number" ? data.total : jobs.length,
    status_breakdown: data.status_breakdown ?? {},
  };
}

/** Cross-project queue (active projects only); same filter/pagination shape as `getQueueTab`. */
export async function getQueueTabAll(
  tab: ReviewTab,
  filters: QueueFilters = {}
): Promise<{ jobs: ReviewQueueJob[]; total: number; status_breakdown: Record<string, number> }> {
  const params = new URLSearchParams();
  for (const [key, val] of Object.entries(filters)) {
    if (val) params.set(key, val);
  }
  const qs = params.toString();
  const path = `/v1/review-queue-all/${tab}${qs ? `?${qs}` : ""}`;
  try {
    const data = await coreGetRequired<{
      ok: boolean;
      jobs: ReviewQueueJob[];
      total?: number;
      status_breakdown?: Record<string, number>;
    }>(path);
    const jobs = data.jobs ?? [];
    return {
      jobs,
      total: typeof data.total === "number" ? data.total : jobs.length,
      status_breakdown: data.status_breakdown ?? {},
    };
  } catch (e) {
    if (!isMissingReviewQueueAllRoute(e)) throw e;
    return getQueueTab(reviewQueueFallbackSlug(), tab, filters);
  }
}

export async function getFacets(projectSlug: string): Promise<Facets> {
  const data = await coreGetRequired<{ ok: boolean; facets: Facets }>(
    `/v1/review-queue/${encodeURIComponent(projectSlug)}/facets`
  );
  return data.facets ?? { platforms: [], flow_types: [], routes: [], runs: [], statuses: [] };
}

export async function getFacetsAll(): Promise<Facets> {
  try {
    const data = await coreGetRequired<{ ok: boolean; facets: Facets }>(`/v1/review-queue-all/facets`);
    const f = data.facets;
    return {
      projects: f?.projects ?? [],
      platforms: f?.platforms ?? [],
      flow_types: f?.flow_types ?? [],
      routes: f?.routes ?? [],
      runs: f?.runs ?? [],
      statuses: f?.statuses ?? [],
    };
  } catch (e) {
    if (!isMissingReviewQueueAllRoute(e)) throw e;
    return getFacets(reviewQueueFallbackSlug());
  }
}

export async function getJobDetail(projectSlug: string, taskId: string): Promise<ReviewJobDetail | null> {
  const data = await coreGet<{ ok: boolean; job: ReviewJobDetail }>(
    `/v1/review-queue/${encodeURIComponent(projectSlug)}/task/${encodeURIComponent(taskId)}`
  );
  return data?.job ?? null;
}

/** Resolve a task across active projects; pass `projectSlug` when the id is ambiguous. */
export async function getJobDetailAll(
  taskId: string,
  projectSlug?: string
): Promise<ReviewJobDetail | null> {
  const qs = projectSlug ? `?project_slug=${encodeURIComponent(projectSlug)}` : "";
  const path = `/v1/review-queue-all/task/${encodeURIComponent(taskId)}${qs}`;
  const base = CAF_CORE_URL.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, { headers: headers(), next: { revalidate: 5 } });
  if (res.ok) {
    const data = (await res.json()) as { ok?: boolean; job?: ReviewJobDetail };
    return data?.job ?? null;
  }
  if (res.status === 404) {
    const slug = projectSlug || reviewQueueFallbackSlug();
    return getJobDetail(slug, taskId);
  }
  console.error("CAF Core GET error", res.status, await res.text());
  return null;
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

// ── Project Config ──────────────────────────────────────────────────────

export async function getProjectProfile(projectSlug: string) {
  return coreGet<{ ok: boolean; project: { id: string; slug: string; display_name: string }; strategy: unknown; brand: unknown; platforms: unknown[]; risk_rules: unknown[]; flow_types: unknown[]; reference_posts: unknown[]; heygen_config: unknown[] }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/profile`
  );
}

export async function getStrategy(projectSlug: string) {
  return coreGet<{ ok: boolean; strategy: Record<string, unknown> | null }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/strategy`
  );
}

export async function saveStrategy(projectSlug: string, data: Record<string, unknown>) {
  return corePut<{ ok: boolean; strategy: Record<string, unknown> }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/strategy`, data
  );
}

export async function getBrand(projectSlug: string) {
  return coreGet<{ ok: boolean; brand: Record<string, unknown> | null }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/brand`
  );
}

export async function saveBrand(projectSlug: string, data: Record<string, unknown>) {
  return corePut<{ ok: boolean; brand: Record<string, unknown> }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/brand`, data
  );
}

export async function getSystemConstraints(projectSlug: string) {
  return coreGet<{ ok: boolean; constraints: Record<string, unknown> | null }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/constraints`
  );
}

export async function saveSystemConstraints(projectSlug: string, data: Record<string, unknown>) {
  return corePut<{ ok: boolean; constraints: Record<string, unknown> }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/constraints`, data
  );
}

export async function getPlatforms(projectSlug: string) {
  return coreGet<{ ok: boolean; platforms: Record<string, unknown>[] }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/platforms`
  );
}

export async function savePlatform(projectSlug: string, data: Record<string, unknown>) {
  return corePut<{ ok: boolean; platform: Record<string, unknown> }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/platforms`, data
  );
}

export async function getFlowTypes(projectSlug: string) {
  return coreGet<{ ok: boolean; flow_types: Record<string, unknown>[] }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/flow-types`
  );
}

export async function saveFlowType(projectSlug: string, data: Record<string, unknown>) {
  return corePut<{ ok: boolean; flow_type: Record<string, unknown> }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/flow-types`, data
  );
}

export async function getRiskRules(projectSlug: string) {
  return coreGet<{ ok: boolean; risk_rules: Record<string, unknown>[] }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/risk-rules`
  );
}

export async function saveRiskRule(projectSlug: string, data: Record<string, unknown>) {
  return corePost<{ ok: boolean; risk_rule: Record<string, unknown> }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/risk-rules`, data
  );
}

export async function getHeygenConfig(projectSlug: string) {
  return coreGet<{ ok: boolean; heygen_config: Record<string, unknown>[] }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/heygen-config`
  );
}

export async function saveHeygenConfig(projectSlug: string, data: Record<string, unknown>) {
  return corePut<{ ok: boolean; heygen_config: Record<string, unknown> }>(
    `/v1/projects/${encodeURIComponent(projectSlug)}/heygen-config`, data
  );
}

// ── Flow Engine (CAF-level) ──────────────────────────────────────────────

export async function getFlowEngine() {
  return coreGet<{
    flows: Record<string, unknown>[];
    prompts: Record<string, unknown>[];
    schemas: Record<string, unknown>[];
    carousels: Record<string, unknown>[];
    qc_checks: Record<string, unknown>[];
    risk_policies: Record<string, unknown>[];
  }>("/v1/flow-engine");
}

export async function getFlowDefinitions() {
  return coreGet<Record<string, unknown>[]>("/v1/flow-engine/flows");
}

export async function saveFlowDefinition(flowType: string, data: Record<string, unknown>) {
  return corePut<Record<string, unknown>>(`/v1/flow-engine/flows/${encodeURIComponent(flowType)}`, data);
}

export async function deleteFlowDefinition(flowType: string) {
  return coreDelete<{ ok: boolean }>(`/v1/flow-engine/flows/${encodeURIComponent(flowType)}`);
}

export async function getPromptTemplates(flowType?: string) {
  const qs = flowType ? `?flow_type=${encodeURIComponent(flowType)}` : "";
  return coreGet<Record<string, unknown>[]>(`/v1/flow-engine/prompts${qs}`);
}

export async function savePromptTemplate(data: Record<string, unknown>) {
  return corePut<Record<string, unknown>>("/v1/flow-engine/prompts", data);
}

export async function getQcChecks(flowType?: string) {
  const qs = flowType ? `?flow_type=${encodeURIComponent(flowType)}` : "";
  return coreGet<Record<string, unknown>[]>(`/v1/flow-engine/qc-checks${qs}`);
}

export async function getRiskPolicies() {
  return coreGet<Record<string, unknown>[]>("/v1/flow-engine/risk-policies");
}

export async function getCarouselTemplates() {
  return coreGet<Record<string, unknown>[]>("/v1/flow-engine/carousel-templates");
}

// ── Learning ────────────────────────────────────────────────────────────

export async function getLearningRules(projectSlug: string) {
  return coreGet<{ ok: boolean; rules: Record<string, unknown>[] }>(
    `/v1/learning/${encodeURIComponent(projectSlug)}/rules`
  );
}

export async function triggerEditorialAnalysis(projectSlug: string, windowDays?: number) {
  return corePost<Record<string, unknown>>(
    `/v1/learning/${encodeURIComponent(projectSlug)}/editorial-analysis`,
    { window_days: windowDays ?? 30 }
  );
}

export async function triggerMarketAnalysis(projectSlug: string, windowDays?: number) {
  return corePost<Record<string, unknown>>(
    `/v1/learning/${encodeURIComponent(projectSlug)}/market-analysis`,
    { window_days: windowDays ?? 60 }
  );
}

/** Multipart CSV upload — pass FormData with fields: `file` (required), `mapping` (optional JSON string), `window` (optional: early|stabilized). */
export async function uploadPerformanceCsv(projectSlug: string, formData: FormData) {
  const headers: Record<string, string> = {};
  if (CAF_CORE_TOKEN) headers["x-caf-core-token"] = CAF_CORE_TOKEN;
  const res = await fetch(
    `${CAF_CORE_URL}/v1/learning/${encodeURIComponent(projectSlug)}/performance/csv`,
    { method: "POST", headers, body: formData }
  );
  if (!res.ok) {
    console.error("CAF Core CSV upload error", res.status, await res.text());
    return null;
  }
  return res.json() as Promise<Record<string, unknown>>;
}

export async function applyLearningRule(projectSlug: string, ruleId: string) {
  return corePost<{ ok: boolean }>(
    `/v1/learning/${encodeURIComponent(projectSlug)}/rules/${encodeURIComponent(ruleId)}/apply`,
    {}
  );
}

export async function retireLearningRule(projectSlug: string, ruleId: string) {
  return corePost<{ ok: boolean }>(
    `/v1/learning/${encodeURIComponent(projectSlug)}/rules/${encodeURIComponent(ruleId)}/retire`,
    {}
  );
}

export async function getLearningContextPreview(projectSlug: string, flowType?: string, platform?: string) {
  const qs = new URLSearchParams();
  if (flowType) qs.set("flow_type", flowType);
  if (platform) qs.set("platform", platform);
  const q = qs.toString();
  return coreGet<Record<string, unknown>>(
    `/v1/learning/${encodeURIComponent(projectSlug)}/context-preview${q ? `?${q}` : ""}`
  );
}

export async function getLearningObservations(projectSlug: string, limit?: number) {
  const qs = limit ? `?limit=${limit}` : "";
  return coreGet<{ ok: boolean; observations: Record<string, unknown>[] }>(
    `/v1/learning/${encodeURIComponent(projectSlug)}/observations${qs}`
  );
}

export async function getLearningTransparency(projectSlug: string) {
  return coreGet<Record<string, unknown>>(
    `/v1/learning/${encodeURIComponent(projectSlug)}/transparency`
  );
}

/** LLM multimodal review of human-approved jobs only. Requires OPENAI_API_KEY on Core. */
export async function triggerLlmApprovalReview(
  projectSlug: string,
  body: {
    limit?: number;
    task_ids?: string[];
    skip_if_reviewed_within_days?: number;
    force_rereview?: boolean;
    /** e.g. 0.55 — scores below this mint a pending GENERATION_GUIDANCE rule from improvement bullets */
    mint_pending_hints_below_score?: number | null;
  }
) {
  return corePost<Record<string, unknown>>(
    `/v1/learning/${encodeURIComponent(projectSlug)}/llm-review-approved`,
    body
  );
}

export async function getLlmApprovalReviews(projectSlug: string, limit?: number) {
  const qs = limit != null ? `?limit=${limit}` : "";
  return coreGet<{ ok: boolean; reviews: Record<string, unknown>[] }>(
    `/v1/learning/${encodeURIComponent(projectSlug)}/llm-approval-reviews${qs}`
  );
}
