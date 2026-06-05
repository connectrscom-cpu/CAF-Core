import { describe, expect, it } from "vitest";
import { defaultScraperConfig } from "./inputs-scraper-apify-config.js";
import { applySourceCap, estimateScraperLine } from "./inputs-scraper-cost-estimate.js";

describe("applySourceCap", () => {
  it("returns all items when cap is unset", () => {
    expect(applySourceCap([1, 2, 3], null)).toEqual([1, 2, 3]);
    expect(applySourceCap([1, 2, 3], 0)).toEqual([1, 2, 3]);
  });

  it("slices to cap", () => {
    expect(applySourceCap([1, 2, 3, 4], 2)).toEqual([1, 2]);
  });
});

describe("estimateScraperLine", () => {
  const cfg = defaultScraperConfig();

  it("instagram per_account estimates one Apify run per capped account", () => {
    const sources = [
      { Link: "https://www.instagram.com/a/" },
      { Link: "https://www.instagram.com/b/" },
      { Link: "https://www.instagram.com/c/" },
    ];
    const line = estimateScraperLine("instagram", cfg, sources, [], 2);
    expect(line.enabled_sources).toBe(3);
    expect(line.sources_after_cap).toBe(2);
    expect(line.apify_runs_estimated).toBe(2);
    expect(line.cost_estimate_usd.mid).toBeGreaterThan(0);
  });

  it("instagram batch uses a single Apify run", () => {
    const cfgBatch = defaultScraperConfig();
    cfgBatch.scrapers!.instagram!.runMode = "batch";
    const sources = [{ Link: "https://www.instagram.com/a/" }, { Link: "https://www.instagram.com/b/" }];
    const line = estimateScraperLine("instagram", cfgBatch, sources, [], 1);
    expect(line.apify_runs_estimated).toBe(1);
    expect(line.run_mode).toBe("batch");
  });

  it("html has zero Apify cost", () => {
    const line = estimateScraperLine(
      "html",
      cfg,
      [{ Link: "https://example.com", Enabled: true }],
      [],
      5
    );
    expect(line.apify_runs_estimated).toBe(0);
    expect(line.cost_estimate_usd.mid).toBe(0);
  });
});
