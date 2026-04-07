import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { normalizeOverallCandidateRows, parseSignalPackExcel } from "./signal-pack-parser.js";

describe("normalizeOverallCandidateRows", () => {
  it("fills candidate_id from row_number and content_idea from idea_description", () => {
    const rows = normalizeOverallCandidateRows(
      [
        {
          row_number: 12,
          platform: "Instagram",
          format: "carousel",
          idea_description: "A carousel about signs",
        },
      ],
      "SNS_2026W18"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].candidate_id).toBe("SNS_2026W18__Instagram_r12");
    expect(rows[0].content_idea).toBe("A carousel about signs");
  });
});

describe("parseSignalPackExcel", () => {
  it("prefers Signal Pack tab overall_candidates_json over Overall sheet", () => {
    const curated = [
      {
        row_number: 99,
        platform: "TikTok",
        format: "video",
        content_idea: "Curated only",
      },
    ];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["run_id", "overall_candidates_json"],
        ["SNS_TEST", JSON.stringify(curated)],
      ]),
      "Signal Pack"
    );
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.aoa_to_sheet([
        ["generated_at", "platform", "format", "content_idea"],
        ["2026-01-01", "Instagram", "carousel", "Noise row 1"],
        ["2026-01-01", "Instagram", "carousel", "Noise row 2"],
      ]),
      "Overall"
    );
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const parsed = parseSignalPackExcel(buf);
    expect(parsed.used_published_signal_pack_row).toBe(true);
    expect(parsed.overall_candidates_json).toHaveLength(1);
    expect((parsed.overall_candidates_json[0] as { content_idea?: string }).content_idea).toBe("Curated only");
    expect(parsed.sheets_ingested).toContain("Signal Pack");
  });
});
