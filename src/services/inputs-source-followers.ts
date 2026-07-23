/**
 * Persist scraped follower counts onto project source rows and load them for relative scoring.
 */
import type { Pool } from "pg";
import {
  buildRegistryFollowerLookup,
  extractFollowerCount,
  extractSocialAccountHandle,
  handlesFromSourceRegistryRow,
  parseFollowerCountValue,
} from "../domain/evidence-relative-performance.js";
import {
  listSourceRows,
  upsertSourceRow,
  type InputsSourceRow,
} from "../repositories/inputs-sources.js";

/** Source tabs that can hold account follower baselines for relative scoring. */
export const FOLLOWER_SOURCE_TABS = [
  "igaccounts",
  "tiktokaccounts",
  "facebook",
  "linkedinaccounts",
] as const;

export type FollowerSourceTab = (typeof FOLLOWER_SOURCE_TABS)[number];

const SCRAPER_TO_FOLLOWER_TAB: Record<string, FollowerSourceTab | null> = {
  instagram: "igaccounts",
  tiktok: "tiktokaccounts",
  facebook: "facebook",
  linkedin: "linkedinaccounts",
  reddit: null,
  html: null,
};

const SCRAPER_TO_EVIDENCE_KIND: Record<string, string> = {
  instagram: "instagram_post",
  tiktok: "tiktok_video",
  facebook: "facebook_post",
  linkedin: "linkedin_post",
};

export function followerSourceTabForScraper(scraperKey: string): FollowerSourceTab | null {
  return SCRAPER_TO_FOLLOWER_TAB[scraperKey] ?? null;
}

export function evidenceKindForFollowerScraper(scraperKey: string): string | null {
  return SCRAPER_TO_EVIDENCE_KIND[scraperKey] ?? null;
}

export interface SourceFollowerWritebackStats {
  source_tab: string;
  observations: number;
  updated: number;
  matched_without_followers: number;
  unmatched_handles: number;
}

/** Collect handle → followers from transformed scrape payloads (last positive wins). */
export function collectFollowerObservations(
  evidenceKind: string,
  payloads: Record<string, unknown>[]
): Map<string, number> {
  const map = new Map<string, number>();
  for (const payload of payloads) {
    const handle = extractSocialAccountHandle(evidenceKind, payload);
    const followers = extractFollowerCount(evidenceKind, payload);
    if (!handle || followers == null || followers < 1) continue;
    map.set(handle, followers);
  }
  return map;
}

export interface PlannedSourceFollowerUpdate {
  row: InputsSourceRow;
  followers: number;
  matched_handles: string[];
}

/**
 * Plan which source rows should get `Followers` updated.
 * Never clears an existing Followers value when the observation map has no match.
 */
export function planSourceFollowerUpdates(
  sourceRows: InputsSourceRow[],
  observations: ReadonlyMap<string, number>
): {
  updates: PlannedSourceFollowerUpdate[];
  matched_without_followers: number;
  unmatched_handles: number;
} {
  const claimed = new Set<string>();
  const updates: PlannedSourceFollowerUpdate[] = [];
  let matchedWithoutFollowers = 0;

  for (const row of sourceRows) {
    const handles = handlesFromSourceRegistryRow(row.payload_json ?? {});
    const matched = handles.filter((h) => observations.has(h));
    if (matched.length === 0) continue;
    for (const h of matched) claimed.add(h);

    let followers: number | null = null;
    for (const h of matched) {
      const v = observations.get(h);
      if (v != null && v > 0) followers = v;
    }
    if (followers == null || followers < 1) {
      matchedWithoutFollowers++;
      continue;
    }
    updates.push({ row, followers, matched_handles: matched });
  }

  let unmatched = 0;
  for (const h of observations.keys()) {
    if (!claimed.has(h)) unmatched++;
  }

  return {
    updates,
    matched_without_followers: matchedWithoutFollowers,
    unmatched_handles: unmatched,
  };
}

export async function writebackSourceFollowersFromPayloads(
  db: Pool,
  projectId: string,
  sourceTab: FollowerSourceTab,
  evidenceKind: string,
  payloads: Record<string, unknown>[]
): Promise<SourceFollowerWritebackStats> {
  const observations = collectFollowerObservations(evidenceKind, payloads);
  const sourceRows = await listSourceRows(db, projectId, sourceTab);
  const planned = planSourceFollowerUpdates(sourceRows, observations);

  let updated = 0;
  for (const u of planned.updates) {
    const prev = parseFollowerCountValue(
      u.row.payload_json.Followers ?? u.row.payload_json.followers
    );
    if (prev === u.followers) continue;
    await upsertSourceRow(db, projectId, sourceTab, u.row.row_index, {
      enabled: u.row.enabled,
      payload_json: {
        ...u.row.payload_json,
        Followers: u.followers,
      },
    });
    updated++;
  }

  return {
    source_tab: sourceTab,
    observations: observations.size,
    updated,
    matched_without_followers: planned.matched_without_followers,
    unmatched_handles: planned.unmatched_handles,
  };
}

/** Write followers for a scraper key when the platform has a follower source tab. */
export async function writebackFollowersForScraper(
  db: Pool,
  projectId: string,
  scraperKey: string,
  payloads: Record<string, unknown>[]
): Promise<SourceFollowerWritebackStats | null> {
  const tab = followerSourceTabForScraper(scraperKey);
  const kind = evidenceKindForFollowerScraper(scraperKey);
  if (!tab || !kind || payloads.length === 0) return null;
  return writebackSourceFollowersFromPayloads(db, projectId, tab, kind, payloads);
}

/** Project-level follower baselines from social account source tabs. */
export async function loadProjectSourceFollowerLookup(
  db: Pool,
  projectId: string
): Promise<Map<string, number>> {
  const payloads: Record<string, unknown>[] = [];
  for (const tab of FOLLOWER_SOURCE_TABS) {
    const rows = await listSourceRows(db, projectId, tab);
    for (const r of rows) {
      if (r.payload_json) payloads.push(r.payload_json);
    }
  }
  return buildRegistryFollowerLookup(payloads);
}
