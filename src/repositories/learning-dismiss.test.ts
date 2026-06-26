import { describe, expect, it, vi } from "vitest";
import {
  dismissLearningRule,
  dismissPendingLearningRulesForProject,
} from "./learning.js";

function mockDb(responses: { rowCount: number }[]) {
  let i = 0;
  return {
    query: vi.fn(async () => {
      const r = responses[i] ?? { rowCount: 0 };
      i += 1;
      return r;
    }),
  };
}

describe("dismissLearningRule", () => {
  it("marks pending rules as rejected", async () => {
    const db = mockDb([{ rowCount: 1 }]);
    const out = await dismissLearningRule(db as never, "proj-1", "rule_a");
    expect(out).toEqual({ ok: true, status: "rejected" });
    expect(db.query).toHaveBeenCalledTimes(1);
  });

  it("retires active rules when not pending", async () => {
    const db = mockDb([{ rowCount: 0 }, { rowCount: 1 }]);
    const out = await dismissLearningRule(db as never, "proj-1", "rule_b");
    expect(out).toEqual({ ok: true, status: "expired" });
    expect(db.query).toHaveBeenCalledTimes(2);
  });

  it("returns ok false when rule missing", async () => {
    const db = mockDb([{ rowCount: 0 }, { rowCount: 0 }]);
    const out = await dismissLearningRule(db as never, "proj-1", "missing");
    expect(out).toEqual({ ok: false });
  });
});

describe("dismissPendingLearningRulesForProject", () => {
  it("returns updated row count", async () => {
    const db = mockDb([{ rowCount: 3 }]);
    const n = await dismissPendingLearningRulesForProject(db as never, "proj-1");
    expect(n).toBe(3);
  });
});
