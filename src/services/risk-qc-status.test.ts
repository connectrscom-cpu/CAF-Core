import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  QC_RUNTIME_RISK_SOURCES,
  buildRiskQcStatus,
  riskRulesNotEnforcedNotice,
} from "./risk-qc-status.js";

const here = dirname(fileURLToPath(import.meta.url));
const qcRuntimeSource = readFileSync(resolve(here, "qc-runtime.ts"), "utf8");

describe("buildRiskQcStatus", () => {
  it("reports that QC only uses risk_policies + brand_banned_words", () => {
    const s = buildRiskQcStatus(0);
    expect(s.qc_uses).toEqual([...QC_RUNTIME_RISK_SOURCES]);
    expect(s.risk_rules_enforced_by_qc).toBe(false);
  });

  it("flags unenforced risk_rules when count > 0", () => {
    const s = buildRiskQcStatus(3);
    expect(s.has_unenforced_risk_rules).toBe(true);
    expect(s.project_risk_rules_count).toBe(3);
    expect(s.message).toMatch(/3 risk_rule/);
  });

  it("is calm when project has no risk_rules", () => {
    const s = buildRiskQcStatus(0);
    expect(s.has_unenforced_risk_rules).toBe(false);
    expect(s.message).toMatch(/no risk_rules/);
  });

  it("clamps negative / fractional counts", () => {
    expect(buildRiskQcStatus(-1).project_risk_rules_count).toBe(0);
    expect(buildRiskQcStatus(2.7).project_risk_rules_count).toBe(2);
  });
});

describe("riskRulesNotEnforcedNotice", () => {
  it("returns a stable, narrow notice shape", () => {
    const n = riskRulesNotEnforcedNotice();
    expect(n.risk_rules_enforced_by_qc).toBe(false);
    expect(n.qc_uses).toEqual([...QC_RUNTIME_RISK_SOURCES]);
    expect(n.docs_path).toBe("docs/RISK_RULES.md");
    expect(n.message).toMatch(/risk_rules are not applied/i);
    expect(n.message).toMatch(/risk_policies/);
    expect(n.message).toMatch(/banned_words/);
  });

  it("does not leak project-specific state", () => {
    // Two calls must produce equal, independent objects.
    const a = riskRulesNotEnforcedNotice();
    const b = riskRulesNotEnforcedNotice();
    expect(a).toEqual(b);
    expect(a).not.toBe(b);
  });
});

describe("qc-runtime risk sources (honesty assertion)", () => {
  it("does not reference caf_core.risk_rules", () => {
    expect(qcRuntimeSource).not.toMatch(/risk_rules/);
    expect(qcRuntimeSource).not.toMatch(/listRiskRules/);
  });

  it("does reference the documented QC risk sources", () => {
    expect(qcRuntimeSource).toMatch(/listRiskPolicies/);
    expect(qcRuntimeSource).toMatch(/getBrandConstraints/);
  });
});
