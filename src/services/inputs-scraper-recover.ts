/**
 * Recover INPUTS evidence from completed Apify actor runs without re-scraping.
 */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  getScraperRun,
  getScraperConfig,
  insertScraperRun,
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
  datasetLimitFor,
  mergeScraperConfig,
  scaledLinkedInDatasetLimit,
  type ScraperProjectConfig,
} from "./inputs-scraper-apify-config.js";
import type { ScraperApifyRunRef, ScraperKey } from "./inputs-scraper-orchestrator.js";
import {
  transformFacebookApifyPost,
  transformInstagramApifyPost,
  transformLinkedInApifyPost,
  transformRedditApifyDataset,
  transformTiktokApifyItem,
} from "./inputs-scraper-transforms.js";
import { linkedinPostDedupeKey } from "./linkedin-discovery.js";
import {
  apifyConsoleRunUrl,
  getAllApifyDatasetItems,
  getApifyRun,
  hasApifyToken,
} from "./apify-client.js";
import { logPipelineEvent } from "./pipeline-logger.js";
import { writebackFollowersForScraper } from "./inputs-source-followers.js";

export type RecoverableScraperKey = Exclude<ScraperKey, "all" | "html">;

export interface RecoverApifyImportInput {
  scraperKey: RecoverableScraperKey;
  /** One or more Apify actor run IDs (from Apify console URL). */
  apifyRunIds: string[];
  /** Re-open a failed/cancelled CAF scraper run instead of creating a new one. */
  scraperRunId?: string | null;
}

export interface RecoverApifyImportResult {
  scraper_run_id: string;
  evidence_import_id: string;
  total_rows: number;
  apify_runs: ScraperApifyRunRef[];
  recovered_from_apify_run_ids: string[];
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

function transformApifyDatasetItems(
  scraperKey: RecoverableScraperKey,
  items: Record<string, unknown>[],
  projectConfig: ScraperProjectConfig
): Record<string, unknown>[] {
  switch (scraperKey) {
    case "linkedin": {
      const seen = new Set<string>();
      const out: Record<string, unknown>[] = [];
      for (const item of items) {
        const row = transformLinkedInApifyPost(item, { discovery_source: "recovered_apify" });
        if (!row) continue;
        const key = linkedinPostDedupeKey(row);
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(row);
      }
      return out;
    }
    case "instagram": {
      const out: Record<string, unknown>[] = [];
      for (const item of items) out.push(transformInstagramApifyPost(item, {}));
      return out;
    }
    case "tiktok": {
      const out: Record<string, unknown>[] = [];
      for (const item of items) {
        const row = transformTiktokApifyItem(item);
        if (row) out.push(row);
      }
      return out;
    }
    case "reddit":
      return transformRedditApifyDataset(items);
    case "facebook": {
      const fb = projectConfig.scrapers?.facebook ?? {};
      const filterOpts = { minLikes: fb.minLikes ?? 5, requireCaption: fb.requireCaption !== false };
      const out: Record<string, unknown>[] = [];
      for (const item of items) {
        const row = transformFacebookApifyPost(item, filterOpts);
        if (row) out.push(row);
      }
      return out;
    }
    default:
      return [];
  }
}

function datasetLimitForRecovery(
  scraperKey: RecoverableScraperKey,
  projectConfig: ScraperProjectConfig,
  itemEstimate: number
): number {
  if (scraperKey === "linkedin") {
    return scaledLinkedInDatasetLimit(projectConfig, Math.max(1, Math.ceil(itemEstimate / 20)), 0);
  }
  return datasetLimitFor(projectConfig, scraperKey);
}

export function apifyRunIdsFromScraperStats(
  stats: Record<string, unknown> | null | undefined,
  platform?: RecoverableScraperKey
): string[] {
  const runs = stats?.apify_runs;
  if (!Array.isArray(runs)) return [];
  const out: string[] = [];
  for (const row of runs) {
    if (!row || typeof row !== "object") continue;
    const ref = row as ScraperApifyRunRef;
    if (platform && ref.scraper_key && ref.scraper_key !== platform) continue;
    const id = String(ref.run_id ?? "").trim();
    if (id) out.push(id);
  }
  return [...new Set(out)];
}

export async function recoverInputsScraperFromApify(
  db: Pool,
  config: AppConfig,
  projectId: string,
  input: RecoverApifyImportInput
): Promise<RecoverApifyImportResult> {
  const token = config.APIFY_API_TOKEN?.trim();
  if (!hasApifyToken(token)) {
    throw new Error("APIFY_API_TOKEN not configured");
  }

  const runIds = [...new Set(input.apifyRunIds.map((id) => id.trim()).filter(Boolean))];
  if (runIds.length === 0) {
    throw new Error("Provide at least one Apify run ID");
  }

  let targetRunId = input.scraperRunId?.trim() || null;
  let targetScraperKey = input.scraperKey;

  if (targetRunId) {
    const existing = await getScraperRun(db, projectId, targetRunId);
    if (!existing) throw new Error(`Scraper run not found: ${targetRunId}`);
    if (existing.status === "completed" && existing.evidence_import_id) {
      throw new Error(`Scraper run ${targetRunId} already completed with an import`);
    }
    if (existing.scraper_key !== "all" && existing.scraper_key !== input.scraperKey) {
      throw new Error(
        `Run ${targetRunId} is ${existing.scraper_key}; recovery platform is ${input.scraperKey}`
      );
    }
    targetScraperKey = input.scraperKey;
  }

  const stored = await getScraperConfig(db, projectId);
  const projectConfig = mergeScraperConfig(stored?.config_json);
  const allItems: Record<string, unknown>[] = [];
  const apifyRefs: ScraperApifyRunRef[] = [];

  for (const apifyRunId of runIds) {
    let run;
    try {
      run = await getApifyRun(token!, apifyRunId);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`Apify run ${apifyRunId} not found or inaccessible: ${msg}`);
    }

    if (run.status !== "SUCCEEDED") {
      logPipelineEvent("warn", "other", "recovering apify run with non-success status", {
        data: { apify_run_id: apifyRunId, status: run.status },
      });
    }

    const limit = datasetLimitForRecovery(targetScraperKey, projectConfig, 5000);
    const items = await getAllApifyDatasetItems<Record<string, unknown>>(token!, run.defaultDatasetId, {
      maxItems: limit,
    });
    allItems.push(...items);
    apifyRefs.push({
      scraper_key: targetScraperKey,
      run_id: apifyRunId,
      console_url: apifyConsoleRunUrl(apifyRunId),
    });
  }

  const payloads = transformApifyDatasetItems(targetScraperKey, allItems, projectConfig);
  if (payloads.length === 0) {
    throw new Error(
      `No ${targetScraperKey} rows found in Apify dataset(s). Check run ID(s) and actor output shape.`
    );
  }

  let followerWriteback: Record<string, unknown> | null = null;
  try {
    const wb = await writebackFollowersForScraper(db, projectId, targetScraperKey, payloads);
    if (wb) followerWriteback = wb as unknown as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logPipelineEvent("warn", "other", `source follower writeback failed on recover for ${targetScraperKey}`, {
      data: { error: msg },
    });
  }

  const sheetName = SCRAPER_OUTPUT_SHEETS[targetScraperKey];
  if (!sheetName) throw new Error(`Unsupported scraper key: ${targetScraperKey}`);

  const rows = rowsToEvidence(sheetName, payloads);

  if (!targetRunId) {
    const inserted = await insertScraperRun(db, {
      project_id: projectId,
      scraper_key: targetScraperKey,
      config_snapshot_json: {
        recovered: true,
        recovered_at: new Date().toISOString(),
        apify_run_ids: runIds,
      },
    });
    targetRunId = inserted.id;
    await updateScraperRun(db, targetRunId, projectId, { status: "running", started_at: true });
  }

  const label = `recovered-${targetScraperKey}-${new Date().toISOString().slice(0, 10)}.xlsx`;
  const workbook_sha256 = createHash("sha256")
    .update(JSON.stringify({ recovered_apify_runs: runIds, rows: rows.length }))
    .digest("hex");

  const sheet_stats_json = buildSheetStatsFromRows(rows, {
    source: "scraper",
    scraper_run_id: targetRunId,
    workbook_sha256,
    recovered_from_apify: true,
  });

  const { importId, totalRows } = await writeInputsEvidenceImport(db, projectId, {
    filename: label,
    notes: `Recovered from Apify run(s): ${runIds.join(", ")}`,
    workbook_sha256,
    sheet_stats_json,
    rows,
  });

  const statsKey = targetScraperKey;
  await updateScraperRun(db, targetRunId, projectId, {
    status: "completed",
    finished_at: true,
    error_message: null,
    evidence_import_id: importId,
    stats_json: {
      total_rows: totalRows,
      scrapers_run: [statsKey],
      rows_by_scraper: { [statsKey]: totalRows },
      apify_runs: apifyRefs,
      recovered: true,
      recovered_at: new Date().toISOString(),
      recovered_from_apify_run_ids: runIds,
      follower_writeback: followerWriteback ? { [statsKey]: followerWriteback } : {},
    },
  });

  logPipelineEvent("info", "other", "inputs scraper recovered from apify", {
    data: {
      scraper_run_id: targetRunId,
      scraper_key: targetScraperKey,
      total_rows: totalRows,
      apify_run_ids: runIds,
    },
  });

  return {
    scraper_run_id: targetRunId,
    evidence_import_id: importId,
    total_rows: totalRows,
    apify_runs: apifyRefs,
    recovered_from_apify_run_ids: runIds,
  };
}
