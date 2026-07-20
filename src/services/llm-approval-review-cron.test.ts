import { describe, expect, it } from "vitest";
import { planLlmReviewBatch } from "./llm-approval-review-cron.js";

describe("planLlmReviewBatch", () => {
  it("splits batch between approved and failure lanes", () => {
    expect(planLlmReviewBatch(10, 0, 5, 0.3)).toEqual({ approved_limit: 4, failure_limit: 1 });
  });

  it("respects remaining daily capacity", () => {
    expect(planLlmReviewBatch(10, 8, 5, 0.3)).toEqual({ approved_limit: 2, failure_limit: 0 });
  });

  it("returns zeros when the cap is exhausted", () => {
    expect(planLlmReviewBatch(10, 10, 5, 0.3)).toEqual({ approved_limit: 0, failure_limit: 0 });
    expect(planLlmReviewBatch(10, 15, 5, 0.3)).toEqual({ approved_limit: 0, failure_limit: 0 });
  });

  it("failure fraction 0 gives everything to approved lane", () => {
    expect(planLlmReviewBatch(10, 0, 4, 0)).toEqual({ approved_limit: 4, failure_limit: 0 });
  });

  it("failure fraction 1 gives everything to failure lane", () => {
    expect(planLlmReviewBatch(10, 0, 4, 1)).toEqual({ approved_limit: 0, failure_limit: 4 });
  });
});
