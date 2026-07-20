/**
 * Scheduled post-approval LLM reviews (Learning Loop 3) with hard spend caps.
 *
 * Each tick, per project:
 *   1. Count llm_approval_reviews already created today (UTC) — the daily cap
 *      is enforced across ticks, restarts, and manual runs.
 *   2. Spend remaining capacity on the approved lane first, then give
 *      FAILURE_LANE_FRACTION of the batch to REJECTED/NEEDS_EDIT contrast
 *      reviews (what to change upstream).
 *   3. Emit a spend telemetry observation (`llm_review_spend`) so operators can
 *      audit vision-call volume from the learning observatory without log
 *      access.
 *
 * The runner itself already skips recently-reviewed tasks
 * (skip_if_reviewed_within_days), so cron re-runs are idempotent-ish.
 */
import { randomUUID } from "node:crypto";
import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { getProjectBySlug, listActiveProjectsForEditorialCron } from "../repositories/core.js";
import { insertObservation } from "../repositories/learning-evidence.js";
import { runLlmApprovalReviewsForProject } from "./approved-content-llm-review.js";
import { getLlmReviewCalibrationForProject } from "./llm-review-calibration.js";

export interface LlmReviewCronBatchPlan {
  approved_limit: number;
  failure_limit: number;
}

/** Pure: split remaining daily capacity into approved + failure lanes. */
export function planLlmReviewBatch(
  dailyCap: number,
  usedToday: number,
  batchLimit: number,
  failureLaneFraction: number
): LlmReviewCronBatchPlan {
  const remaining = Math.max(0, dailyCap - usedToday);
  const batch = Math.min(remaining, Math.max(1, batchLimit));
  if (batch <= 0) return { approved_limit: 0, failure_limit: 0 };
  const failure = Math.min(batch, Math.floor(batch * Math.min(1, Math.max(0, failureLaneFraction))));
  return { approved_limit: batch - failure, failure_limit: failure };
}

async function countReviewsToday(db: Pool, projectId: string): Promise<number> {
  const row = await qOne<{ n: string }>(
    db,
    `SELECT COUNT(*)::text AS n
     FROM caf_core.llm_approval_reviews
     WHERE project_id = $1 AND created_at >= date_trunc('day', now() AT TIME ZONE 'utc')`,
    [projectId]
  );
  return row ? Number(row.n) : 0;
}

export async function runLlmApprovalReviewCronForProject(
  db: Pool,
  config: AppConfig,
  projectId: string,
  projectSlug: string,
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">
): Promise<{ approved_run: number; failure_run: number; used_today: number; capped: boolean }> {
  const usedToday = await countReviewsToday(db, projectId);
  const plan = planLlmReviewBatch(
    config.LLM_APPROVAL_REVIEW_CRON_DAILY_CAP,
    usedToday,
    config.LLM_APPROVAL_REVIEW_CRON_BATCH_LIMIT,
    config.LLM_APPROVAL_REVIEW_CRON_FAILURE_LANE_FRACTION
  );

  if (plan.approved_limit === 0 && plan.failure_limit === 0) {
    log.info({ slug: projectSlug, used_today: usedToday }, "llm_review_cron: daily cap reached, skip");
    return { approved_run: 0, failure_run: 0, used_today: usedToday, capped: true };
  }

  // Data-driven mint thresholds: when enough human decisions exist, replace the
  // hardcoded defaults with the calibrated suggestions (median score of rejected
  // content / p75 of approved content). Calibration failures fall back silently.
  let mintBelow: number | null = null;
  let mintAbove: number | null = null;
  try {
    const cal = await getLlmReviewCalibrationForProject(db, projectId);
    if (cal.suggested_thresholds.sample_sufficient) {
      mintBelow = cal.suggested_thresholds.improve_below;
      mintAbove = cal.suggested_thresholds.positive_at_or_above;
    }
  } catch {
    /* defaults remain in effect */
  }

  let approvedRun = 0;
  let failureRun = 0;
  let model = "";

  if (plan.approved_limit > 0) {
    const { results, model: m } = await runLlmApprovalReviewsForProject(db, config, projectId, projectSlug, {
      limit: plan.approved_limit,
      decisions: ["APPROVED"],
      mint_pending_hints_below_score: mintBelow,
      mint_positive_hints_above_score: mintAbove,
    });
    model = m;
    approvedRun = results.filter((r) => r.ok && !r.skipped).length;
  }

  if (plan.failure_limit > 0) {
    const { results, model: m } = await runLlmApprovalReviewsForProject(db, config, projectId, projectSlug, {
      limit: plan.failure_limit,
      decisions: ["REJECTED", "NEEDS_EDIT"],
      mint_pending_hints_below_score: mintBelow,
      mint_positive_hints_above_score: mintAbove,
    });
    model = model || m;
    failureRun = results.filter((r) => r.ok && !r.skipped).length;
  }

  // Spend telemetry — auditable without log access.
  if (approvedRun + failureRun > 0) {
    try {
      await insertObservation(db, {
        observation_id: `llm_spend_${randomUUID().replace(/-/g, "").slice(0, 20)}`,
        scope_type: "project",
        project_id: projectId,
        source_type: "llm_review_spend",
        flow_type: null,
        platform: null,
        observation_type: "llm_review_spend",
        entity_ref: null,
        payload_json: {
          reviews_run: approvedRun + failureRun,
          approved_lane: approvedRun,
          failure_lane: failureRun,
          used_today_before_tick: usedToday,
          daily_cap: config.LLM_APPROVAL_REVIEW_CRON_DAILY_CAP,
          model,
          trigger: "cron",
          calibrated_mint_below: mintBelow,
          calibrated_mint_above: mintAbove,
        },
        confidence: null,
        observed_at: new Date().toISOString(),
      });
    } catch {
      /* telemetry must not break the loop */
    }
  }

  return { approved_run: approvedRun, failure_run: failureRun, used_today: usedToday, capped: false };
}

export async function runLlmApprovalReviewCron(
  db: Pool,
  config: AppConfig,
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">,
  opts?: { slugs?: string[] }
): Promise<void> {
  const envSlugs = (config.LLM_APPROVAL_REVIEW_CRON_PROJECT_SLUGS ?? "").trim();
  let slugs: string[];
  if (opts?.slugs && opts.slugs.length > 0) {
    slugs = opts.slugs;
  } else if (envSlugs) {
    slugs = envSlugs.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    const rows = await listActiveProjectsForEditorialCron(db);
    slugs = rows.map((r) => r.slug);
  }
  if (slugs.length === 0) return;

  for (const slug of slugs) {
    const p = await getProjectBySlug(db, slug);
    if (!p?.active) continue;
    try {
      const r = await runLlmApprovalReviewCronForProject(db, config, p.id, p.slug, log);
      if (r.approved_run + r.failure_run > 0 || r.capped) {
        log.info({ slug, ...r }, "llm_review_cron: completed");
      }
    } catch (e) {
      log.error({ err: e, slug }, "llm_review_cron: project failed");
    }
  }
}

/** Starts interval + initial delayed tick. Returns disposer for shutdown. */
export function startLlmApprovalReviewCron(
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">,
  deps: { db: Pool; config: AppConfig }
): (() => void) | null {
  const { db, config } = deps;
  if (!config.LLM_APPROVAL_REVIEW_CRON_ENABLED) return null;

  log.info(
    {
      interval_ms: config.LLM_APPROVAL_REVIEW_CRON_INTERVAL_MS,
      initial_delay_ms: config.LLM_APPROVAL_REVIEW_CRON_INITIAL_DELAY_MS,
      daily_cap: config.LLM_APPROVAL_REVIEW_CRON_DAILY_CAP,
      batch_limit: config.LLM_APPROVAL_REVIEW_CRON_BATCH_LIMIT,
      failure_lane_fraction: config.LLM_APPROVAL_REVIEW_CRON_FAILURE_LANE_FRACTION,
      project_slugs: (config.LLM_APPROVAL_REVIEW_CRON_PROJECT_SLUGS ?? "").trim() || "(all active except caf-global)",
    },
    "llm_review_cron: scheduler enabled"
  );

  let interval: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = () => {
    if (running) {
      log.warn("llm_review_cron: skip tick (previous run still running)");
      return;
    }
    running = true;
    runLlmApprovalReviewCron(db, config, log)
      .catch((e) => log.error({ err: e }, "llm_review_cron: run failed"))
      .finally(() => {
        running = false;
      });
  };

  const initialTimer = setTimeout(() => {
    tick();
    interval = setInterval(tick, config.LLM_APPROVAL_REVIEW_CRON_INTERVAL_MS);
  }, config.LLM_APPROVAL_REVIEW_CRON_INITIAL_DELAY_MS);

  return () => {
    clearTimeout(initialTimer);
    if (interval) clearInterval(interval);
  };
}
