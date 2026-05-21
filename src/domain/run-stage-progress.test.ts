import { describe, expect, it } from "vitest";
import { computeRunStageProgress } from "./run-stage-progress.js";

describe("computeRunStageProgress", () => {
  const total = 14;

  it("shows full bar when all jobs PLANNED during GENERATING (waiting for Generate)", () => {
    const progress = computeRunStageProgress("GENERATING", { PLANNED: 14 }, total);
    expect(progress).toEqual({ done: 14, total: 14 });
  });

  it("resets to 0 when generation starts", () => {
    const progress = computeRunStageProgress(
      "GENERATING",
      { PLANNED: 12, GENERATING: 2 },
      total
    );
    expect(progress).toEqual({ done: 0, total: 14 });
  });

  it("increments as packages become GENERATED", () => {
    const progress = computeRunStageProgress(
      "GENERATING",
      { PLANNED: 2, GENERATING: 3, GENERATED: 9 },
      total
    );
    expect(progress).toEqual({ done: 9, total: 14 });
  });

  it("shows full bar when all packages ready before Render", () => {
    const progress = computeRunStageProgress("RENDERING", { GENERATED: 14 }, total);
    expect(progress).toEqual({ done: 14, total: 14 });
  });

  it("resets to 0 when render starts", () => {
    const progress = computeRunStageProgress(
      "RENDERING",
      { GENERATED: 10, RENDERING: 4 },
      total
    );
    expect(progress).toEqual({ done: 0, total: 14 });
  });

  it("increments as jobs reach IN_REVIEW", () => {
    const progress = computeRunStageProgress(
      "RENDERING",
      { GENERATED: 2, RENDERING: 5, IN_REVIEW: 7 },
      total
    );
    expect(progress).toEqual({ done: 7, total: 14 });
  });

  it("shows full bar when all jobs waiting in review queue", () => {
    const progress = computeRunStageProgress("REVIEWING", { IN_REVIEW: 14 }, total);
    expect(progress).toEqual({ done: 14, total: 14 });
  });

  it("counts editorial decisions during REVIEWING", () => {
    const progress = computeRunStageProgress(
      "REVIEWING",
      { IN_REVIEW: 10, APPROVED: 3, REJECTED: 1 },
      total
    );
    expect(progress).toEqual({ done: 4, total: 14 });
  });

  it("uses live job count when run total_jobs is stale", () => {
    const progress = computeRunStageProgress("GENERATING", { PLANNED: 5 }, 0);
    expect(progress).toEqual({ done: 5, total: 5 });
  });
});
