/**
 * Build an Evidence Pack: merge one completed scraper run per platform into a single
 * inputs_evidence_import (same row/sheet contract as XLSX upload or scraper import).
 */
import { createHash } from "node:crypto";
import type { Pool } from "pg";
import { getScraperRun, listCompletedScraperRunsForPlatform } from "../repositories/inputs-sources.js";
import { listAllInputsEvidenceRowsForImport } from "../repositories/inputs-evidence.js";
import {
  EVIDENCE_PACK_PLATFORMS,
  insertEvidencePack,
  type EvidencePackPlatform,
  type EvidencePackSlotRef,
} from "../repositories/inputs-evidence-packs.js";
import type { ParsedInputsEvidenceRow } from "./inputs-sns-workbook-parser.js";
import {
  buildSheetStatsFromRows,
  writeInputsEvidenceImport,
} from "./inputs-evidence-import-write.js";
import { SCRAPER_OUTPUT_SHEETS } from "./inputs-source-sync.js";

export type EvidencePackSlotsInput = Partial<Record<EvidencePackPlatform, string>>;

export interface BuildEvidencePackResult {
  evidence_pack_id: string;
  evidence_import_id: string;
  total_rows: number;
  slots: Record<string, EvidencePackSlotRef>;
  rows_by_platform: Record<string, number>;
}

function isPackPlatform(key: string): key is EvidencePackPlatform {
  return (EVIDENCE_PACK_PLATFORMS as readonly string[]).includes(key);
}

export async function listEvidencePackRunOptions(
  db: Pool,
  projectId: string,
  limitPerPlatform = 20
): Promise<
  Record<
    EvidencePackPlatform,
    Array<{
      scraper_run_id: string;
      evidence_import_id: string;
      created_at: string;
      total_rows: number | null;
      scraper_key: string;
    }>
  >
> {
  const result = {} as Record<
    EvidencePackPlatform,
    Array<{
      scraper_run_id: string;
      evidence_import_id: string;
      created_at: string;
      total_rows: number | null;
      scraper_key: string;
    }>
  >;
  for (const platform of EVIDENCE_PACK_PLATFORMS) {
    const runs = await listCompletedScraperRunsForPlatform(db, projectId, platform, limitPerPlatform);
    result[platform] = runs.map((r) => {
      const rowsByScraper = r.stats_json?.rows_by_scraper as Record<string, number> | undefined;
      const platformRows =
        r.scraper_key === platform
          ? typeof r.stats_json?.total_rows === "number"
            ? r.stats_json.total_rows
            : null
          : typeof rowsByScraper?.[platform] === "number"
            ? rowsByScraper[platform]
            : null;
      return {
        scraper_run_id: r.id,
        evidence_import_id: r.evidence_import_id!,
        created_at: r.created_at,
        total_rows: platformRows,
        scraper_key: r.scraper_key,
      };
    });
  }
  return result;
}

export async function buildInputsEvidencePack(
  db: Pool,
  projectId: string,
  slots: EvidencePackSlotsInput,
  label?: string | null
): Promise<BuildEvidencePackResult> {
  const resolvedSlots: Record<string, EvidencePackSlotRef> = {};
  const rowsByPlatform: Record<string, number> = {};
  const mergedRows: ParsedInputsEvidenceRow[] = [];
  const sheetRowNext = new Map<string, number>();

  const entries = Object.entries(slots).filter(([, runId]) => runId?.trim());
  if (entries.length === 0) {
    throw new Error("Select at least one platform scraper run");
  }

  for (const [platform, runId] of entries) {
    if (!isPackPlatform(platform)) {
      throw new Error(`Unknown platform slot: ${platform}`);
    }
    const run = await getScraperRun(db, projectId, runId!.trim());
    if (!run) throw new Error(`Scraper run not found: ${runId}`);
    if (run.status !== "completed") {
      throw new Error(`Scraper run ${runId} is not completed (${run.status})`);
    }
    const rowsByScraper = run.stats_json?.rows_by_scraper as Record<string, number> | undefined;
    if (run.scraper_key !== platform && run.scraper_key !== "all") {
      throw new Error(`Run ${runId} is ${run.scraper_key}, expected ${platform}`);
    }
    if (run.scraper_key === "all") {
      const platformRows = rowsByScraper?.[platform] ?? 0;
      if (platformRows <= 0) {
        throw new Error(`Run ${runId} (all) has no ${platform} rows`);
      }
    }
    if (!run.evidence_import_id) {
      throw new Error(`Scraper run ${runId} has no evidence import`);
    }

    const platformSheet = SCRAPER_OUTPUT_SHEETS[platform];
    const sourceRows = await listAllInputsEvidenceRowsForImport(
      db,
      projectId,
      run.evidence_import_id
    );
    const platformRows = platformSheet
      ? sourceRows.filter((row) => row.sheet_name === platformSheet)
      : sourceRows;
    if (platformRows.length === 0) {
      throw new Error(`Scraper run ${runId} (${platform}) produced no rows`);
    }

    for (const row of platformRows) {
      const nextIdx = (sheetRowNext.get(row.sheet_name) ?? 0) + 1;
      sheetRowNext.set(row.sheet_name, nextIdx);
      mergedRows.push({
        sheet_name: row.sheet_name,
        row_index: nextIdx,
        evidence_kind: row.evidence_kind,
        dedupe_key: row.dedupe_key,
        payload_json: row.payload_json,
      });
    }

    resolvedSlots[platform] = {
      scraper_run_id: run.id,
      evidence_import_id: run.evidence_import_id,
      row_count: platformRows.length,
    };
    rowsByPlatform[platform] = platformRows.length;
  }

  const packLabel =
    label?.trim() ||
    `evidence-pack-${new Date().toISOString().slice(0, 10)}`;
  const workbook_sha256 = createHash("sha256")
    .update(JSON.stringify({ slots: resolvedSlots, rows: mergedRows.length }))
    .digest("hex");

  const platform_slots = resolvedSlots;
  const sheet_stats_json = buildSheetStatsFromRows(mergedRows, {
    source: "evidence_pack",
    workbook_sha256,
    platform_slots,
  });

  const { importId, totalRows } = await writeInputsEvidenceImport(db, projectId, {
    filename: `${packLabel}.xlsx`,
    notes: `Evidence pack — ${Object.keys(resolvedSlots).join(", ")}`,
    workbook_sha256,
    sheet_stats_json,
    rows: mergedRows,
  });

  const packRow = await insertEvidencePack(db, {
    project_id: projectId,
    label: packLabel,
    slots_json: resolvedSlots,
    evidence_import_id: importId,
    stats_json: {
      total_rows: totalRows,
      rows_by_platform: rowsByPlatform,
      platforms: Object.keys(resolvedSlots),
    },
  });

  return {
    evidence_pack_id: packRow.id,
    evidence_import_id: importId,
    total_rows: totalRows,
    slots: resolvedSlots,
    rows_by_platform: rowsByPlatform,
  };
}
