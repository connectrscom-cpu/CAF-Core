import type { FastifyInstance } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { decideGenerationPlan, generationPlanRequestSchema } from "../decision_engine/index.js";
import { ensureProject, upsertConstraints, getConstraints, mergeConstraintUpdate } from "../repositories/core.js";
import { upsertContentJob, getContentJobByTaskId } from "../repositories/jobs.js";
import { insertLearningRule, applyLearningRule, listLearningRules } from "../repositories/learning.js";
import { insertJobStateTransition } from "../repositories/transitions.js";
import {
  insertDiagnosticAudit,
  insertEditorialReview,
  insertPerformanceMetric,
  insertAutoValidation,
  insertSuppressionRule,
  insertPromptVersion,
} from "../repositories/ops.js";
import {
  listReviewQueue,
  countReviewQueue,
  countReviewQueueFiltered,
  reviewQueueStatusBreakdown,
  listReviewQueueAllProjects,
  countReviewQueueAllProjects,
  countReviewQueueAllProjectsFiltered,
  reviewQueueStatusBreakdownAllProjects,
  getReviewJobDetail,
  getDistinctValues,
  getDistinctValuesAllProjects,
  resolveTaskToProject,
  type ReviewQueueFilters,
} from "../repositories/review-queue.js";
import { buildCarouselPublishUrls, mergePublishUrlsIntoJob } from "../services/validation-router.js";
import { computeAutoValidationScores } from "../services/autoValidation.js";
import { probeRenderingDeps } from "../services/rendering-deps-probe.js";
import { z } from "zod";

export function registerV1Routes(app: FastifyInstance, deps: { db: Pool; config: AppConfig }) {
  const { db, config } = deps;

  app.get("/", async () => ({
    ok: true,
    service: "caf-core",
    version: config.DECISION_ENGINE_VERSION,
    docs: "/health, /health/rendering (carousel/video deps), /v1/* for API",
  }));

  app.get("/health", async () => ({
    ok: true,
    service: "caf-core",
    engine_version: config.DECISION_ENGINE_VERSION,
  }));

  /** Shows RENDERER_BASE_URL / VIDEO_ASSEMBLY_BASE_URL for this process and probes each upstream GET /health. */
  app.get("/health/rendering", async () => {
    const rendering = await probeRenderingDeps(config);
    return {
      ok: true,
      service: "caf-core",
      engine_version: config.DECISION_ENGINE_VERSION,
      rendering,
    };
  });

  app.post("/v1/decisions/plan", async (request, reply) => {
    const parsed = generationPlanRequestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const result = await decideGenerationPlan(db, config, parsed.data);
    return { ok: true, result };
  });

  const ingestJobSchema = z.object({
    project_slug: z.string(),
    task_id: z.string(),
    run_id: z.string(),
    candidate_id: z.string().optional(),
    variation_name: z.string().optional(),
    flow_type: z.string().optional(),
    platform: z.string().optional(),
    origin_platform: z.string().optional(),
    target_platform: z.string().optional(),
    status: z.string().optional(),
    recommended_route: z.string().optional(),
    qc_status: z.string().optional(),
    pre_gen_score: z.number().optional(),
    generation_payload: z.record(z.unknown()).optional(),
  });

  app.post("/v1/jobs/ingest", async (request, reply) => {
    const parsed = ingestJobSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const body = parsed.data;
    const project = await ensureProject(db, body.project_slug);
    const row = await upsertContentJob(db, {
      task_id: body.task_id,
      project_id: project.id,
      run_id: body.run_id,
      candidate_id: body.candidate_id ?? null,
      variation_name: body.variation_name ?? null,
      flow_type: body.flow_type ?? null,
      platform: body.platform ?? null,
      origin_platform: body.origin_platform ?? null,
      target_platform: body.target_platform ?? null,
      status: body.status ?? null,
      recommended_route: body.recommended_route ?? null,
      qc_status: body.qc_status ?? null,
      pre_gen_score: body.pre_gen_score ?? null,
      generation_payload: body.generation_payload ?? {},
    });
    return { ok: true, id: row.id };
  });

  app.get("/v1/jobs/:project_slug/:task_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), task_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const job = await getContentJobByTaskId(db, project.id, params.data.task_id);
    if (!job) return reply.code(404).send({ ok: false, error: "not_found" });
    return { ok: true, job };
  });

  const learningRuleSchema = z.object({
    project_slug: z.string(),
    rule_id: z.string(),
    trigger_type: z.string(),
    scope_flow_type: z.string().optional(),
    scope_platform: z.string().optional(),
    action_type: z.string(),
    action_payload: z.record(z.unknown()),
    confidence: z.number().optional(),
    source_entity_ids: z.array(z.string()).optional(),
    scope_type: z.enum(["project", "global"]).optional(),
    rule_family: z.string().optional(),
    evidence_refs: z.array(z.unknown()).optional(),
    hypothesis_id: z.string().optional(),
    expires_at: z.string().optional(),
    valid_from: z.string().optional(),
    valid_to: z.string().optional(),
    provenance: z.string().optional(),
    created_by: z.string().optional(),
  });

  app.post("/v1/learning/rules", async (request, reply) => {
    const parsed = learningRuleSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await ensureProject(db, parsed.data.project_slug);
    await insertLearningRule(db, {
      rule_id: parsed.data.rule_id,
      project_id: project.id,
      trigger_type: parsed.data.trigger_type,
      scope_flow_type: parsed.data.scope_flow_type ?? null,
      scope_platform: parsed.data.scope_platform ?? null,
      action_type: parsed.data.action_type,
      action_payload: parsed.data.action_payload,
      confidence: parsed.data.confidence ?? null,
      source_entity_ids: parsed.data.source_entity_ids ?? [],
      scope_type: parsed.data.scope_type,
      rule_family: parsed.data.rule_family,
      evidence_refs: parsed.data.evidence_refs,
      hypothesis_id: parsed.data.hypothesis_id ?? null,
      expires_at: parsed.data.expires_at ?? null,
      valid_from: parsed.data.valid_from ?? null,
      valid_to: parsed.data.valid_to ?? null,
      provenance: parsed.data.provenance ?? null,
      created_by: parsed.data.created_by ?? null,
    });
    return { ok: true };
  });

  app.post("/v1/learning/rules/:project_slug/:rule_id/apply", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), rule_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const ok = await applyLearningRule(db, project.id, params.data.rule_id);
    return { ok, applied: ok };
  });

  app.get("/v1/learning/rules/:project_slug", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const rules = await listLearningRules(db, project.id);
    return { ok: true, rules };
  });

  const transitionSchema = z.object({
    project_slug: z.string(),
    task_id: z.string(),
    from_state: z.string().nullable(),
    to_state: z.string(),
    triggered_by: z.enum(["system", "human", "rule", "experiment"]),
    rule_id: z.string().optional(),
    actor: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  app.post("/v1/transitions", async (request, reply) => {
    const parsed = transitionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await ensureProject(db, parsed.data.project_slug);
    await insertJobStateTransition(db, {
      task_id: parsed.data.task_id,
      project_id: project.id,
      from_state: parsed.data.from_state,
      to_state: parsed.data.to_state,
      triggered_by: parsed.data.triggered_by,
      rule_id: parsed.data.rule_id ?? null,
      actor: parsed.data.actor ?? null,
      metadata: parsed.data.metadata ?? {},
    });
    return { ok: true };
  });

  const auditSchema = z.object({
    project_slug: z.string(),
    task_id: z.string(),
    audit_type: z.string().optional(),
    failure_types: z.array(z.unknown()).optional(),
    strengths: z.array(z.unknown()).optional(),
    risk_findings: z.array(z.unknown()).optional(),
    improvement_suggestions: z.array(z.unknown()).optional(),
    audit_score: z.number().optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  app.post("/v1/audits", async (request, reply) => {
    const parsed = auditSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await ensureProject(db, parsed.data.project_slug);
    const auditId = await insertDiagnosticAudit(db, {
      task_id: parsed.data.task_id,
      project_id: project.id,
      audit_type: parsed.data.audit_type ?? null,
      failure_types: parsed.data.failure_types ?? [],
      strengths: parsed.data.strengths ?? [],
      risk_findings: parsed.data.risk_findings ?? [],
      improvement_suggestions: parsed.data.improvement_suggestions ?? [],
      audit_score: parsed.data.audit_score ?? null,
      metadata: parsed.data.metadata ?? {},
    });
    return { ok: true, audit_id: auditId };
  });

  const reviewSchema = z.object({
    project_slug: z.string(),
    task_id: z.string(),
    candidate_id: z.string().optional(),
    run_id: z.string().optional(),
    review_status: z.string().optional(),
    decision: z.enum(["APPROVED", "NEEDS_EDIT", "REJECTED"]).optional(),
    rejection_tags: z.array(z.string()).optional(),
    notes: z.string().optional(),
    overrides_json: z.record(z.unknown()).optional(),
    validator: z.string().optional(),
    submit: z.boolean().optional(),
  });

  app.post("/v1/reviews", async (request, reply) => {
    const parsed = reviewSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await ensureProject(db, parsed.data.project_slug);
    await insertEditorialReview(db, {
      task_id: parsed.data.task_id,
      project_id: project.id,
      candidate_id: parsed.data.candidate_id ?? null,
      run_id: parsed.data.run_id ?? null,
      review_status: parsed.data.review_status ?? null,
      decision: parsed.data.decision ?? null,
      rejection_tags: parsed.data.rejection_tags ?? [],
      notes: parsed.data.notes ?? null,
      overrides_json: parsed.data.overrides_json ?? {},
      validator: parsed.data.validator ?? null,
      submit: parsed.data.submit ?? false,
    });
    return { ok: true };
  });

  const metricSchema = z.object({
    project_slug: z.string(),
    candidate_id: z.string().optional(),
    task_id: z.string().optional(),
    platform: z.string().optional(),
    metric_window: z.enum(["early", "stabilized"]),
    window_label: z.string().optional(),
    metric_date: z.string().optional(),
    posted_at: z.string().optional(),
    likes: z.number().optional(),
    comments: z.number().optional(),
    shares: z.number().optional(),
    saves: z.number().optional(),
    watch_time_sec: z.number().optional(),
    engagement_rate: z.number().optional(),
    raw_json: z.record(z.unknown()).optional(),
  });

  app.post("/v1/metrics", async (request, reply) => {
    const parsed = metricSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await ensureProject(db, parsed.data.project_slug);
    await insertPerformanceMetric(db, {
      project_id: project.id,
      candidate_id: parsed.data.candidate_id ?? null,
      task_id: parsed.data.task_id ?? null,
      platform: parsed.data.platform ?? null,
      metric_window: parsed.data.metric_window,
      window_label: parsed.data.window_label ?? null,
      metric_date: parsed.data.metric_date ?? null,
      posted_at: parsed.data.posted_at ?? null,
      likes: parsed.data.likes ?? null,
      comments: parsed.data.comments ?? null,
      shares: parsed.data.shares ?? null,
      saves: parsed.data.saves ?? null,
      watch_time_sec: parsed.data.watch_time_sec ?? null,
      engagement_rate: parsed.data.engagement_rate ?? null,
      raw_json: parsed.data.raw_json ?? {},
    });
    return { ok: true };
  });

  const autoValSchema = z.object({
    project_slug: z.string(),
    task_id: z.string(),
    hook: z.string().optional(),
    caption: z.string().optional(),
    banned_substrings: z.array(z.string()).optional(),
  });

  app.post("/v1/auto-validation", async (request, reply) => {
    const parsed = autoValSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await ensureProject(db, parsed.data.project_slug);
    const scores = computeAutoValidationScores({
      hook: parsed.data.hook,
      caption: parsed.data.caption,
      banned_substrings: parsed.data.banned_substrings,
    });
    await insertAutoValidation(db, {
      task_id: parsed.data.task_id,
      project_id: project.id,
      format_ok: scores.format_ok,
      hook_score: scores.hook_score,
      clarity_score: scores.clarity_score,
      banned_hits: scores.banned_hits,
      overall_score: scores.overall_score,
      pass_auto: scores.pass_auto,
      metadata: { hook_len: parsed.data.hook?.length ?? 0 },
    });
    return { ok: true, scores };
  });

  const suppressionSchema = z.object({
    project_slug: z.string(),
    name: z.string(),
    rule_type: z.enum(["REJECTION_RATE", "QC_FAIL_RATE", "ENGAGEMENT_FLOOR", "BLOCK_FLOW", "BLOCK_PROMPT_VERSION"]),
    scope_flow_type: z.string().optional(),
    scope_platform: z.string().optional(),
    threshold_numeric: z.number().optional(),
    window_days: z.number().optional(),
    action: z.enum(["BLOCK_FLOW", "REDUCE_VOLUME", "FORCE_HUMAN_REVIEW", "BLOCK_PROMPT_VERSION"]).optional(),
    metadata: z.record(z.unknown()).optional(),
  });

  app.post("/v1/suppression/rules", async (request, reply) => {
    const parsed = suppressionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await ensureProject(db, parsed.data.project_slug);
    await insertSuppressionRule(db, {
      project_id: project.id,
      name: parsed.data.name,
      rule_type: parsed.data.rule_type,
      scope_flow_type: parsed.data.scope_flow_type ?? null,
      scope_platform: parsed.data.scope_platform ?? null,
      threshold_numeric: parsed.data.threshold_numeric ?? null,
      window_days: parsed.data.window_days ?? 7,
      action: parsed.data.action,
      metadata: parsed.data.metadata ?? {},
    });
    return { ok: true };
  });

  const constraintsBodySchema = z.object({
    max_daily_jobs: z.number().nullable().optional(),
    min_score_to_generate: z.number().nullable().optional(),
    max_active_prompt_versions: z.number().nullable().optional(),
    default_variation_cap: z.number().optional(),
    auto_validation_pass_threshold: z.number().nullable().optional(),
    max_carousel_jobs_per_run: z.number().int().nonnegative().nullable().optional(),
    max_video_jobs_per_run: z.number().int().nonnegative().nullable().optional(),
    max_jobs_per_flow_type: z.record(z.number().int().nonnegative()).optional(),
  });

  app.get("/v1/projects/:project_slug/constraints", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "invalid_request" });
    const project = await ensureProject(db, params.data.project_slug);
    const row = await getConstraints(db, project.id);
    return { ok: true, constraints: row };
  });

  app.put("/v1/projects/:project_slug/constraints", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    const body = constraintsBodySchema.safeParse(request.body);
    if (!params.success || !body.success) {
      return reply.code(400).send({ ok: false, error: "invalid_request" });
    }
    const project = await ensureProject(db, params.data.project_slug);
    const existing = await getConstraints(db, project.id);
    const merged = mergeConstraintUpdate(existing, body.data);
    await upsertConstraints(db, project.id, merged);
    return { ok: true, constraints: merged };
  });

  const promptVerSchema = z.object({
    project_slug: z.string(),
    flow_type: z.string(),
    prompt_id: z.string(),
    version: z.string(),
    status: z.enum(["active", "test", "deprecated"]).optional(),
    system_prompt_version: z.string().optional(),
    user_prompt_version: z.string().optional(),
    output_schema_version: z.string().optional(),
    temperature: z.number().optional(),
    max_tokens: z.number().optional(),
    experiment_tag: z.string().optional(),
    metadata_json: z.record(z.unknown()).optional(),
  });

  app.post("/v1/prompt-versions", async (request, reply) => {
    const parsed = promptVerSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({ ok: false, error: "invalid_body", details: parsed.error.flatten() });
    }
    const project = await ensureProject(db, parsed.data.project_slug);
    await insertPromptVersion(db, {
      project_id: project.id,
      flow_type: parsed.data.flow_type,
      prompt_id: parsed.data.prompt_id,
      version: parsed.data.version,
      status: parsed.data.status,
      system_prompt_version: parsed.data.system_prompt_version ?? null,
      user_prompt_version: parsed.data.user_prompt_version ?? null,
      output_schema_version: parsed.data.output_schema_version ?? null,
      temperature: parsed.data.temperature ?? null,
      max_tokens: parsed.data.max_tokens ?? null,
      experiment_tag: parsed.data.experiment_tag ?? null,
      metadata_json: parsed.data.metadata_json ?? {},
    });
    return { ok: true };
  });

  // ── Review Queue (DB-backed) ──────────────────────────────────────────

  const reviewTabSchema = z.enum(["in_review", "approved", "rejected", "needs_edit"]);

  const filterQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(500).optional(),
    offset: z.coerce.number().int().min(0).optional(),
    search: z.string().optional(),
    platform: z.string().optional(),
    flow_type: z.string().optional(),
    recommended_route: z.string().optional(),
    qc_status: z.string().optional(),
    review_status: z.string().optional(),
    decision: z.string().optional(),
    has_preview: z.enum(["true", "false"]).optional(),
    risk_score_min: z.coerce.number().optional(),
    run_id: z.string().optional(),
    project_slug: z.string().optional(),
    sort: z.enum(["task_id", "newest", "oldest", "status"]).optional(),
    group_by: z.enum(["project", "platform", "flow_type", "recommended_route"]).optional(),
  });

  function reviewFiltersFromQuery(
    q: z.infer<typeof filterQuerySchema>,
    opts: { includeProjectSlugFilter: boolean }
  ): ReviewQueueFilters {
    return {
      search: q.search,
      platform: q.platform,
      flow_type: q.flow_type,
      recommended_route: q.recommended_route,
      qc_status: q.qc_status,
      review_status: q.review_status,
      decision: q.decision,
      has_preview: q.has_preview === "true" ? true : undefined,
      risk_score_min: q.risk_score_min,
      run_id: q.run_id,
      project_slug: opts.includeProjectSlugFilter ? q.project_slug : undefined,
      sort: q.sort,
      group_by: q.group_by,
    };
  }

  /** All active projects — same tabs/filters as per-project queue, plus optional `project_slug` query. */
  app.get("/v1/review-queue-all/counts", async () => {
    const counts = await countReviewQueueAllProjects(db);
    return { ok: true, counts };
  });

  app.get("/v1/review-queue-all/facets", async () => {
    const facets = await getDistinctValuesAllProjects(db);
    return { ok: true, facets };
  });

  app.get("/v1/review-queue-all/:tab", async (request, reply) => {
    const params = z.object({ tab: reviewTabSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = filterQuerySchema.safeParse(request.query);
    const limit = query.data?.limit ?? 100;
    const offset = query.data?.offset ?? 0;
    const filters = reviewFiltersFromQuery(query.data ?? {}, { includeProjectSlugFilter: true });
    const [jobs, total, status_breakdown] = await Promise.all([
      listReviewQueueAllProjects(db, params.data.tab, limit, offset, filters),
      countReviewQueueAllProjectsFiltered(db, params.data.tab, filters),
      reviewQueueStatusBreakdownAllProjects(db, params.data.tab, filters),
    ]);
    return {
      ok: true,
      tab: params.data.tab,
      total,
      count: jobs.length,
      status_breakdown,
      jobs,
    };
  });

  app.get("/v1/review-queue-all/task/:task_id", async (request, reply) => {
    const params = z.object({ task_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const qs = z.object({ project_slug: z.string().optional() }).safeParse(request.query);
    const resolved = await resolveTaskToProject(db, params.data.task_id, qs.data?.project_slug);
    if (!resolved.ok && resolved.reason === "ambiguous") {
      return reply.code(409).send({
        ok: false,
        error: "ambiguous_task_id",
        message: "Same task_id exists in more than one project; pass project_slug query param.",
      });
    }
    if (!resolved.ok) return reply.code(404).send({ ok: false, error: "not_found" });
    const detail = await getReviewJobDetail(db, resolved.project_id, params.data.task_id);
    if (!detail) return reply.code(404).send({ ok: false, error: "not_found" });
    return { ok: true, job: { ...detail, project_slug: resolved.project_slug } };
  });

  app.get("/v1/review-queue/:project_slug/counts", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const counts = await countReviewQueue(db, project.id);
    return { ok: true, counts };
  });

  app.get("/v1/review-queue/:project_slug/facets", async (request, reply) => {
    const params = z.object({ project_slug: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const facets = await getDistinctValues(db, project.id);
    return { ok: true, facets };
  });

  app.get("/v1/review-queue/:project_slug/:tab", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), tab: reviewTabSchema }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const query = filterQuerySchema.safeParse(request.query);
    const limit = query.data?.limit ?? 100;
    const offset = query.data?.offset ?? 0;
    const filters = reviewFiltersFromQuery(query.data ?? {}, { includeProjectSlugFilter: false });
    const project = await ensureProject(db, params.data.project_slug);
    const [jobs, total, status_breakdown] = await Promise.all([
      listReviewQueue(db, project.id, params.data.tab, limit, offset, filters),
      countReviewQueueFiltered(db, project.id, params.data.tab, filters),
      reviewQueueStatusBreakdown(db, project.id, params.data.tab, filters),
    ]);
    return {
      ok: true,
      tab: params.data.tab,
      total,
      count: jobs.length,
      status_breakdown,
      jobs,
    };
  });

  app.get("/v1/review-queue/:project_slug/task/:task_id", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), task_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });
    const project = await ensureProject(db, params.data.project_slug);
    const detail = await getReviewJobDetail(db, project.id, params.data.task_id);
    if (!detail) return reply.code(404).send({ ok: false, error: "not_found" });
    return { ok: true, job: detail };
  });

  app.post("/v1/review-queue/:project_slug/task/:task_id/decide", async (request, reply) => {
    const params = z.object({ project_slug: z.string(), task_id: z.string() }).safeParse(request.params);
    if (!params.success) return reply.code(400).send({ ok: false, error: "bad_params" });

    const bodySchema = z.object({
      decision: z.enum(["APPROVED", "NEEDS_EDIT", "REJECTED"]),
      notes: z.string().optional(),
      rejection_tags: z.array(z.string()).optional(),
      validator: z.string().optional(),
      overrides_json: z.record(z.unknown()).optional(),
    });
    const body = bodySchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ ok: false, error: "invalid_body", details: body.error.flatten() });

    const project = await ensureProject(db, params.data.project_slug);

    await insertEditorialReview(db, {
      task_id: params.data.task_id,
      project_id: project.id,
      decision: body.data.decision,
      rejection_tags: body.data.rejection_tags ?? [],
      notes: body.data.notes ?? null,
      overrides_json: body.data.overrides_json ?? {},
      validator: body.data.validator ?? null,
      submit: true,
    });

    const newStatus = body.data.decision === "APPROVED" ? "APPROVED"
      : body.data.decision === "REJECTED" ? "REJECTED"
      : "NEEDS_EDIT";

    await db.query(
      `UPDATE caf_core.content_jobs SET status = $1, updated_at = now()
       WHERE project_id = $2 AND task_id = $3`,
      [newStatus, project.id, params.data.task_id]
    );

    await insertJobStateTransition(db, {
      task_id: params.data.task_id,
      project_id: project.id,
      from_state: "IN_REVIEW",
      to_state: newStatus,
      triggered_by: "human",
      rule_id: null,
      actor: body.data.validator ?? null,
      metadata: {},
    });

    if (body.data.decision === "APPROVED") {
      const jobRow = await getContentJobByTaskId(db, project.id, params.data.task_id);
      const flow = String(jobRow?.flow_type ?? "");
      if (/carousel/i.test(flow) || flow === "Flow_Carousel_Copy") {
        const urls = await buildCarouselPublishUrls(db, project.id, params.data.task_id);
        await mergePublishUrlsIntoJob(db, project.id, params.data.task_id, urls);
      }
    }

    return { ok: true, task_id: params.data.task_id, decision: body.data.decision };
  });
}
