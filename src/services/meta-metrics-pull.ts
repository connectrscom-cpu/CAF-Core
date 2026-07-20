/**
 * Meta Graph insights auto-pull (Learning Loop 2 evidence).
 *
 * Closes the biggest performance-loop gap: metrics previously arrived only via
 * manual CSV/JSON ingest. This service walks `job_outcomes` rows that have a
 * `platform_post_id` (published via the Meta executor), fetches likes /
 * comments / shares / saves / reach from the Graph API, writes
 * `performance_metrics` rows (same table the manual ingest uses), and advances
 * `job_outcomes.tracking_status` published → metrics_present.
 *
 * Token resolution mirrors meta-graph-publish.ts: per-channel env override,
 * legacy single secret, else `project_integrations` credentials.
 *
 * Windows: a post younger than EARLY_WINDOW_HOURS gets `metric_window='early'`,
 * otherwise `'stabilized'`. One row per (task_id, window, day) — re-running a
 * tick on the same day updates nothing (skip), so cron frequency is safe.
 */
import type { FastifyBaseLogger } from "fastify";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { q, qOne } from "../db/queries.js";
import { getProjectBySlug, listActiveProjectsForEditorialCron } from "../repositories/core.js";
import { insertPerformanceMetric } from "../repositories/ops.js";
import { markJobOutcomeMetricsPresent } from "../repositories/job-outcomes.js";
import {
  getProjectIntegration,
  resolveProjectIdForMetaIntegrations,
} from "../repositories/project-integrations.js";
import { placementPlatformToMetaIntegrationKey } from "./meta-graph-publish.js";

const GRAPH = "https://graph.facebook.com";
const EARLY_WINDOW_HOURS = 72;

export interface PulledPostMetrics {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
  video_views: number | null;
  raw: Record<string, unknown>;
}

/** (likes+comments+shares+saves) / reach — null when reach unknown or zero. */
export function computeEngagementRate(m: {
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saves: number | null;
  reach: number | null;
}): number | null {
  if (m.reach == null || m.reach <= 0) return null;
  const interactions = (m.likes ?? 0) + (m.comments ?? 0) + (m.shares ?? 0) + (m.saves ?? 0);
  return Math.round((interactions / m.reach) * 100000) / 100000;
}

/** early for the first 72h after publish, stabilized after. */
export function metricWindowForPublishedAt(
  publishedAtIso: string | null,
  now: Date = new Date()
): "early" | "stabilized" {
  if (!publishedAtIso) return "stabilized";
  const published = new Date(publishedAtIso);
  if (Number.isNaN(published.getTime())) return "stabilized";
  const ageHours = (now.getTime() - published.getTime()) / 3_600_000;
  return ageHours < EARLY_WINDOW_HOURS ? "early" : "stabilized";
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

interface GraphInsightsResponse {
  data?: Array<{ name?: string; values?: Array<{ value?: unknown }> }>;
}

function insightValue(res: GraphInsightsResponse, metric: string): number | null {
  for (const row of res.data ?? []) {
    if (row.name === metric) return num(row.values?.[0]?.value);
  }
  return null;
}

/** Parse IG media fields + insights into a normalized metrics shape (pure). */
export function parseIgMetrics(
  media: { like_count?: unknown; comments_count?: unknown },
  insights: GraphInsightsResponse
): PulledPostMetrics {
  const metrics = {
    likes: num(media.like_count),
    comments: num(media.comments_count),
    shares: insightValue(insights, "shares"),
    saves: insightValue(insights, "saved"),
    reach: insightValue(insights, "reach"),
    video_views: insightValue(insights, "views") ?? insightValue(insights, "video_views"),
  };
  return { ...metrics, raw: { media, insights } };
}

/** Parse FB post fields + insights into a normalized metrics shape (pure). */
export function parseFbMetrics(
  post: {
    likes?: { summary?: { total_count?: unknown } };
    comments?: { summary?: { total_count?: unknown } };
    shares?: { count?: unknown };
  },
  insights: GraphInsightsResponse
): PulledPostMetrics {
  const metrics = {
    likes: num(post.likes?.summary?.total_count),
    comments: num(post.comments?.summary?.total_count),
    shares: num(post.shares?.count),
    saves: null,
    reach: insightValue(insights, "post_impressions_unique") ?? insightValue(insights, "post_impressions"),
    video_views: insightValue(insights, "post_video_views"),
  };
  return { ...metrics, raw: { post, insights } };
}

async function graphGetJson(path: string, token: string, version: string): Promise<Record<string, unknown>> {
  const u = new URL(`${GRAPH}/${version}/${path.replace(/^\//, "")}`);
  u.searchParams.set("access_token", token);
  const res = await fetch(u.toString(), { method: "GET" });
  const j = (await res.json()) as Record<string, unknown> & { error?: { message?: string } };
  if (!res.ok || j.error) {
    throw new Error(j.error?.message ?? `Graph GET ${path} → HTTP ${res.status}`);
  }
  return j;
}

async function fetchIgPostMetrics(mediaId: string, token: string, version: string): Promise<PulledPostMetrics> {
  const media = await graphGetJson(`${mediaId}?fields=like_count,comments_count`, token, version);
  let insights: GraphInsightsResponse = {};
  try {
    insights = (await graphGetJson(
      `${mediaId}/insights?metric=reach,saved,shares,views`,
      token,
      version
    )) as GraphInsightsResponse;
  } catch {
    // Some media types reject certain metrics; degrade to counts only.
  }
  return parseIgMetrics(media as { like_count?: unknown; comments_count?: unknown }, insights);
}

async function fetchFbPostMetrics(postId: string, token: string, version: string): Promise<PulledPostMetrics> {
  const post = await graphGetJson(
    `${postId}?fields=likes.summary(true),comments.summary(true),shares`,
    token,
    version
  );
  let insights: GraphInsightsResponse = {};
  try {
    insights = (await graphGetJson(
      `${postId}/insights?metric=post_impressions_unique,post_video_views`,
      token,
      version
    )) as GraphInsightsResponse;
  } catch {
    // Page-level insight permissions may be missing; counts still useful.
  }
  return parseFbMetrics(
    post as {
      likes?: { summary?: { total_count?: unknown } };
      comments?: { summary?: { total_count?: unknown } };
      shares?: { count?: unknown };
    },
    insights
  );
}

function tokenFromCredentials(cred: Record<string, unknown> | undefined): string | null {
  if (!cred) return null;
  const t = cred["access_token"] ?? cred["page_access_token"];
  return typeof t === "string" && t.trim() ? t.trim() : null;
}

async function resolveTokenForChannel(
  db: Pool,
  config: AppConfig,
  metaProjectId: string,
  key: "META_FB" | "META_IG"
): Promise<string | null> {
  const envToken =
    key === "META_FB" ? config.CAF_META_FB_PAGE_ACCESS_TOKEN : config.CAF_META_IG_PAGE_ACCESS_TOKEN;
  if (envToken?.trim()) return envToken.trim();
  const legacy = config.CAF_META_PAGE_ACCESS_TOKEN;
  if (legacy?.trim()) return legacy.trim();
  const row = await getProjectIntegration(db, metaProjectId, key);
  return tokenFromCredentials(row?.credentials_json);
}

interface OutcomeToPull {
  task_id: string;
  platform: string;
  platform_post_id: string;
  published_at: string | null;
}

export interface MetaMetricsPullResult {
  project_id: string;
  candidates: number;
  pulled: number;
  skipped_existing: number;
  errors: number;
}

export async function pullMetaMetricsForProject(
  db: Pool,
  config: AppConfig,
  projectId: string,
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">
): Promise<MetaMetricsPullResult> {
  const result: MetaMetricsPullResult = {
    project_id: projectId,
    candidates: 0,
    pulled: 0,
    skipped_existing: 0,
    errors: 0,
  };

  const outcomes = await q<OutcomeToPull>(
    db,
    `SELECT task_id, platform, platform_post_id, published_at::text
     FROM caf_core.job_outcomes
     WHERE project_id = $1::uuid
       AND platform_post_id IS NOT NULL
       AND tracking_status IN ('published', 'metrics_present')
       AND (published_at IS NULL OR published_at >= now() - make_interval(days => $2))
     ORDER BY published_at DESC NULLS LAST
     LIMIT $3`,
    [projectId, config.META_METRICS_PULL_MAX_POST_AGE_DAYS, config.META_METRICS_PULL_MAX_POSTS_PER_TICK]
  );
  result.candidates = outcomes.length;
  if (outcomes.length === 0) return result;

  const metaProjectId = await resolveProjectIdForMetaIntegrations(db, projectId, {
    accountSourceByProjectSlug: config.metaAccountSourceByProjectSlug,
  });
  const version = config.META_GRAPH_API_VERSION.trim().startsWith("v")
    ? config.META_GRAPH_API_VERSION.trim()
    : `v${config.META_GRAPH_API_VERSION.trim()}`;

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  for (const o of outcomes) {
    const key = placementPlatformToMetaIntegrationKey(o.platform);
    if (!key) continue;

    const window = metricWindowForPublishedAt(o.published_at, now);
    const existing = await qOne<{ id: string }>(
      db,
      `SELECT id::text FROM caf_core.performance_metrics
       WHERE project_id = $1 AND task_id = $2 AND metric_window = $3 AND metric_date = $4::date
         AND raw_json->>'source' = 'meta_graph_auto_pull'
       LIMIT 1`,
      [projectId, o.task_id, window, today]
    );
    if (existing) {
      result.skipped_existing += 1;
      continue;
    }

    try {
      const token = await resolveTokenForChannel(db, config, metaProjectId, key);
      if (!token) {
        log.warn({ task_id: o.task_id, platform: o.platform }, "meta_metrics_pull: no token, skip");
        continue;
      }
      const metrics =
        key === "META_IG"
          ? await fetchIgPostMetrics(o.platform_post_id, token, version)
          : await fetchFbPostMetrics(o.platform_post_id, token, version);

      await insertPerformanceMetric(db, {
        project_id: projectId,
        task_id: o.task_id,
        platform: o.platform,
        metric_window: window,
        window_label: window === "early" ? "meta_auto_early" : "meta_auto_stabilized",
        metric_date: today,
        posted_at: o.published_at,
        likes: metrics.likes,
        comments: metrics.comments,
        shares: metrics.shares,
        saves: metrics.saves,
        engagement_rate: computeEngagementRate(metrics),
        raw_json: {
          source: "meta_graph_auto_pull",
          platform_post_id: o.platform_post_id,
          reach: metrics.reach,
          video_views: metrics.video_views,
          graph: metrics.raw,
        },
      });
      await markJobOutcomeMetricsPresent(db, projectId, [o.task_id]);
      result.pulled += 1;
    } catch (e) {
      result.errors += 1;
      log.warn(
        { err: e instanceof Error ? e.message : String(e), task_id: o.task_id, platform: o.platform },
        "meta_metrics_pull: post failed"
      );
    }
  }

  return result;
}

export async function runMetaMetricsPullForCronProjects(
  db: Pool,
  config: AppConfig,
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">,
  opts?: { slugs?: string[] }
): Promise<void> {
  const envSlugs = (config.META_METRICS_PULL_PROJECT_SLUGS ?? "").trim();
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
      const r = await pullMetaMetricsForProject(db, config, p.id, log);
      if (r.candidates > 0) {
        log.info({ slug, ...r }, "meta_metrics_pull: completed");
      }
    } catch (e) {
      log.error({ err: e, slug }, "meta_metrics_pull: project failed");
    }
  }
}

/** Starts interval + initial delayed tick. Returns disposer for shutdown. */
export function startMetaMetricsPullCron(
  log: Pick<FastifyBaseLogger, "info" | "warn" | "error">,
  deps: { db: Pool; config: AppConfig }
): (() => void) | null {
  const { db, config } = deps;
  if (!config.META_METRICS_PULL_ENABLED) return null;

  log.info(
    {
      interval_ms: config.META_METRICS_PULL_INTERVAL_MS,
      initial_delay_ms: config.META_METRICS_PULL_INITIAL_DELAY_MS,
      max_posts_per_tick: config.META_METRICS_PULL_MAX_POSTS_PER_TICK,
      max_post_age_days: config.META_METRICS_PULL_MAX_POST_AGE_DAYS,
      project_slugs: (config.META_METRICS_PULL_PROJECT_SLUGS ?? "").trim() || "(all active except caf-global)",
    },
    "meta_metrics_pull: scheduler enabled"
  );

  let interval: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const tick = () => {
    if (running) {
      log.warn("meta_metrics_pull: skip tick (previous run still running)");
      return;
    }
    running = true;
    runMetaMetricsPullForCronProjects(db, config, log)
      .catch((e) => log.error({ err: e }, "meta_metrics_pull: run failed"))
      .finally(() => {
        running = false;
      });
  };

  const initialTimer = setTimeout(() => {
    tick();
    interval = setInterval(tick, config.META_METRICS_PULL_INTERVAL_MS);
  }, config.META_METRICS_PULL_INITIAL_DELAY_MS);

  return () => {
    clearTimeout(initialTimer);
    if (interval) clearInterval(interval);
  };
}
