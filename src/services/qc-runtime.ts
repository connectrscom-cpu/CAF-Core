/**
 * QC Runtime — applies QC checklists and risk policies to generated content.
 *
 * For a given content_job, loads the applicable QC checklist and risk policies,
 * runs each check against the generated output, and produces a structured result
 * with pass/fail, blocking issues, and risk flags.
 */
import type { Pool } from "pg";
import { qOne } from "../db/queries.js";
import { listQcChecks, listRiskPolicies, getFlowDefinition, type QcChecklistRow, type RiskPolicyRow } from "../repositories/flow-engine.js";
import { getBrandConstraints } from "../repositories/project-config.js";

export interface QcCheckResult {
  check_id: string;
  check_name: string | null;
  passed: boolean;
  severity: string;
  blocking: boolean;
  failure_message: string | null;
  details?: string;
}

export interface RiskFinding {
  policy_name: string;
  risk_category: string | null;
  severity: string;
  matched_terms: string[];
  action: string;
  requires_manual_review: boolean;
  block_publish: boolean;
}

export interface QcResult {
  task_id: string;
  flow_type: string;
  qc_passed: boolean;
  checks: QcCheckResult[];
  blocking_failures: QcCheckResult[];
  risk_findings: RiskFinding[];
  risk_level: string;
  recommended_route: string;
  qc_score: number;
}

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.replace(/\[\*\]/g, "").split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function runCheck(check: QcChecklistRow, content: Record<string, unknown>): QcCheckResult {
  const value = check.field_path ? getNestedValue(content, check.field_path) : undefined;

  let passed = true;
  let details: string | undefined;

  switch (check.check_type) {
    case "required_keys": {
      const paths = (check.field_path ?? "").split(";").map((s) => s.trim()).filter(Boolean);
      const missing = paths.filter((p) => getNestedValue(content, p) == null);
      passed = missing.length === 0;
      if (!passed) details = `Missing keys: ${missing.join(", ")}`;
      break;
    }
    case "equals": {
      const threshold = check.threshold_value ?? "";
      if (check.operator === "==" || check.operator === "equals") {
        if (Array.isArray(value)) {
          const expected = parseInt(threshold, 10);
          passed = !isNaN(expected) && value.length === expected;
          if (!passed) details = `Expected length ${expected}, got ${value.length}`;
        } else {
          passed = String(value) === threshold;
          if (!passed) details = `Expected ${threshold}, got ${String(value)}`;
        }
      }
      break;
    }
    case "min_length": {
      const min = parseInt(check.threshold_value ?? "0", 10);
      const len = typeof value === "string" ? value.length : Array.isArray(value) ? value.length : 0;
      passed = len >= min;
      if (!passed) details = `Length ${len} < minimum ${min}`;
      break;
    }
    case "max_length": {
      const max = parseInt(check.threshold_value ?? "999999", 10);
      const len = typeof value === "string" ? value.length : Array.isArray(value) ? value.length : 0;
      passed = len <= max;
      if (!passed) details = `Length ${len} > maximum ${max}`;
      break;
    }
    case "regex": {
      if (typeof value === "string" && check.threshold_value) {
        try {
          passed = new RegExp(check.threshold_value).test(value);
        } catch {
          passed = true;
        }
      }
      break;
    }
    case "not_empty": {
      passed = value != null && value !== "" && (typeof value !== "object" || (Array.isArray(value) ? value.length > 0 : Object.keys(value as object).length > 0));
      if (!passed) details = "Value is empty";
      break;
    }
    default: {
      passed = true;
      break;
    }
  }

  return {
    check_id: check.check_id,
    check_name: check.check_name,
    passed,
    severity: check.severity ?? "MEDIUM",
    blocking: check.blocking,
    failure_message: passed ? null : (check.failure_message ?? `Check ${check.check_id} failed`),
    details,
  };
}

function runRiskPolicy(policy: RiskPolicyRow, content: Record<string, unknown>, brandBanned: string[]): RiskFinding | null {
  const contentStr = JSON.stringify(content).toLowerCase();
  const terms = (policy.detection_terms ?? "").split(";").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const allTerms = [...terms, ...brandBanned];

  const matched: string[] = [];

  if (policy.detection_method === "keyword" || policy.detection_method === "both") {
    for (const term of allTerms) {
      if (contentStr.includes(term)) {
        matched.push(term);
      }
    }
  }

  if (matched.length === 0) return null;

  return {
    policy_name: policy.risk_policy_name,
    risk_category: policy.risk_category,
    severity: policy.severity_level ?? "MEDIUM",
    matched_terms: matched,
    action: policy.default_action ?? "route_to_manual",
    requires_manual_review: policy.requires_manual_review,
    block_publish: policy.block_publish,
  };
}

/**
 * Run QC checks and risk policies against a content_job's generated output.
 */
export async function runQcForJob(db: Pool, jobId: string): Promise<QcResult> {
  const job = await qOne<{
    id: string; task_id: string; project_id: string; flow_type: string;
    generation_payload: Record<string, unknown>;
  }>(db, `SELECT * FROM caf_core.content_jobs WHERE id = $1`, [jobId]);

  if (!job) throw new Error(`Job not found: ${jobId}`);

  const generatedOutput = (job.generation_payload?.generated_output as Record<string, unknown>) ?? {};
  const flowDef = await getFlowDefinition(db, job.flow_type);

  const checks = flowDef?.qc_checklist_name
    ? await listQcChecks(db, job.flow_type)
    : [];

  const policies = await listRiskPolicies(db);
  const brand = await getBrandConstraints(db, job.project_id);
  const brandBanned = (brand?.banned_words ?? "").split(";").map((w) => w.trim().toLowerCase()).filter(Boolean);

  const checkResults = checks.map((c) => runCheck(c, generatedOutput));
  const blockingFailures = checkResults.filter((r) => !r.passed && r.blocking);
  const riskFindings = policies
    .map((p) => runRiskPolicy(p, generatedOutput, brandBanned))
    .filter((f): f is RiskFinding => f !== null);

  const hasCriticalRisk = riskFindings.some((f) => f.severity === "CRITICAL");
  const hasHighRisk = riskFindings.some((f) => f.severity === "HIGH");
  const hasBlockPublish = riskFindings.some((f) => f.block_publish);
  const qcPassed = blockingFailures.length === 0 && !hasCriticalRisk;

  const passedCount = checkResults.filter((r) => r.passed).length;
  const qcScore = checks.length > 0 ? passedCount / checks.length : 1;

  let riskLevel = "LOW";
  if (hasCriticalRisk) riskLevel = "CRITICAL";
  else if (hasHighRisk) riskLevel = "HIGH";
  else if (riskFindings.length > 0) riskLevel = "MEDIUM";

  let recommendedRoute = "AUTO_PUBLISH";
  if (hasBlockPublish || hasCriticalRisk) recommendedRoute = "BLOCKED";
  else if (riskFindings.some((f) => String(f.action).toLowerCase() === "discard")) recommendedRoute = "DISCARD";
  else if (riskFindings.some((f) => String(f.action).toLowerCase().includes("rework"))) {
    recommendedRoute = "REWORK_REQUIRED";
  } else if (hasHighRisk || riskFindings.some((f) => f.requires_manual_review)) recommendedRoute = "HUMAN_REVIEW";
  else if (!qcPassed) recommendedRoute = "HUMAN_REVIEW";

  await db.query(`
    UPDATE caf_core.content_jobs SET
      qc_status = $1,
      generation_payload = generation_payload || $2::jsonb,
      recommended_route = $3,
      updated_at = now()
    WHERE id = $4
  `, [
    qcPassed ? "PASS" : "FAIL",
    JSON.stringify({
      qc_result: {
        passed: qcPassed,
        score: qcScore,
        blocking_count: blockingFailures.length,
        risk_level: riskLevel,
        risk_findings_count: riskFindings.length,
      },
    }),
    recommendedRoute,
    job.id,
  ]);

  return {
    task_id: job.task_id,
    flow_type: job.flow_type,
    qc_passed: qcPassed,
    checks: checkResults,
    blocking_failures: blockingFailures,
    risk_findings: riskFindings,
    risk_level: riskLevel,
    recommended_route: recommendedRoute,
    qc_score: qcScore,
  };
}
