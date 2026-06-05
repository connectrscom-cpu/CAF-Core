import { describe, expect, it } from "vitest";
import type { ParsedInputsEvidenceRow } from "./inputs-sns-workbook-parser.js";
import { buildSheetStatsFromRows } from "./inputs-evidence-import-write.js";

describe("evidence pack import shape", () => {
  it("builds sheet_stats_json matching standard import contract", () => {
    const rows: ParsedInputsEvidenceRow[] = [
      {
        sheet_name: "InstagramPostData",
        row_index: 1,
        evidence_kind: "instagram_post",
        dedupe_key: "ig:1",
        payload_json: { caption: "hi" },
      },
      {
        sheet_name: "Tiktok_Videos",
        row_index: 1,
        evidence_kind: "tiktok_video",
        dedupe_key: "tt:1",
        payload_json: { text: "vid" },
      },
    ];
    const stats = buildSheetStatsFromRows(rows, {
      source: "evidence_pack",
      workbook_sha256: "abc",
      platform_slots: { instagram: { scraper_run_id: "r1", evidence_import_id: "i1" } },
    });
    expect(stats.version).toBe(1);
    expect(stats.source).toBe("evidence_pack");
    expect(stats.total_rows).toBe(2);
    expect(Array.isArray(stats.sheets)).toBe(true);
    expect((stats.sheets as { sheet_name: string }[]).map((s) => s.sheet_name).sort()).toEqual([
      "InstagramPostData",
      "Tiktok_Videos",
    ]);
  });
});
