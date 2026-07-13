import { describe, expect, it } from "vitest";
import { buildSourcesWorkbookTemplateBuffer } from "./inputs-source-sync.js";
import * as XLSX from "xlsx";

describe("buildSourcesWorkbookTemplateBuffer", () => {
  it("builds an xlsx with all research watchlist tabs", () => {
    const buffer = buildSourcesWorkbookTemplateBuffer();
    expect(buffer.length).toBeGreaterThan(100);
    const wb = XLSX.read(buffer, { type: "buffer" });
    expect(wb.SheetNames).toEqual(
      expect.arrayContaining([
        "IGAccounts",
        "TikTokAccounts",
        "Hashtags",
        "SubReddits",
        "Facebook",
        "LinkedInAccounts",
        "LinkedInSearches",
        "Websites+Blogs",
      ])
    );
  });
});
