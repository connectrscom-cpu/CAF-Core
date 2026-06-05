/**
 * Rough Apify cost / run-count estimates for Admin scraper runs.
 * Billing is always authoritative on Apify Console — these are planning hints only.
 */
import type { Pool } from "pg";
import { getScraperConfig, listSourceRows } from "../repositories/inputs-sources.js";
import type { ScraperKey } from "./inputs-scraper-orchestrator.js";
import {
  mergeScraperConfig,
  type ScraperProjectConfig,
} from "./inputs-scraper-apify-config.js";
import {
  enabledWebsiteSources,
  facebookUrlsFromSources,
  prepareInstagramSources,
  subredditLinksFromSources,
  tiktokProfilesFromSources,
} from "./inputs-scraper-transforms.js";

/** USD per Apify actor run — conservative ballparks for SNS-scale scrapes. */
export const APIFY_RUN_COST_USD = {
  instagram_per_account: { min: 0.015, max: 0.045, mid: 0.028 },
  instagram_batch: { min: 0.04, max: 0.12, mid: 0.07 },
  tiktok: { min: 0.08, max: 0.22, mid: 0.13 },
  reddit: { min: 0.04, max: 0.1, mid: 0.06 },
  facebook_per_page: { min: 0.025, max: 0.07, mid: 0.04 },
  html: { min: 0, max: 0, mid: 0 },
} as const;

export const SCRAPER_COST_DISCLAIMER =
  "Rough estimate from average Apify actor run cost. Actual usage is billed on Apify Console.";

export function applySourceCap<T>(items: T[], maxSources?: number | null): T[] {
  if (maxSources == null || maxSources <= 0) return items;
  return items.slice(0, Math.floor(maxSources));
}

export interface ScraperRunEstimateLine {
  scraper_key: string;
  enabled: boolean;
  enabled_sources: number;
  sources_after_cap: number;
  max_sources: number | null;
  apify_runs_estimated: number;
  run_mode: string | null;
  cost_estimate_usd: { min: number; max: number; mid: number };
}

export interface ScraperRunEstimateResult {
  scraper: ScraperKey | "preview";
  max_sources: number | null;
  lines: ScraperRunEstimateLine[];
  totals: {
    apify_runs_estimated: number;
    cost_estimate_usd: { min: number; max: number; mid: number };
  };
  disclaimer: string;
}

function sumCost(lines: ScraperRunEstimateLine[]): { min: number; max: number; mid: number } {
  return lines.reduce(
    (acc, line) => ({
      min: acc.min + line.cost_estimate_usd.min,
      max: acc.max + line.cost_estimate_usd.max,
      mid: acc.mid + line.cost_estimate_usd.mid,
    }),
    { min: 0, max: 0, mid: 0 }
  );
}

function roundUsd(n: number): number {
  return Math.round(n * 100) / 100;
}

function scaleCost(
  tier: { min: number; max: number; mid: number },
  runs: number
): { min: number; max: number; mid: number } {
  return {
    min: roundUsd(tier.min * runs),
    max: roundUsd(tier.max * runs),
    mid: roundUsd(tier.mid * runs),
  };
}

export function estimateScraperLine(
  scraperKey: Exclude<ScraperKey, "all">,
  projectConfig: ScraperProjectConfig,
  sources: Record<string, unknown>[],
  hashtagSources: Record<string, unknown>[],
  maxSources?: number | null
): ScraperRunEstimateLine {
  const cfg = projectConfig.scrapers?.[scraperKey];
  const enabled = cfg?.enabled !== false;
  const cap = maxSources != null && maxSources > 0 ? Math.floor(maxSources) : null;

  if (!enabled) {
    return {
      scraper_key: scraperKey,
      enabled: false,
      enabled_sources: 0,
      sources_after_cap: 0,
      max_sources: cap,
      apify_runs_estimated: 0,
      run_mode: null,
      cost_estimate_usd: { min: 0, max: 0, mid: 0 },
    };
  }

  switch (scraperKey) {
    case "instagram": {
      const prepared = prepareInstagramSources(sources);
      const capped = applySourceCap(prepared, cap);
      const runMode = projectConfig.scrapers?.instagram?.runMode ?? "per_account";
      const runs = runMode === "batch" ? (capped.length > 0 ? 1 : 0) : capped.length;
      const tier =
        runMode === "batch"
          ? APIFY_RUN_COST_USD.instagram_batch
          : APIFY_RUN_COST_USD.instagram_per_account;
      return {
        scraper_key: scraperKey,
        enabled: true,
        enabled_sources: prepared.length,
        sources_after_cap: capped.length,
        max_sources: cap,
        apify_runs_estimated: runs,
        run_mode: runMode,
        cost_estimate_usd: scaleCost(tier, runs),
      };
    }
    case "tiktok": {
      const profiles = tiktokProfilesFromSources(sources);
      const cappedProfiles = applySourceCap(profiles, cap);
      const tt = projectConfig.scrapers?.tiktok ?? {};
      const useHashtags = tt.useHashtagsFromSources !== false && hashtagSources.length > 0;
      const hasWork =
        cappedProfiles.length > 0 ||
        useHashtags ||
        (tt.extraProfiles?.length ?? 0) > 0 ||
        (tt.extraHashtags?.length ?? 0) > 0;
      const runs = hasWork ? 1 : 0;
      return {
        scraper_key: scraperKey,
        enabled: true,
        enabled_sources: profiles.length,
        sources_after_cap: cappedProfiles.length,
        max_sources: cap,
        apify_runs_estimated: runs,
        run_mode: "single_actor",
        cost_estimate_usd: scaleCost(APIFY_RUN_COST_USD.tiktok, runs),
      };
    }
    case "reddit": {
      const links = subredditLinksFromSources(sources);
      const capped = applySourceCap(links, cap);
      const runs = capped.length > 0 ? 1 : 0;
      return {
        scraper_key: scraperKey,
        enabled: true,
        enabled_sources: links.length,
        sources_after_cap: capped.length,
        max_sources: cap,
        apify_runs_estimated: runs,
        run_mode: "single_actor",
        cost_estimate_usd: scaleCost(APIFY_RUN_COST_USD.reddit, runs),
      };
    }
    case "facebook": {
      const urls = facebookUrlsFromSources(sources);
      const capped = applySourceCap(urls, cap);
      const runs = capped.length;
      return {
        scraper_key: scraperKey,
        enabled: true,
        enabled_sources: urls.length,
        sources_after_cap: capped.length,
        max_sources: cap,
        apify_runs_estimated: runs,
        run_mode: "per_page",
        cost_estimate_usd: scaleCost(APIFY_RUN_COST_USD.facebook_per_page, runs),
      };
    }
    case "html": {
      const sites = enabledWebsiteSources(sources);
      const capped = applySourceCap(sites, cap);
      return {
        scraper_key: scraperKey,
        enabled: true,
        enabled_sources: sites.length,
        sources_after_cap: capped.length,
        max_sources: cap,
        apify_runs_estimated: 0,
        run_mode: "http",
        cost_estimate_usd: { min: 0, max: 0, mid: 0 },
      };
    }
  }
}

const SOURCE_TAB: Record<Exclude<ScraperKey, "all">, string> = {
  instagram: "igaccounts",
  tiktok: "tiktokaccounts",
  html: "websites_blogs",
  facebook: "facebook",
  reddit: "subreddits",
};

async function loadEnabledSourcePayloads(
  db: Pool,
  projectId: string,
  tab: string
): Promise<Record<string, unknown>[]> {
  const rows = await listSourceRows(db, projectId, tab);
  return rows.filter((r) => r.enabled).map((r) => r.payload_json);
}

export async function estimateInputsScraperRun(
  db: Pool,
  projectId: string,
  scraperKey: ScraperKey,
  maxSources?: number | null
): Promise<ScraperRunEstimateResult> {
  const stored = await getScraperConfig(db, projectId);
  const projectConfig = mergeScraperConfig(stored?.config_json);
  const cap = maxSources != null && maxSources > 0 ? Math.floor(maxSources) : null;
  const hashtagSources = await loadEnabledSourcePayloads(db, projectId, "hashtags");

  const keys: Array<Exclude<ScraperKey, "all">> =
    scraperKey === "all"
      ? ["instagram", "tiktok", "html", "facebook", "reddit"]
      : [scraperKey];

  const lines: ScraperRunEstimateLine[] = [];
  for (const key of keys) {
    const tab = SOURCE_TAB[key];
    const sources = await loadEnabledSourcePayloads(db, projectId, tab);
    lines.push(estimateScraperLine(key, projectConfig, sources, hashtagSources, cap));
  }

  const activeLines = lines.filter((l) => l.enabled && l.sources_after_cap > 0);
  return {
    scraper: scraperKey,
    max_sources: cap,
    lines,
    totals: {
      apify_runs_estimated: activeLines.reduce((n, l) => n + l.apify_runs_estimated, 0),
      cost_estimate_usd: sumCost(activeLines),
    },
    disclaimer: SCRAPER_COST_DISCLAIMER,
  };
}
