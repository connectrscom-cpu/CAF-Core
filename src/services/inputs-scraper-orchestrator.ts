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
  apifyWaitSec,
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
import { getApifyDatasetItems, hasApifyToken, runApifyActor } from "./apify-client.js";
import { logPipelineEvent } from "./pipeline-logger.js";

export const SCRAPER_KEYS = ["instagram", "tiktok", "html", "facebook", "reddit", "all"] as const;
export type ScraperKey = (typeof SCRAPER_KEYS)[number];

export { defaultScraperConfig, mergeScraperConfig, type ScraperProjectConfig };

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
  cfg: ScraperProjectConfig,
  sources: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const prepared = prepareInstagramSources(sources);
  const ig = cfg.scrapers?.instagram ?? {};
  const actorId = resolveActorId("instagram", ig);
  const wait = apifyWaitSec(cfg);
  const limit = datasetLimitFor(cfg, "instagram");
  const out: Record<string, unknown>[] = [];

  if (ig.runMode === "batch") {
    const urls = prepared.map((s) => String(s.instagramUrl ?? "")).filter(Boolean);
    if (urls.length === 0) return [];
    const run = await runApifyActor(token, actorId, buildInstagramApifyInput(cfg, urls), { waitForFinishSec: wait });
    const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit });
    const ctx = prepared[0] ?? {};
    for (const item of items) out.push(transformInstagramApifyPost(item, ctx));
    return out;
  }

  for (const src of prepared) {
    const url = String(src.instagramUrl ?? "");
    if (!url) continue;
    const run = await runApifyActor(token, actorId, buildInstagramApifyInput(cfg, [url]), {
      waitForFinishSec: wait,
    });
    const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit });
    for (const item of items) out.push(transformInstagramApifyPost(item, src));
  }
  return out;
}

async function scrapeTiktok(
  token: string,
  cfg: ScraperProjectConfig,
  sources: Record<string, unknown>[],
  hashtagSources: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const profiles = tiktokProfilesFromSources(sources);
  const tt = cfg.scrapers?.tiktok ?? {};
  const extraProfiles = parseHashtagList(
    Array.isArray(tt.extraProfiles) ? tt.extraProfiles.join("\n") : String(tt.extraProfiles ?? "")
  );
  const extraHashtags = parseHashtagList(
    Array.isArray(tt.extraHashtags) ? tt.extraHashtags.join("\n") : String(tt.extraHashtags ?? "")
  );
  const useSourceHashtags = tt.useHashtagsFromSources !== false && hashtagSources.length > 0;
  if (profiles.length === 0 && extraProfiles.length === 0 && !useSourceHashtags && extraHashtags.length === 0) {
    return [];
  }

  const actorId = resolveActorId("tiktok", tt);
  const wait = apifyWaitSec(cfg);
  const limit = datasetLimitFor(cfg, "tiktok");
  const input = buildTiktokApifyInput(cfg, profiles, hashtagSources);
  if (!Array.isArray(input.profiles) || (input.profiles as string[]).length === 0) {
    if (!Array.isArray(input.hashtags) || (input.hashtags as string[]).length === 0) {
      return [];
    }
  }

  const run = await runApifyActor(token, actorId, input, { waitForFinishSec: wait });
  const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit });
  const out: Record<string, unknown>[] = [];
  for (const item of items) {
    const row = transformTiktokApifyItem(item);
    if (row) out.push(row);
  }
  return out;
}

async function scrapeReddit(
  token: string,
  cfg: ScraperProjectConfig,
  sources: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const links = subredditLinksFromSources(sources);
  if (links.length === 0) return [];
  const rd = cfg.scrapers?.reddit ?? {};
  const actorId = resolveActorId("reddit", rd);
  const wait = apifyWaitSec(cfg);
  const limit = datasetLimitFor(cfg, "reddit");
  const input = buildRedditApifyInputFromConfig(cfg, links);
  const run = await runApifyActor(token, actorId, input, { waitForFinishSec: wait });
  const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit });
  return transformRedditApifyDataset(items);
}

async function scrapeFacebook(
  token: string,
  cfg: ScraperProjectConfig,
  sources: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const urls = facebookUrlsFromSources(sources);
  if (urls.length === 0) return [];
  const fb = cfg.scrapers?.facebook ?? {};
  const actorId = resolveActorId("facebook", fb);
  const wait = apifyWaitSec(cfg);
  const limit = datasetLimitFor(cfg, "facebook");
  const filterOpts = { minLikes: fb.minLikes ?? 5, requireCaption: fb.requireCaption !== false };
  const out: Record<string, unknown>[] = [];
  for (const startUrl of urls) {
    const run = await runApifyActor(token, actorId, buildFacebookApifyInput(cfg, startUrl), {
      waitForFinishSec: wait,
    });
    const items = await getApifyDatasetItems<Record<string, unknown>>(token, run.defaultDatasetId, { limit });
    for (const item of items) {
      const row = transformFacebookApifyPost(item, filterOpts);
      if (row) out.push(row);
    }
  }
  return out;
}

async function scrapeHtml(
  cfg: ScraperProjectConfig,
  sources: Record<string, unknown>[]
): Promise<Record<string, unknown>[]> {
  const htmlCfg = cfg.scrapers?.html ?? {};
  const sites = enabledWebsiteSources(sources);
  const timeout = htmlCfg.fetchTimeoutMs ?? 30_000;
  const ua = htmlCfg.userAgent ?? "Mozilla/5.0 (compatible; CAF-Core/1.0; +https://caf.local)";
  const out: Record<string, unknown>[] = [];

  for (const site of sites) {
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
  if (sources.length === 0 && scraperKey !== "tiktok") {
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
      case "tiktok": {
        const hashtagSources = await loadEnabledSources(db, projectId, "hashtags");
        payloads = await scrapeTiktok(token!, projectConfig, sources, hashtagSources);
        break;
      }
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
