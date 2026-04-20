/**
 * Risk-QC honesty helper.
 *
 * CAF Core's QC runtime (`src/services/qc-runtime.ts`) enforces risk only
 * through two sources:
 *   1. `caf_core.risk_policies` (global, keyword scan)
 *   2. `brand_constraints.banned_words` (project scope, keyword scan)
 *
 * The project-scoped `caf_core.risk_rules` table is populated by operators
 * (via CSV import or the `/v1/projects/:slug/risk-rules` endpoints) but is
 * NOT consumed by `runQcForJob`. This creates a silent expectation gap:
 * an operator can add project risk rules and assume they will gate output,
 * while QC ignores them.
 *
 * This module exists so the API and admin UI can surface that asymmetry
 * truthfully. The shape is deliberately narrow and pure so it can be unit
 * tested without a database.
 */

/** The risk sources that the QC runtime actually consults today. */
export const QC_RUNTIME_RISK_SOURCES = [
  "risk_policies",
  "brand_banned_words",
] as const;

export type QcRuntimeRiskSource = (typeof QC_RUNTIME_RISK_SOURCES)[number];

export interface RiskQcStatus {
  /** Which data sources the QC runtime actually reads to flag risk. */
  qc_uses: QcRuntimeRiskSource[];
  /** How many rows the project has in `caf_core.risk_rules`. */
  project_risk_rules_count: number;
  /** Whether `risk_rules` are enforced by the QC runtime. Always false today. */
  risk_rules_enforced_by_qc: boolean;
  /**
   * True when the project has `risk_rules` configured that QC will not run.
   * Operators should treat this as a documentation/expectations mismatch.
   */
  has_unenforced_risk_rules: boolean;
  /** Short, stable message suitable for admin banners. */
  message: string;
  /** Path to the authoritative doc. */
  docs_path: string;
}

/**
 * Narrow notice suitable for attaching to any risk_rules write/read response.
 * Intentionally smaller than `RiskQcStatus` so API responses stay focused.
 */
export interface RiskRulesNotice {
  /** Always false today — QC does not apply `risk_rules`. */
  risk_rules_enforced_by_qc: boolean;
  /** The sources QC actually uses (stable, canonical). */
  qc_uses: QcRuntimeRiskSource[];
  /** Short, human-friendly reminder for UI banners. */
  message: string;
  /** Path to the authoritative doc. */
  docs_path: string;
}

/**
 * Build the smaller notice shape for risk_rules endpoints. Use this on
 * POST/GET/DELETE `/v1/projects/:slug/risk-rules` responses and on CSV
 * import warnings so operators cannot miss the fact that these rows are
 * documentation, not enforcement. Pure — no DB.
 */
export function riskRulesNotEnforcedNotice(): RiskRulesNotice {
  return {
    risk_rules_enforced_by_qc: false,
    qc_uses: [...QC_RUNTIME_RISK_SOURCES],
    message:
      "risk_rules are not applied by the QC runtime. QC only enforces risk_policies and brand banned_words. See docs/RISK_RULES.md and GET /v1/projects/:slug/risk-qc-status.",
    docs_path: "docs/RISK_RULES.md",
  };
}

/**
 * Build the risk-QC honesty status from raw project state.
 *
 * Pure function — no DB or IO. Wire it into a route by fetching
 * `countRiskRules(db, projectId)` and passing the number in.
 */
export function buildRiskQcStatus(projectRiskRulesCount: number): RiskQcStatus {
  const count = Math.max(0, Math.floor(projectRiskRulesCount));
  const hasUnenforced = count > 0;
  return {
    qc_uses: [...QC_RUNTIME_RISK_SOURCES],
    project_risk_rules_count: count,
    risk_rules_enforced_by_qc: false,
    has_unenforced_risk_rules: hasUnenforced,
    message: hasUnenforced
      ? `This project has ${count} risk_rule row(s) that QC does not apply. QC only enforces risk_policies and brand banned_words.`
      : "QC enforces risk_policies and brand banned_words. This project has no risk_rules configured.",
    docs_path: "docs/RISK_RULES.md",
  };
}
