import { describe, expect, it } from "vitest";
import type { Pool } from "pg";
import {
  mergeGenerationPayloadQc,
  pickStoredQcResult,
  qcResultSchema,
  type QcResultStored,
} from "./generation-payload-qc.js";

const baseQc: QcResultStored = {
  passed: true,
  score: 1,
  blocking_count: 0,
  risk_level: "LOW",
  risk_findings_count: 0,
  recommended_route: "HUMAN_REVIEW",
};

describe("qcResultSchema", () => {
  it("accepts a minimal valid payload", () => {
    expect(() => qcResultSchema.parse(baseQc)).not.toThrow();
  });

  it("accepts a fat payload with reasons + blocking lists", () => {
    const parsed = qcResultSchema.parse({
      ...baseQc,
      passed: false,
      score: 0.5,
      blocking_count: 1,
      risk_level: "HIGH",
      risk_findings_count: 2,
      recommended_route: "BLOCKED",
      reason_short: "Risk policy X (HIGH)",
      reasons: ["Check Y failed", "Risk policy X (HIGH) — matched: foo"],
      blocking_checks: [
        { check_id: "C1", check_name: "Y", failure_message: "nope", severity: "HIGH" },
      ],
      blocking_risk_policies: [
        { policy_name: "X", severity: "HIGH", matched_terms: ["foo"] },
      ],
    });
    expect(parsed.reasons).toHaveLength(2);
    expect(parsed.blocking_risk_policies?.[0]?.matched_terms).toEqual(["foo"]);
  });

  it("rejects nonsense", () => {
    expect(() => qcResultSchema.parse({ ...baseQc, blocking_count: -1 })).toThrow();
    expect(() => qcResultSchema.parse({ ...baseQc, reason_short: "x".repeat(201) })).toThrow();
  });
});

describe("pickStoredQcResult", () => {
  it("returns null when generation_payload is empty", () => {
    expect(pickStoredQcResult({})).toBeNull();
    expect(pickStoredQcResult(null)).toBeNull();
  });

  it("round-trips a strict payload", () => {
    const back = pickStoredQcResult({ qc_result: baseQc });
    expect(back).toEqual(baseQc);
  });

  it("tolerates pre-migration rows with extra fields", () => {
    const back = pickStoredQcResult({
      qc_result: { ...baseQc, legacy_extra: 123 },
    });
    expect(back?.passed).toBe(true);
  });
});

describe("mergeGenerationPayloadQc", () => {
  it("validates input, targets the right table, and merges via jsonb ||", async () => {
    const calls: { text: string; values: unknown[] }[] = [];
    const db = {
      query: async (text: string, values: unknown[] = []) => {
        calls.push({ text, values });
        return { rows: [], rowCount: 0, command: "UPDATE", fields: [] };
      },
    } as unknown as Pool;

    await mergeGenerationPayloadQc(db, "job-id", baseQc, {
      qc_status: "PASS",
      recommended_route: "HUMAN_REVIEW",
    });

    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.text).toMatch(/UPDATE caf_core\.content_jobs/);
    expect(call.text).toMatch(/generation_payload = COALESCE\(generation_payload, '\{\}'::jsonb\) \|\| \$2::jsonb/);
    expect(call.values[0]).toBe("PASS");
    const mergedJson = JSON.parse(String(call.values[1]));
    expect(mergedJson).toEqual({ qc_result: baseQc });
    expect(call.values[2]).toBe("HUMAN_REVIEW");
    expect(call.values[3]).toBe("job-id");
  });

  it("throws on bad input before touching the db", async () => {
    const db = {
      query: async () => {
        throw new Error("should not be called");
      },
    } as unknown as Pool;

    await expect(
      mergeGenerationPayloadQc(db, "job-id", { ...baseQc, blocking_count: -1 }, {
        qc_status: "PASS",
        recommended_route: "HUMAN_REVIEW",
      })
    ).rejects.toThrow();
  });
});
