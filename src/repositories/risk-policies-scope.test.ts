import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import { listRiskPoliciesForJob } from "./flow-engine.js";

interface FakeQuery {
  text: string;
  values: unknown[];
}

function makeFakePool(rows: Record<string, unknown>[] = []): { db: Pool; calls: FakeQuery[] } {
  const calls: FakeQuery[] = [];
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text, values });
      return { rows, rowCount: rows.length, command: "SELECT", fields: [] };
    },
  } as unknown as Pool;
  return { db, calls };
}

describe("listRiskPoliciesForJob", () => {
  it("asks Postgres for global policies (NULL scope) OR ones matching the flow", async () => {
    const { db, calls } = makeFakePool([]);
    await listRiskPoliciesForJob(db, "Flow_Carousel_Copy");
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.text).toMatch(/FROM caf_core\.risk_policies/);
    expect(call.text).toMatch(/applies_to_flow_type IS NULL/);
    expect(call.text).toMatch(/applies_to_flow_type = \$1/);
    expect(call.values).toEqual(["Flow_Carousel_Copy"]);
  });

  it("returns whatever the db returns, typed as RiskPolicyRow[]", async () => {
    const { db } = makeFakePool([
      { risk_policy_name: "a", applies_to_flow_type: null },
      { risk_policy_name: "b", applies_to_flow_type: "Flow_Carousel_Copy" },
    ]);
    const rows = await listRiskPoliciesForJob(db, "Flow_Carousel_Copy");
    expect(rows.map((r) => r.risk_policy_name)).toEqual(["a", "b"]);
  });
});
