/**
 * Run INPUTS scrapers via Apify / HTTP and persist results as inputs_evidence_imports.
 */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  getScraperConfig,
  getScraperRun,
  insertScraperRun,
  listSourceRows,
  updateScraperRun,
} from "../repositories/inputs-sources.js";
import { enrichInstagramApifyPayloadInPlace } from "./instagram-media-normalizer.js";
import {
  computeDedupeKey,
  sheetNameToEvidenceKind,
  type ParsedInputsEvidenceRow,
} from "./inputs-sns-workbook-parser.js";
import {
  buildSheetStatsFromRows,
  writeInputsEvidenceImport,
} from "./inputs-evidence-import-write.js";
import { SCRAPER_OUTPUT_SHEETS } from "./inputs-source-sync.js";
import {
  apifyWaitSec,
  applyPostMaxAgeToConfig,
  buildFacebookApifyInput,
  buildInstagramApifyInput,
  buildRedditApifyInputFromConfig,
  buildTiktokApifyInput,
  datasetLimitFor,
  defaultScraperConfig,
  mergeScraperConfig,
  parseHashtagList,
  resolveActorId,
  type ScraperProjectConfig,
} from "./inputs-scraper-apify-config.js";
import {
  enabledWebsiteSources,
  facebookUrlsFromSources,
  prepareInstagramSources,
  subredditLinksFromSources,
  tiktokProfilesFromSources,
  transformFacebookApifyPost,
  transformHtmlFetch,
  transformInstagramApifyPost,
  transformRedditApifyDataset,
  transformTiktokApifyItem,
} from "./inputs-scraper-transforms.js";
import {
  ApifyError,
  abortApifyRun,
  getApifyDatasetItems,
  hasApifyToken,
  runApifyActor,
  apifyConsoleRunUrl,
  type ApifyRunResult,
} from "./apify-client.js";
import { applySourceCap } from "./inputs-scraper-cost-estimate.js";
import {
  assertScraperRunNotAborted,
  clearScraperRun,
  isScraperRunAborted,
  isScraperRunActive,
  registerScraperRun,
  requestScraperRunAbort,
  ScraperRunAbortedError,
  trackApifyRun,
} from "./inputs-scraper-run-registry.js";
import { logPipelineEvent } from "./pipeline-logger.js";

export interface ScraperAbortContext {
  projectId: string;
  cafRunId: string;
}

export interface RunInputsScraperOptions {
  /** Max source rows per scraper (IG accounts, TikTok profiles, pages, etc.). Omit = no cap. */
  maxSources?: number | null;
  /** When set, run checks registry for operator abort (API async path). */
  abortContext?: ScraperAbortContext;
  /** Run only these platforms (overrides `scraper: all` expansion). */
  platforms?: Array<Exclude<ScraperKey, "all">>;
  /** Only include posts newer than this many days (per-platform Apify filters). */
  postMaxAgeDays?: number;
}

function apifyAbortHooks(ctx?: ScraperAbortContext): {
  shouldAbort?: () => boolean;
  onRunStarted?: (run: ApifyRunResult) => void;
} {
  if (!ctx) return {};
  return {
    shouldAbort: () => isScraperRunAborted(ctx.projectId, ctx.cafRunId),
    onRunStarted: (run) => trackApifyRun(ctx.projectId, ctx.cafRunId, run.id),
  };
}

function checkScraperAbort(ctx?: ScraperAbortContext): void {
  if (ctx) assertScraperRunNotAborted(ctx.projectId, ctx.cafRunId);
}

function isAbortError(e: unknown): boolean {
  if (e instanceof ScraperRunAbortedError) return true;
  if (e instanceof ApifyError && /aborted/i.test(e.message)) return true;
  return false;
}

export const SCRAPER_KEYS = ["instagram", "tiktok", "html", "facebook", "reddit", "all"] as const;
export type ScraperKey = (typeof SCRAPER_KEYS)[number];

export interface ScraperApifyRunRef {
  scraper_key: string;
  run_id: string;
  console_url: string;
}

interface ScrapePayloadResult {
  payloads: Record<string, unknown>[];
  apifyRunIds: string[];
}

export { defaultScraperConfig, mergeScraperConfig, applyPostMaxAgeToConfig, type ScraperProjectConfig };

async function loadEnabledSources(
  db: Pool,
  projectId: string,
  sourceTab: string
): Promise<Record<string, unknown>[]> {
  const rows = await listSourceRows(db, projectId, sourceTab);
  return rows.filter((r) => r.enabled).map((r) => r.payload_json);
}

function rowsToEvidence(
  sheetName: string,
  payloads: Record<string, unknown>[]
): ParsedInputsEvidenceRow[] {
  const evidenceKind = sheetNameToEvidenceKind(sheetName);
  return payloads.map((payload_json, i) => {
    if (evidenceKind === "instagram_post") enrichInstagramApifyPayloadInPlace(payload_json);
    return {
      sheet_name: sheetName,
      row_index: i + 1,
      evidence_kind: evidenceKind,
      dedupe_key: computeDedupeKey(sheetName, evidenceKind, payload_json),
      payload_json,
    };
  });
}

async function persistEvidenceImport(
  db: Pool,
  projectId: string,
  opts: {
    filename: string;
    notes: string;
    rows: ParsedInputsEvidenceRow[];
    scraperRunId: string;
  }
): Promise<{ importId: string; totalRows: number }> {
  const workbook_sha256 = createHash("sha256")
    .update(JSON.stringify({ scraper_run: opts.scraperRunId, rows: opts.rows.length }))
    .digest("hex");

  const sheet_stats_json = buildSheetStatsFromRows(opts.rows, {
    source: "scraper",
    scraper_run_id: opts.scraperRunId,
    workbook_sha256,
  });

  return writeInputsEvidenceImport(db, projectId, {
    filename: opts.filename,
    notes: opts.notes,
    workbook_sha256,
    sheet_stats_json,
    rows: opts.rows,
  });
}

async function scrapeInstagram(
  token: string,
  cfg: ScraperProjectConfig,
  sources: Record<string, unknown>[],
  maxSources?: number | null,
  abortCtx?: ScraperAbortContext
): Promise<ScrapePayloadResult> {
  checkScraperAbort(abortCtx);
  const prepared = applySourceCap(prepareInstagramSources(sources), maxSources);
  const ig = cfg.scrapers?.instagram ?? {};
  const actorId = resolveActorId("instagram", ig);
  const wait = apifyWaitSec(cfg);
  const limit = datasetLimitFor(cfg, "instagram");
  const out: Record<string, unknown>[] = [];
  const apifyRunIds: string[] = [];

  if (ig.runMode === "batch") {
    const urls = prepared.map((s) => String(s.instagramUrl ?? "")).filter(Boolean);
    if (urls.length === 0) return { payloads: [], apifyRunIds };
    const run = await runApifyActor(token, actorId, buildInstagramApifyInput(cfg, urls), {
      waitForFinishSec: wait,
      ...apifyAbortHooks(abortCtx),
    });
    apifyRunIds.push(run.id);
    const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit });
    const ctx = prepared[0] ?? {};
    for (const item of items) out.push(transformInstagramApifyPost(item, ctx));
    return { payloads: out, apifyRunIds };
  }

  for (const src of prepared) {
    checkScraperAbort(abortCtx);
    const url = String(src.instagramUrl ?? "");
    if (!url) continue;
    const run = await runApifyActor(token, actorId, buildInstagramApifyInput(cfg, [url]), {
      waitForFinishSec: wait,
      ...apifyAbortHooks(abortCtx),
    });
    apifyRunIds.push(run.id);
    const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit });
    for (const item of items) out.push(transformInstagramApifyPost(item, src));
  }
  return { payloads: out, apifyRunIds };
}

async function scrapeTiktok(
  token: string,
  cfg: ScraperProjectConfig,
  sources: Record<string, unknown>[],
  hashtagSources: Record<string, unknown>[],
  maxSources?: number | null,
  abortCtx?: ScraperAbortContext
): Promise<ScrapePayloadResult> {
  checkScraperAbort(abortCtx);
  const profiles = applySourceCap(tiktokProfilesFromSources(sources), maxSources);
  const tt = cfg.scrapers?.tiktok ?? {};
  const extraProfiles = parseHashtagList(
    Array.isArray(tt.extraProfiles) ? tt.extraProfiles.join("\n") : String(tt.extraProfiles ?? "")
  );
  const extraHashtags = parseHashtagList(
    Array.isArray(tt.extraHashtags) ? tt.extraHashtags.join("\n") : String(tt.extraHashtags ?? "")
  );
  const useSourceHashtags = tt.useHashtagsFromSources !== false && hashtagSources.length > 0;
  if (profiles.length === 0 && extraProfiles.length === 0 && !useSourceHashtags && extraHashtags.length === 0) {
    return { payloads: [], apifyRunIds: [] };
  }

  const actorId = resolveActorId("tiktok", tt);
  const wait = apifyWaitSec(cfg);
  const limit = datasetLimitFor(cfg, "tiktok");
  const input = buildTiktokApifyInput(cfg, profiles, hashtagSources);
  if (!Array.isArray(input.profiles) || (input.profiles as string[]).length === 0) {
    if (!Array.isArray(input.hashtags) || (input.hashtags as string[]).length === 0) {
      return { payloads: [], apifyRunIds: [] };
    }
  }

  const run = await runApifyActor(token, actorId, input, {
    waitForFinishSec: wait,
    ...apifyAbortHooks(abortCtx),
  });
  const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit });
  const out: Record<string, unknown>[] = [];
  for (const item of items) {
    const row = transformTiktokApifyItem(item);
    if (row) out.push(row);
  }
  return { payloads: out, apifyRunIds: [run.id] };
}

async function scrapeReddit(
  token: string,
  cfg: ScraperProjectConfig,
  sources: Record<string, unknown>[],
  maxSources?: number | null,
  abortCtx?: ScraperAbortContext
): Promise<ScrapePayloadResult> {
  checkScraperAbort(abortCtx);
  const links = applySourceCap(subredditLinksFromSources(sources), maxSources);
  if (links.length === 0) return { payloads: [], apifyRunIds: [] };
  const rd = cfg.scrapers?.reddit ?? {};
  const actorId = resolveActorId("reddit", rd);
  const wait = apifyWaitSec(cfg);
  const limit = datasetLimitFor(cfg, "reddit");
  const input = buildRedditApifyInputFromConfig(cfg, links);
  const run = await runApifyActor(token, actorId, input, {
    waitForFinishSec: wait,
    ...apifyAbortHooks(abortCtx),
  });
  const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit });
  return { payloads: transformRedditApifyDataset(items), apifyRunIds: [run.id] };
}

async function scrapeFacebook(
  token: string,
  cfg: ScraperProjectConfig,
  sources: Record<string, unknown>[],
  maxSources?: number | null,
  abortCtx?: ScraperAbortContext
): Promise<ScrapePayloadResult> {
  checkScraperAbort(abortCtx);
  const urls = applySourceCap(facebookUrlsFromSources(sources), maxSources);
  if (urls.length === 0) return { payloads: [], apifyRunIds: [] };
  const fb = cfg.scrapers?.facebook ?? {};
  const actorId = resolveActorId("facebook", fb);
  const wait = apifyWaitSec(cfg);
  const limit = datasetLimitFor(cfg, "facebook");
  const filterOpts = { minLikes: fb.minLikes ?? 5, requireCaption: fb.requireCaption !== false };
  const out: Record<string, unknown>[] = [];
  const apifyRunIds: string[] = [];
  for (const startUrl of urls) {
    checkScraperAbort(abortCtx);
    const run = await runApifyActor(token, actorId, buildFacebookApifyInput(cfg, startUrl), {
      waitForFinishSec: wait,
      ...apifyAbortHooks(abortCtx),
    });
    apifyRunIds.push(run.id);
    const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit });
    for (const item of items) {
      const row = transformFacebookApifyPost(item, filterOpts);
      if (row) out.push(row);
    }
  }
  return { payloads: out, apifyRunIds };
}

async function scrapeHtml(
  cfg: ScraperProjectConfig,
  sources: Record<string, unknown>[],
  maxSources?: number | null,
  abortCtx?: ScraperAbortContext
): Promise<ScrapePayloadResult> {
  const htmlCfg = cfg.scrapers?.html ?? {};
  const sites = applySourceCap(enabledWebsiteSources(sources), maxSources);
  const timeout = htmlCfg.fetchTimeoutMs ?? 30_000;
  const ua = htmlCfg.userAgent ?? "Mozilla/5.0 (compatible; CAF-Core/1.0; +https://caf.local)";
  const out: Record<string, unknown>[] = [];

  for (const site of sites) {
    checkScraperAbort(abortCtx);
    try {
      const res = await fetch(site.url, {
        headers: { "User-Agent": ua },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) continue;
      const html = await res.text();
      out.push(
        transformHtmlFetch(html, {
          url: site.url,
          sourceName: site.name,
          maxMainTextChars: htmlCfg.maxMainTextChars,
          minParagraphChars: htmlCfg.minParagraphChars,
        })
      );
    } catch (e) {
      logPipelineEvent("warn", "other", "inputs scraper html fetch failed", {
        data: { url: site.url, error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
  return { payloads: out, apifyRunIds: [] };
}

function apifyRunRefs(scraperKey: string, runIds: string[]): ScraperApifyRunRef[] {
  return runIds.map((run_id) => ({
    scraper_key: scraperKey,
    run_id,
    console_url: apifyConsoleRunUrl(run_id),
  }));
}

const SCRAPER_SOURCE_TAB: Record<string, string> = {
  instagram: "igaccounts",
  tiktok: "tiktokaccounts",
  html: "websites_blogs",
  facebook: "facebook",
  reddit: "subreddits",
};

async function runOneScraper(
  db: Pool,
  config: AppConfig,
  projectId: string,
  scraperKey: Exclude<ScraperKey, "all">,
  projectConfig: ScraperProjectConfig,
  runOpts?: RunInputsScraperOptions
): Promise<{ rows: ParsedInputsEvidenceRow[]; apifyRuns: ScraperApifyRunRef[] }> {
  const maxSources = runOpts?.maxSources;
  const abortCtx = runOpts?.abortContext;
  const tab = SCRAPER_SOURCE_TAB[scraperKey];
  const sources = await loadEnabledSources(db, projectId, tab);
  if (sources.length === 0 && scraperKey !== "tiktok") {
    throw new Error(`No enabled sources in ${tab}`);
  }

  const scraperCfg = projectConfig.scrapers?.[scraperKey];
  if (scraperCfg?.enabled === false) {
    throw new Error(`Scraper ${scraperKey} is disabled in config`);
  }

  let scrapeResult: ScrapePayloadResult = { payloads: [], apifyRunIds: [] };
  if (scraperKey === "html") {
    scrapeResult = await scrapeHtml(projectConfig, sources, maxSources, abortCtx);
  } else {
    const token = config.APIFY_API_TOKEN?.trim();
    if (!hasApifyToken(token)) throw new Error("APIFY_API_TOKEN not configured");
    switch (scraperKey) {
      case "instagram":
        scrapeResult = await scrapeInstagram(token!, projectConfig, sources, maxSources, abortCtx);
        break;
      case "tiktok": {
        const hashtagSources = await loadEnabledSources(db, projectId, "hashtags");
        scrapeResult = await scrapeTiktok(token!, projectConfig, sources, hashtagSources, maxSources, abortCtx);
        break;
      }
      case "reddit":
        scrapeResult = await scrapeReddit(token!, projectConfig, sources, maxSources, abortCtx);
        break;
      case "facebook":
        scrapeResult = await scrapeFacebook(token!, projectConfig, sources, maxSources, abortCtx);
        break;
    }
  }

  const sheetName = SCRAPER_OUTPUT_SHEETS[scraperKey]!;
  return {
    rows: rowsToEvidence(sheetName, scrapeResult.payloads),
    apifyRuns: apifyRunRefs(scraperKey, scrapeResult.apifyRunIds),
  };
}

export interface InputsScraperRunResult {
  scraper_run_id: string;
  evidence_import_id: string;
  total_rows: number;
  scrapers_run: string[];
  rows_by_scraper: Record<string, number>;
  apify_runs?: ScraperApifyRunRef[];
}

async function executeInputsScraperRunCore(
  db: Pool,
  config: AppConfig,
  projectId: string,
  runId: string,
  scraperKey: ScraperKey,
  projectConfig: ScraperProjectConfig,
  maxSources: number | null,
  runOpts?: RunInputsScraperOptions
): Promise<InputsScraperRunResult> {
  const abortContext: ScraperAbortContext = runOpts?.abortContext ?? {
    projectId,
    cafRunId: runId,
  };
  const optsWithAbort: RunInputsScraperOptions = { ...runOpts, abortContext };

  await updateScraperRun(db, runId, projectId, { status: "running", started_at: true });
  checkScraperAbort(abortContext);

  const keys: Array<Exclude<ScraperKey, "all">> = runOpts?.platforms?.length
    ? runOpts.platforms
    : scraperKey === "all"
      ? ["instagram", "tiktok", "html", "facebook", "reddit"]
      : [scraperKey];

  const allRows: ParsedInputsEvidenceRow[] = [];
  const rowsByScraper: Record<string, number> = {};
  const scrapersRun: string[] = [];
  const apifyRuns: ScraperApifyRunRef[] = [];

  for (const key of keys) {
    checkScraperAbort(abortContext);
    const cfg = projectConfig.scrapers?.[key];
    const forced = runOpts?.platforms?.includes(key);
    if (cfg?.enabled === false && !forced) continue;
    try {
      const result = await runOneScraper(db, config, projectId, key, projectConfig, optsWithAbort);
      allRows.push(...result.rows);
      apifyRuns.push(...result.apifyRuns);
      rowsByScraper[key] = result.rows.length;
      scrapersRun.push(key);
      logPipelineEvent("info", "other", `inputs scraper ${key} completed`, {
        data: { row_count: result.rows.length },
      });
    } catch (e) {
      if (isAbortError(e)) throw e;
      const msg = e instanceof Error ? e.message : String(e);
      logPipelineEvent("warn", "other", `inputs scraper ${key} skipped`, { data: { error: msg } });
      rowsByScraper[key] = 0;
    }
  }

  if (allRows.length === 0) {
    throw new Error("No scraper produced rows (check sources, APIFY_API_TOKEN, and scraper config)");
  }

  const label =
    scraperKey === "all"
      ? `scraper-all-${new Date().toISOString().slice(0, 10)}.xlsx`
      : `scraper-${scraperKey}-${new Date().toISOString().slice(0, 10)}.xlsx`;

  checkScraperAbort(abortContext);
  const preComplete = await getScraperRun(db, projectId, runId);
  if (preComplete?.status === "cancelled") {
    throw new ScraperRunAbortedError();
  }

  const { importId, totalRows } = await persistEvidenceImport(db, projectId, {
    filename: label,
    notes: `Apify/Core scraper run ${runId}`,
    rows: allRows,
    scraperRunId: runId,
  });

  const stillActive = await getScraperRun(db, projectId, runId);
  if (stillActive?.status === "cancelled") {
    throw new ScraperRunAbortedError();
  }

  await updateScraperRun(db, runId, projectId, {
    status: "completed",
    finished_at: true,
    evidence_import_id: importId,
    stats_json: {
      total_rows: totalRows,
      scrapers_run: scrapersRun,
      rows_by_scraper: rowsByScraper,
      apify_runs: apifyRuns,
      max_sources: maxSources,
    },
  });

  return {
    scraper_run_id: runId,
    evidence_import_id: importId,
    total_rows: totalRows,
    scrapers_run: scrapersRun,
    rows_by_scraper: rowsByScraper,
    apify_runs: apifyRuns,
  };
}

/** Background worker for API — registers run, executes, handles abort/failure cleanup. */
export async function executeInputsScraperRun(
  db: Pool,
  config: AppConfig,
  projectId: string,
  runId: string,
  scraperKey: ScraperKey,
  runOpts?: RunInputsScraperOptions
): Promise<void> {
  const existing = await getScraperRun(db, projectId, runId);
  if (!existing || existing.status === "cancelled") return;

  registerScraperRun(projectId, runId);
  const stored = await getScraperConfig(db, projectId);
  let projectConfig = mergeScraperConfig(stored?.config_json);
  if (runOpts?.postMaxAgeDays != null && runOpts.postMaxAgeDays > 0) {
    projectConfig = applyPostMaxAgeToConfig(projectConfig, runOpts.postMaxAgeDays, runOpts.platforms);
  }
  const maxSources =
    runOpts?.maxSources != null && runOpts.maxSources > 0 ? Math.floor(runOpts.maxSources) : null;

  try {
    checkScraperAbort({ projectId, cafRunId: runId });
    await executeInputsScraperRunCore(
      db,
      config,
      projectId,
      runId,
      scraperKey,
      projectConfig,
      maxSources,
      { ...runOpts, abortContext: { projectId, cafRunId: runId } }
    );
  } catch (e) {
    if (isAbortError(e)) {
      const current = await getScraperRun(db, projectId, runId);
      if (current?.status === "running" || current?.status === "pending") {
        await updateScraperRun(db, runId, projectId, {
          status: "cancelled",
          finished_at: true,
          error_message: "Aborted by operator",
        });
      }
      return;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const current = await getScraperRun(db, projectId, runId);
    if (current?.status === "running" || current?.status === "pending") {
      await updateScraperRun(db, runId, projectId, {
        status: "failed",
        finished_at: true,
        error_message: msg,
      });
    }
    logPipelineEvent("error", "other", "inputs scraper run failed", {
      data: { scraper_run_id: runId, error: msg },
    });
  } finally {
    clearScraperRun(projectId, runId);
  }
}

/** Start a scraper run and return immediately (work continues in background). */
export async function startInputsScraperRun(
  db: Pool,
  config: AppConfig,
  projectId: string,
  scraperKey: ScraperKey,
  runOpts?: RunInputsScraperOptions
): Promise<{ scraper_run_id: string; status: "running" }> {
  const stored = await getScraperConfig(db, projectId);
  const projectConfig = mergeScraperConfig(stored?.config_json);
  const maxSources =
    runOpts?.maxSources != null && runOpts.maxSources > 0 ? Math.floor(runOpts.maxSources) : null;

  const runRow = await insertScraperRun(db, {
    project_id: projectId,
    scraper_key: scraperKey,
    config_snapshot_json: {
      ...(projectConfig as unknown as Record<string, unknown>),
      run_options: {
        max_sources: maxSources,
        platforms: runOpts?.platforms,
        post_max_age_days: runOpts?.postMaxAgeDays,
        started_at: new Date().toISOString(),
      },
    },
  });

  void executeInputsScraperRun(db, config, projectId, runRow.id, scraperKey, runOpts);

  return { scraper_run_id: runRow.id, status: "running" };
}

export async function abortInputsScraperRun(
  db: Pool,
  config: AppConfig,
  projectId: string,
  runId: string
): Promise<{ ok: true; apify_aborted: number } | { ok: false; error: string }> {
  const run = await getScraperRun(db, projectId, runId);
  if (!run) return { ok: false, error: "not_found" };
  if (run.status !== "running" && run.status !== "pending") {
    return { ok: false, error: "not_running" };
  }

  const apifyIds = requestScraperRunAbort(projectId, runId);
  const token = config.APIFY_API_TOKEN?.trim();
  let apifyAborted = 0;
  if (hasApifyToken(token)) {
    for (const apifyRunId of apifyIds) {
      try {
        await abortApifyRun(token!, apifyRunId);
        apifyAborted++;
      } catch {
        /* best-effort */
      }
    }
  }

  if (!isScraperRunActive(projectId, runId)) {
    const current = await getScraperRun(db, projectId, runId);
    if (current?.status === "running" || current?.status === "pending") {
      await updateScraperRun(db, runId, projectId, {
        status: "cancelled",
        finished_at: true,
        error_message: "Aborted by operator",
      });
    }
  }

  return { ok: true, apify_aborted: apifyAborted };
}

/** Synchronous run (CLI) — blocks until finished. */
export async function runInputsScraper(
  db: Pool,
  config: AppConfig,
  projectId: string,
  scraperKey: ScraperKey,
  runOpts?: RunInputsScraperOptions
): Promise<InputsScraperRunResult> {
  const stored = await getScraperConfig(db, projectId);
  const projectConfig = mergeScraperConfig(stored?.config_json);
  const maxSources =
    runOpts?.maxSources != null && runOpts.maxSources > 0 ? Math.floor(runOpts.maxSources) : null;

  const runRow = await insertScraperRun(db, {
    project_id: projectId,
    scraper_key: scraperKey,
    config_snapshot_json: {
      ...(projectConfig as unknown as Record<string, unknown>),
      run_options: {
        max_sources: maxSources,
        platforms: runOpts?.platforms,
        post_max_age_days: runOpts?.postMaxAgeDays,
        started_at: new Date().toISOString(),
      },
    },
  });

  registerScraperRun(projectId, runRow.id);
  try {
    return await executeInputsScraperRunCore(
      db,
      config,
      projectId,
      runRow.id,
      scraperKey,
      projectConfig,
      maxSources,
      { ...runOpts, abortContext: { projectId, cafRunId: runRow.id } }
    );
  } catch (e) {
    if (isAbortError(e)) {
      await updateScraperRun(db, runRow.id, projectId, {
        status: "cancelled",
        finished_at: true,
        error_message: "Aborted by operator",
      });
      throw e;
    }
    const msg = e instanceof Error ? e.message : String(e);
    const current = await getScraperRun(db, projectId, runRow.id);
    if (current?.status === "running" || current?.status === "pending") {
      await updateScraperRun(db, runRow.id, projectId, {
        status: "failed",
        finished_at: true,
        error_message: msg,
      });
    }
    throw e;
  } finally {
    clearScraperRun(projectId, runRow.id);
  }
}

export async function getProjectScraperConfig(
  db: Pool,
  projectId: string
): Promise<ScraperProjectConfig> {
  const stored = await getScraperConfig(db, projectId);
  return mergeScraperConfig(stored?.config_json);
}
