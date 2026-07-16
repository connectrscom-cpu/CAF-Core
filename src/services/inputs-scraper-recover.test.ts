import { describe, expect, it } from "vitest";
import { apifyRunIdsFromScraperStats } from "./inputs-scraper-recover.js";

describe("apifyRunIdsFromScraperStats", () => {
  it("returns linkedin run ids from failed all-run stats", () => {
    const ids = apifyRunIdsFromScraperStats(
      {
        apify_runs: [
          { scraper_key: "linkedin", run_id: "abc123", console_url: "https://x" },
          { scraper_key: "instagram", run_id: "ig999", console_url: "https://y" },
        ],
      },
      "linkedin"
    );
    expect(ids).toEqual(["abc123"]);
  });

  it("dedupes and returns all when platform omitted", () => {
    const ids = apifyRunIdsFromScraperStats({
      apify_runs: [
        { scraper_key: "linkedin", run_id: "a" },
        { scraper_key: "linkedin", run_id: "a" },
        { scraper_key: "linkedin", run_id: "b" },
      ],
    });
    expect(ids).toEqual(["a", "b"]);
  });
});
