/**
 * In-process scheduler + shared runner for editorial analysis (production "live" loop).
 */
import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { getProjectBySlug, listActiveProjectsForEditorialCron } from "../repositories/core.js";
import { analyzeEditorialPatterns } from "./editorial-learning.js";

export async function runEditorialAnalysisForCronProjects(
  db: Pool,
  config: AppConfig,
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">,
  opts?: { windowDays?: number; slugs?: string[] }
): Promise<void> {
  const windowDays = opts?.windowDays ?? config.EDITORIAL_ANALYSIS_CRON_WINDOW_DAYS;
  const envSlugs = (config.EDITORIAL_ANALYSIS_CRON_PROJECT_SLUGS ?? "").trim();

  let slugs: string[];
  if (opts?.slugs && opts.slugs.length > 0) {
    slugs = opts.slugs;
  } else if (envSlugs) {
    slugs = envSlugs.split(",").map((s) => s.trim()).filter(Boolean);
  } else {
    const rows = await listActiveProjectsForEditorialCron(db);
    slugs = rows.map((r) => r.slug);
  }

  if (slugs.length === 0) {
    log.warn("editorial_cron: no project slugs to run");
    return;
  }

  for (const slug of slugs) {
    const p = await getProjectBySlug(db, slug);
    if (!p) {
      log.warn({ slug }, "editorial_cron: project not found, skip");
      continue;
    }
    if (!p.active) {
      log.warn({ slug }, "editorial_cron: project inactive, skip");
      continue;
    }
    try {
      const result = await analyzeEditorialPatterns(db, config, p.id, p.slug, windowDays, true, true, undefined);
      const llm = result.llm_notes_synthesis;
      const llmReason =
        llm && "skipped" in llm ? llm.reason : llm ? "ok" : "disabled_or_absent";
      log.info(
        {
          slug,
          total_reviews: result.total_reviews,
          reviews_marked_consumed: result.editorial_reviews_marked_consumed,
          rules_created: result.rules_created,
          engineering_insight_id: result.engineering_insight_id,
          llm_notes: llmReason,
        },
        "editorial_cron: completed"
      );
    } catch (e) {
      log.error({ err: e, slug }, "editorial_cron: failed");
    }
  }
}

/**
 * Starts interval + initial delayed tick. Returns disposer for shutdown.
 */
export function startEditorialAnalysisCron(
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">,
  deps: { db: Pool; config: AppConfig }
): (() => void) | null {
  const { db, config } = deps;
  if (!config.EDITORIAL_ANALYSIS_CRON_ENABLED) return null;

  log.info(
    {
      interval_ms: config.EDITORIAL_ANALYSIS_CRON_INTERVAL_MS,
      initial_delay_ms: config.EDITORIAL_ANALYSIS_CRON_INITIAL_DELAY_MS,
      window_days: config.EDITORIAL_ANALYSIS_CRON_WINDOW_DAYS,
      project_slugs: (config.EDITORIAL_ANALYSIS_CRON_PROJECT_SLUGS ?? "").trim() || "(all active except caf-global)",
    },
    "editorial_cron: scheduler enabled"
  );

  let interval: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = () => {
    if (running) {
      log.warn("editorial_cron: skip tick (previous run still running)");
      return;
    }
    running = true;
    runEditorialAnalysisForCronProjects(db, config, log)
      .catch((e) => log.error({ err: e }, "editorial_cron: run failed"))
      .finally(() => {
        running = false;
      });
  };

  const initialTimer = setTimeout(() => {
    tick();
    interval = setInterval(tick, config.EDITORIAL_ANALYSIS_CRON_INTERVAL_MS);
  }, config.EDITORIAL_ANALYSIS_CRON_INITIAL_DELAY_MS);

  return () => {
    clearTimeout(initialTimer);
    if (interval) clearInterval(interval);
  };
}
