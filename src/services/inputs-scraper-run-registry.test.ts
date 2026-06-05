import { describe, expect, it } from "vitest";
import {
  assertScraperRunNotAborted,
  clearScraperRun,
  isScraperRunAborted,
  isScraperRunActive,
  registerScraperRun,
  requestScraperRunAbort,
  ScraperRunAbortedError,
  trackApifyRun,
} from "./inputs-scraper-run-registry.js";

describe("inputs-scraper-run-registry", () => {
  const projectId = "proj-1";
  const runId = "run-1";

  it("tracks abort and Apify run ids", () => {
    registerScraperRun(projectId, runId);
    expect(isScraperRunActive(projectId, runId)).toBe(true);
    trackApifyRun(projectId, runId, "apify-a");
    trackApifyRun(projectId, runId, "apify-b");
    expect(requestScraperRunAbort(projectId, runId)).toEqual(["apify-a", "apify-b"]);
    expect(isScraperRunAborted(projectId, runId)).toBe(true);
    expect(() => assertScraperRunNotAborted(projectId, runId)).toThrow(ScraperRunAbortedError);
    clearScraperRun(projectId, runId);
    expect(isScraperRunActive(projectId, runId)).toBe(false);
  });
});
