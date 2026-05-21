/**
 * Run INPUTS scrapers via Apify / HTTP and persist results as inputs_evidence_imports.
 */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  getScraperConfig,
  insertScraperRun,
  listSourceRows,
  updateScraperRun,
} from "../repositories/inputs-sources.js";
import {
  insertInputsEvidenceImport,
  insertInputsEvidenceRowsBatch,
} from "../repositories/inputs-evidence.js";
import { insertEvidenceMediaAssetsPending } from "../repositories/inputs-evidence-media.js";
import { computeInputHealth, flagSparseEvidenceRows, persistImportHealth } from "./input-health.js";
import { normalizeGenericVideoEvidenceMedia } from "./inputs-evidence-media-normalizer.js";
import { isVideoLikeEvidence } from "./inputs-image-url-for-analysis.js";
import { normalizeInstagramEvidenceMedia, enrichInstagramApifyPayloadInPlace } from "./instagram-media-normalizer.js";
import {
  computeDedupeKey,
  sheetNameToEvidenceKind,
  type ParsedInputsEvidenceRow,
} from "./inputs-sns-workbook-parser.js";
import { SCRAPER_OUTPUT_SHEETS } from "./inputs-source-sync.js";
import {
  buildRedditApifyInput,
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
import { getApifyDatasetItems, hasApifyToken, runApifyActor } from "./apify-client.js";
import { logPipelineEvent } from "./pipeline-logger.js";

export const SCRAPER_KEYS = ["instagram", "tiktok", "html", "facebook", "reddit", "all"] as const;
export type ScraperKey = (typeof SCRAPER_KEYS)[number];

const ACTORS = {
  instagram: "shu8hvrXbJbY3Eb9W",
  tiktok: "GdWCkxBtKWOsKjdch",
  facebook: "KoJrdxJCTtpon81KY",
  reddit: "oAuCIx3ItNrs2okjQ",
} as const;

export interface ScraperProjectConfig {
  scrapers?: Record<
    string,
    {
      enabled?: boolean;
      resultsLimit?: number;
      oldestPostDateUnified?: string;
      resultsPerPage?: number;
      minLikes?: number;
      maxPostCount?: number;
      maxComments?: number;
      fetchTimeoutMs?: number;
    }
  >;
  apify?: { useApifyProxy?: boolean; proxyCountryCode?: string };
  tiktokVideoKvStore?: string;
}

export function defaultScraperConfig(): ScraperProjectConfig {
  return {
    scrapers: {
      instagram: { enabled: true, resultsLimit: 10 },
      tiktok: { enabled: true, oldestPostDateUnified: "7 days", resultsPerPage: 10 },
      html: { enabled: true, fetchTimeoutMs: 30_000 },
      facebook: { enabled: true, minLikes: 5 },
      reddit: { enabled: true, maxPostCount: 30, maxComments: 3 },
    },
    apify: { useApifyProxy: true, proxyCountryCode: "US" },
    tiktokVideoKvStore: "caf-tiktok-astrology-media",
  };
}

export function mergeScraperConfig(stored: Record<string, unknown> | null | undefined): ScraperProjectConfig {
  const base = defaultScraperConfig();
  if (!stored || typeof stored !== "object") return base;
  const scrapers = { ...base.scrapers, ...(stored.scrapers as Record<string, unknown> | undefined) };
  return {
    ...base,
    ...stored,
    scrapers: scrapers as ScraperProjectConfig["scrapers"],
    apify: { ...base.apify, ...(stored.apify as Record<string, unknown> | undefined) },
  };
}

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

  const sheetCounts = new Map<string, number>();
  for (const r of opts.rows) {
    sheetCounts.set(r.sheet_name, (sheetCounts.get(r.sheet_name) ?? 0) + 1);
  }
  const sheets = [...sheetCounts.entries()].map(([sheet_name, row_count]) => ({
    sheet_name,
    evidence_kind: sheetNameToEvidenceKind(sheet_name),
    row_count,
    truncated: false,
    columns: Object.keys(opts.rows.find((x) => x.sheet_name === sheet_name)?.payload_json ?? {}),
  }));

  const sheet_stats_json = {
    version: 1,
    source: "scraper",
    scraper_run_id: opts.scraperRunId,
    sheets,
    total_rows: opts.rows.length,
    workbook_sha256,
  };

  const imp = await insertInputsEvidenceImport(db, {
    project_id: projectId,
    upload_filename: opts.filename,
    workbook_sha256,
    sheet_stats_json,
    notes: opts.notes,
  });

  const BATCH = 250;
  for (let i = 0; i < opts.rows.length; i += BATCH) {
    const slice = opts.rows.slice(i, i + BATCH);
    const rowIds = await insertInputsEvidenceRowsBatch(db, projectId, imp.id, slice);
    for (let j = 0; j < slice.length; j++) {
      const payload = slice[j]!.payload_json;
      if (slice[j]!.evidence_kind === "instagram_post") {
        const norm = normalizeInstagramEvidenceMedia(payload);
        if (norm.media_assets.length > 0) {
          await insertEvidenceMediaAssetsPending(
            db,
            projectId,
            rowIds[j]!,
            norm.post_url,
            norm.post_id,
            norm.owner_username,
            norm.media_assets,
            "instagram"
          );
        }
      } else if (
        slice[j]!.evidence_kind === "tiktok_video" ||
        (slice[j]!.evidence_kind === "facebook_post" && isVideoLikeEvidence(slice[j]!.evidence_kind, payload))
      ) {
        const norm = normalizeGenericVideoEvidenceMedia(slice[j]!.evidence_kind, payload);
        if (norm && norm.media_assets.length > 0) {
          await insertEvidenceMediaAssetsPending(
            db,
            projectId,
            rowIds[j]!,
            norm.post_url,
            norm.post_id,
            norm.owner_username,
            norm.media_assets,
            norm.source_platform
          );
        }
      }
    }
  }

  const health = await computeInputHealth(db, projectId, imp.id, sheet_stats_json);
  await persistImportHealth(db, projectId, imp.id, health);
  await flagSparseEvidenceRows(db, projectId, imp.id);

  return { importId: imp.id, totalRows: opts.rows.length };
}

async function scrapeInstagram(
  token: string,
  config: ScraperProjectConfig,
  sources: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const prepared = prepareInstagramSources(sources);
  const limit = config.scrapers?.instagram?.resultsLimit ?? 10;
  const out: Record<string, unknown>[] = [];

  for (const src of prepared) {
    const url = String(src.instagramUrl ?? "");
    if (!url) continue;
    const run = await runApifyActor(token, ACTORS.instagram, {
      directUrls: [url],
      resultsType: "posts",
      resultsLimit: limit,
      scrapePosts: true,
      scrapeReels: true,
      scrapeStories: false,
      proxyConfiguration: { useApifyProxy: config.apify?.useApifyProxy !== false },
    });
    const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit: 500 });
    for (const item of items) {
      out.push(transformInstagramApifyPost(item, src));
    }
  }
  return out;
}

async function scrapeTiktok(
  token: string,
  config: ScraperProjectConfig,
  sources: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const profiles = tiktokProfilesFromSources(sources);
  if (profiles.length === 0) return [];

  const run = await runApifyActor(token, ACTORS.tiktok, {
    commentsPerPost: 0,
    excludePinnedPosts: false,
    maxFollowersPerProfile: 0,
    maxFollowingPerProfile: 0,
    maxRepliesPerComment: 0,
    oldestPostDateUnified: config.scrapers?.tiktok?.oldestPostDateUnified ?? "7 days",
    profileScrapeSections: ["videos"],
    profileSorting: "latest",
    profiles,
    proxyCountryCode: config.apify?.proxyCountryCode ?? "US",
    resultsPerPage: config.scrapers?.tiktok?.resultsPerPage ?? 10,
    scrapeRelatedVideos: false,
    shouldDownloadAvatars: false,
    shouldDownloadCovers: true,
    shouldDownloadMusicCovers: false,
    shouldDownloadSlideshowImages: true,
    shouldDownloadVideos: true,
    videoKvStoreIdOrName: config.tiktokVideoKvStore ?? "caf-tiktok-astrology-media",
    downloadSubtitlesOptions: "DOWNLOAD_AND_TRANSCRIBE_VIDEOS_WITHOUT_SUBTITLES",
    maxProfilesPerQuery: 10,
  });

  const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit: 2000 });
  const out: Record<string, unknown>[] = [];
  for (const item of items) {
    const row = transformTiktokApifyItem(item);
    if (row) out.push(row);
  }
  return out;
}

async function scrapeReddit(
  token: string,
  config: ScraperProjectConfig,
  sources: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const links = subredditLinksFromSources(sources);
  if (links.length === 0) return [];
  const input = buildRedditApifyInput(links);
  if (config.scrapers?.reddit?.maxPostCount != null) {
    input.maxPostCount = config.scrapers.reddit.maxPostCount;
  }
  if (config.scrapers?.reddit?.maxComments != null) {
    input.maxComments = config.scrapers.reddit.maxComments;
  }
  const run = await runApifyActor(token, ACTORS.reddit, input);
  const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit: 5000 });
  return transformRedditApifyDataset(items);
}

async function scrapeFacebook(
  token: string,
  _config: ScraperProjectConfig,
  sources: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const urls = facebookUrlsFromSources(sources);
  if (urls.length === 0) return [];
  const out: Record<string, unknown>[] = [];
  for (const startUrl of urls) {
    const run = await runApifyActor(token, ACTORS.facebook, {
      startUrls: [{ url: startUrl }],
      resultsLimit: 30,
      proxyConfiguration: { useApifyProxy: true },
    });
    const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit: 500 });
    for (const item of items) {
      const row = transformFacebookApifyPost(item);
      if (row) out.push(row);
    }
  }
  return out;
}

async function scrapeHtml(
  config: ScraperProjectConfig,
  sources: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const sites = enabledWebsiteSources(sources);
  const timeout = config.scrapers?.html?.fetchTimeoutMs ?? 30_000;
  const out: Record<string, unknown>[] = [];

  for (const site of sites) {
    try {
      const res = await fetch(site.url, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CAF-Core/1.0; +https://caf.local)" },
        signal: AbortSignal.timeout(timeout),
      });
      if (!res.ok) continue;
      const html = await res.text();
      out.push(transformHtmlFetch(html, { url: site.url, sourceName: site.name }));
    } catch (e) {
      logPipelineEvent("warn", "other", "inputs scraper html fetch failed", {
        data: { url: site.url, error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
  return out;
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
  projectConfig: ScraperProjectConfig
): Promise<ParsedInputsEvidenceRow[]> {
  const tab = SCRAPER_SOURCE_TAB[scraperKey];
  const sources = await loadEnabledSources(db, projectId, tab);
  if (sources.length === 0) {
    throw new Error(`No enabled sources in ${tab}`);
  }

  const scraperCfg = projectConfig.scrapers?.[scraperKey];
  if (scraperCfg?.enabled === false) {
    throw new Error(`Scraper ${scraperKey} is disabled in config`);
  }

  let payloads: Record<string, unknown>[] = [];
  if (scraperKey === "html") {
    payloads = await scrapeHtml(projectConfig, sources);
  } else {
    const token = config.APIFY_API_TOKEN?.trim();
    if (!hasApifyToken(token)) throw new Error("APIFY_API_TOKEN not configured");
    switch (scraperKey) {
      case "instagram":
        payloads = await scrapeInstagram(token!, projectConfig, sources);
        break;
      case "tiktok":
        payloads = await scrapeTiktok(token!, projectConfig, sources);
        break;
      case "reddit":
        payloads = await scrapeReddit(token!, projectConfig, sources);
        break;
      case "facebook":
        payloads = await scrapeFacebook(token!, projectConfig, sources);
        break;
    }
  }

  const sheetName = SCRAPER_OUTPUT_SHEETS[scraperKey]!;
  return rowsToEvidence(sheetName, payloads);
}

export async function runInputsScraper(
  db: Pool,
  config: AppConfig,
  projectId: string,
  scraperKey: ScraperKey
): Promise<{
  scraper_run_id: string;
  evidence_import_id: string;
  total_rows: number;
  scrapers_run: string[];
  rows_by_scraper: Record<string, number>;
}> {
  const stored = await getScraperConfig(db, projectId);
  const projectConfig = mergeScraperConfig(stored?.config_json);

  const runRow = await insertScraperRun(db, {
    project_id: projectId,
    scraper_key: scraperKey,
    config_snapshot_json: projectConfig as unknown as Record<string, unknown>,
  });

  await updateScraperRun(db, runRow.id, projectId, { status: "running", started_at: true });

  try {
    const keys: Array<Exclude<ScraperKey, "all">> =
      scraperKey === "all" ? ["instagram", "tiktok", "html", "facebook", "reddit"] : [scraperKey];

    const allRows: ParsedInputsEvidenceRow[] = [];
    const rowsByScraper: Record<string, number> = {};
    const scrapersRun: string[] = [];

    for (const key of keys) {
      const cfg = projectConfig.scrapers?.[key];
      if (cfg?.enabled === false) continue;
      try {
        const rows = await runOneScraper(db, config, projectId, key, projectConfig);
        allRows.push(...rows);
        rowsByScraper[key] = rows.length;
        scrapersRun.push(key);
        logPipelineEvent("info", "other", `inputs scraper ${key} completed`, {
          data: { row_count: rows.length },
        });
      } catch (e) {
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

    const { importId, totalRows } = await persistEvidenceImport(db, projectId, {
      filename: label,
      notes: `Apify/Core scraper run ${runRow.id}`,
      rows: allRows,
      scraperRunId: runRow.id,
    });

    await updateScraperRun(db, runRow.id, projectId, {
      status: "completed",
      finished_at: true,
      evidence_import_id: importId,
      stats_json: { total_rows: totalRows, scrapers_run: scrapersRun, rows_by_scraper: rowsByScraper },
    });

    return {
      scraper_run_id: runRow.id,
      evidence_import_id: importId,
      total_rows: totalRows,
      scrapers_run: scrapersRun,
      rows_by_scraper: rowsByScraper,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await updateScraperRun(db, runRow.id, projectId, {
      status: "failed",
      finished_at: true,
      error_message: msg,
    });
    throw e;
  }
}

export async function getProjectScraperConfig(
  db: Pool,
  projectId: string
): Promise<ScraperProjectConfig> {
  const stored = await getScraperConfig(db, projectId);
  return mergeScraperConfig(stored?.config_json);
}
