import { describe, expect, it } from "vitest";
import { isCoreHttpPath } from "./core-http-paths.js";

describe("isCoreHttpPath", () => {
  it("treats Core API and admin paths as Core", () => {
    expect(isCoreHttpPath("/health")).toBe(true);
    expect(isCoreHttpPath("/readyz")).toBe(true);
    expect(isCoreHttpPath("/v1/review-queue/SNS/counts")).toBe(true);
    expect(isCoreHttpPath("/api/templates/foo")).toBe(true);
    expect(isCoreHttpPath("/admin/jobs")).toBe(true);
    expect(isCoreHttpPath("/static/processing/x")).toBe(true);
  });

  it("treats Review UI and BFF paths as non-Core", () => {
    expect(isCoreHttpPath("/")).toBe(false);
    expect(isCoreHttpPath("/runs")).toBe(false);
    expect(isCoreHttpPath("/t/foo__bar")).toBe(false);
    expect(isCoreHttpPath("/api/tasks")).toBe(false);
    expect(isCoreHttpPath("/api/task/decision")).toBe(false);
    expect(isCoreHttpPath("/_next/static/chunk.js")).toBe(false);
  });
});
