import { describe, expect, it } from "vitest";
import {
  dualWriteRunPlannedJobs,
  dualWriteSignalPackJobs,
  readRunPlannedJobsJson,
  readSignalPackJobsJson,
  signalPackJobsApiFields,
} from "./jobs-json-compat.js";

describe("jobs-json-compat", () => {
  it("prefers jobs_json over ideas_json", () => {
    expect(readSignalPackJobsJson({ jobs_json: [{ id: "j1" }], ideas_json: [{ id: "i1" }] })).toEqual([
      { id: "j1" },
    ]);
  });

  it("falls back to ideas_json when jobs_json empty", () => {
    expect(readSignalPackJobsJson({ jobs_json: [], ideas_json: [{ id: "i1" }] })).toEqual([{ id: "i1" }]);
  });

  it("prefers planned_jobs_json over candidates_json", () => {
    expect(
      readRunPlannedJobsJson({ planned_jobs_json: [{ id: "p1" }], candidates_json: [{ id: "c1" }] })
    ).toEqual([{ id: "p1" }]);
  });

  it("dual-writes signal pack job columns", () => {
    const rows = [{ id: "a" }];
    expect(dualWriteSignalPackJobs(rows)).toEqual({ jobs_json: rows, ideas_json: rows });
  });

  it("dual-writes run planned job columns", () => {
    const rows = [{ id: "b" }];
    expect(dualWriteRunPlannedJobs(rows)).toEqual({ planned_jobs_json: rows, candidates_json: rows });
  });

  it("adds jobs_count to API fields", () => {
    const out = signalPackJobsApiFields({ ideas_json: [{ id: "x" }, { id: "y" }] }, false);
    expect(out.jobs_count).toBe(2);
    expect(out.jobs_json).toHaveLength(2);
  });
});
