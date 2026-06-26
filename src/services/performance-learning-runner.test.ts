import { describe, expect, it } from "vitest";
import { newPerformanceAnalysisObservationId } from "./performance-learning-runner.js";

describe("performance-learning-runner", () => {
  it("builds stable perf observation id prefix", () => {
    const id = newPerformanceAnalysisObservationId("SNS");
    expect(id.startsWith("perf_run_SNS_")).toBe(true);
    expect(id.length).toBeGreaterThan("perf_run_SNS_".length);
  });
});
