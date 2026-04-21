import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  computeDedupeKey,
  parseInputsSnsWorkbookBuffer,
  sheetNameToEvidenceKind,
} from "./inputs-sns-workbook-parser.js";

describe("sheetNameToEvidenceKind", () => {
  it("maps SNS-style tabs", () => {
    expect(sheetNameToEvidenceKind("SCRAPED")).toBe("scraped_page");
    expect(sheetNameToEvidenceKind("Reddit_Raw_Info")).toBe("reddit_post");
    expect(sheetNameToEvidenceKind("Websites+Blogs")).toBe("source_registry");
  });
});

describe("parseInputsSnsWorkbookBuffer", () => {
  it("reads headers and rows", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Name", "Link", "Platform"],
      ["A", "https://a.test", "IG"],
      ["", "", ""],
      ["B", "https://b.test", "TT"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "All Sources");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

    const parsed = parseInputsSnsWorkbookBuffer(buf);
    expect(parsed.workbook_sha256).toHaveLength(64);
    expect(parsed.sheets).toHaveLength(1);
    expect(parsed.sheets[0]!.row_count).toBe(2);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]!.payload_json["Name"]).toBe("A");
    expect(parsed.rows[0]!.evidence_kind).toBe("source_registry");
  });
});

describe("computeDedupeKey", () => {
  it("uses reddit post_id", () => {
    const k = computeDedupeKey("x", "reddit_post", { post_id: "abc" });
    expect(k).toBe("abc");
  });
});
