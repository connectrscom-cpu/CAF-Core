/**
 * QC Runtime — applies QC checklists and risk policies to generated content.
 *
 * For a given content_job, loads the applicable QC checklist and risk policies,
 * runs each check against the generated output, and produces a structured result
 * with pass/fail, blocking issues, and risk flags.
 */
import type { Pool } from "pg";
import { qOne } from "../db/queries.js";
import { isCarouselFlow } from "../decision_engine/flow-kind.js";
import { listQcChecks, listRiskPolicies, getFlowDefinition, type QcChecklistRow, type RiskPolicyRow } from "../repositories/flow-engine.js";
import { getBrandConstraints } from "../repositories/project-config.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";

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

/** Persisted under generation_payload.qc_result for admin UI and list views. */
export interface QcResultPayload {
  passed: boolean;
  score: number;
  blocking_count: number;
  risk_level: string;
  risk_findings_count: number;
  recommended_route: string;
  /** First line for jobs table / tooltips (≤200 chars). */
  reason_short?: string;
  /** Human-readable lines: failed checks + blocking/critical risks. */
  reasons?: string[];
  blocking_checks?: Array<{
    check_id: string;
    check_name: string | null;
    failure_message: string | null;
    details?: string | null;
    severity: string;
  }>;
  blocking_risk_policies?: Array<{
    policy_name: string;
    severity: string;
    matched_terms: string[];
  }>;
}

export function buildQcResultPayload(args: {
  qcPassed: boolean;
  qcScore: number;
  checkResults: QcCheckResult[];
  blockingFailures: QcCheckResult[];
  riskFindings: RiskFinding[];
  riskLevel: string;
  recommendedRoute: string;
}): QcResultPayload {
  const { qcPassed, qcScore, checkResults, blockingFailures, riskFindings, riskLevel, recommendedRoute } = args;

  const riskBlocking = riskFindings.filter((r) => r.block_publish || r.severity === "CRITICAL");

  const reasons: string[] = [];
  for (const f of blockingFailures) {
    const parts = [f.check_name || f.check_id, f.failure_message, f.details].filter(
      (x) => x != null && String(x).trim() !== ""
    );
    if (parts.length > 0) reasons.push(parts.join(" — "));
  }
  for (const r of riskBlocking) {
    const terms = r.matched_terms.slice(0, 12).join(", ");
    reasons.push(
      `Risk policy "${r.policy_name}" (${r.severity})${terms ? ` — matched: ${terms}` : ""}`
    );
  }
  if (reasons.length === 0 && !qcPassed) {
    for (const f of checkResults.filter((r) => !r.passed)) {
      const parts = [f.check_name || f.check_id, f.failure_message, f.details].filter(
        (x) => x != null && String(x).trim() !== ""
      );
      if (parts.length > 0) {
        reasons.push(parts.join(" — ") + (f.blocking ? "" : " (non-blocking)"));
      }
    }
  }

  const reason_short = reasons[0]?.slice(0, 200) ?? "";

  const payload: QcResultPayload = {
    passed: qcPassed,
    score: qcScore,
    blocking_count: blockingFailures.length,
    risk_level: riskLevel,
    risk_findings_count: riskFindings.length,
    recommended_route: recommendedRoute,
  };

  if (reason_short.trim()) payload.reason_short = reason_short.trim();
  if (reasons.length > 0) payload.reasons = reasons;
  if (blockingFailures.length > 0) {
    payload.blocking_checks = blockingFailures.map((f) => ({
      check_id: f.check_id,
      check_name: f.check_name,
      failure_message: f.failure_message,
      details: f.details ?? null,
      severity: f.severity,
    }));
  }
  if (riskBlocking.length > 0) {
    payload.blocking_risk_policies = riskBlocking.map((r) => ({
      policy_name: r.policy_name,
      severity: r.severity,
      matched_terms: r.matched_terms.slice(0, 30),
    }));
  }

  return payload;
}

/**
 * Shape stored qc_result for admin / API (handles pre-migration rows with only counts).
 */
export function qcDetailFromGenerationPayload(
  generationPayload: Record<string, unknown> | null | undefined
): QcResultPayload | null {
  const qr = generationPayload?.qc_result;
  if (!qr || typeof qr !== "object" || Array.isArray(qr)) return null;
  return qr as QcResultPayload;
}

/**
 * Resolve dotted paths against generated JSON. Supports `variations[*].slides` (and similar) by
 * requiring each array element to have the suffix path; returns the first element's value for
 * length/threshold checks (e.g. slide count vs structure_variables).
 */
export function resolveGeneratedOutputPath(obj: Record<string, unknown>, path: string): unknown {
  const star = /^([^[.]+)\[\*\]\.(.+)$/.exec(path.trim());
  if (star) {
    const arrKey = star[1]!;
    const suffix = star[2]!;
    const subParts = suffix.split(".").filter(Boolean);
    const arr = obj[arrKey];
    if (!Array.isArray(arr) || arr.length === 0) return undefined;
    for (const item of arr) {
      if (!item || typeof item !== "object" || Array.isArray(item)) return undefined;
      let cur: unknown = item;
      for (const p of subParts) {
        if (cur == null || typeof cur !== "object") return undefined;
        cur = (cur as Record<string, unknown>)[p];
      }
      if (cur == null) return undefined;
    }
    let firstVal: unknown = arr[0];
    for (const p of subParts) {
      if (firstVal == null || typeof firstVal !== "object" || Array.isArray(firstVal)) return undefined;
      firstVal = (firstVal as Record<string, unknown>)[p];
    }
    return firstVal;
  }

  const parts = path.replace(/\[\*\]/g, "").split(".").filter(Boolean);
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    if (Array.isArray(current)) {
      const idx = parseInt(part, 10);
      if (!Number.isFinite(idx) || idx < 0 || idx >= current.length) return undefined;
      current = current[idx];
      continue;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function coerceSlideCountValue(v: unknown): number | undefined {
  if (v == null) return undefined;
  if (typeof v === "number" && Number.isFinite(v)) return Math.floor(v);
  const n = parseInt(String(v).trim(), 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * Expected slide count for QC `equals` when threshold is a Sheets/n8n template literal
 * (e.g. `{{structure_variables.slide_count}}`) or plain numeric string.
 */
export function resolveExpectedSlideCountFromQcThreshold(
  content: Record<string, unknown>,
  thresholdRaw: string
): number | undefined {
  const t = thresholdRaw.trim();
  if (!t) return undefined;
  const direct = coerceSlideCountValue(t);
  if (!t.includes("{{") && direct != null) return direct;
  const fromStruct = coerceSlideCountValue(resolveGeneratedOutputPath(content, "structure_variables.slide_count"));
  if (fromStruct != null) return fromStruct;
  return coerceSlideCountValue(content.slide_count);
}

const CAROUSEL_SLIDE_ARRAY_PATHS_TRY = ["slides", "variations[*].slides", "variations.0.slides"] as const;

/** Resolve the canonical slides[] (or first variation's slides) for carousel QC. */
export function resolveCarouselSlidesArrayForQc(
  content: Record<string, unknown>,
  primaryFieldPath: string | null | undefined
): unknown[] | undefined {
  const tryOrder: string[] = [];
  if (primaryFieldPath?.trim()) tryOrder.push(primaryFieldPath.trim());
  for (const p of CAROUSEL_SLIDE_ARRAY_PATHS_TRY) {
    if (!tryOrder.includes(p)) tryOrder.push(p);
  }
  for (const p of tryOrder) {
    const v = resolveGeneratedOutputPath(content, p);
    if (Array.isArray(v)) return v;
  }
  return undefined;
}

function isCarouselSlideCountEqualsCheck(check: QcChecklistRow): boolean {
  const id = (check.check_id ?? "").toUpperCase();
  const name = (check.check_name ?? "").toLowerCase();
  const fm = (check.failure_message ?? "").toLowerCase();
  const fp = (check.field_path ?? "").toLowerCase();
  const tv = check.threshold_value ?? "";
  return (
    id === "CI_002" ||
    id.includes("SLIDE_COUNT") ||
    (name.includes("slide") && name.includes("count")) ||
    fm.includes("slide count") ||
    fp.endsWith(".slides") ||
    fp.includes("slides") ||
    /\{\{\s*structure_variables\.slide_count\s*\}\}/.test(tv)
  );
}

function tryCarouselSlideCountEquals(
  check: QcChecklistRow,
  content: Record<string, unknown>,
  value: unknown,
  threshold: string
): { handled: boolean; passed: boolean; details?: string } {
  if (!isCarouselSlideCountEqualsCheck(check)) return { handled: false, passed: true };

  const slidesArr: unknown[] | undefined = Array.isArray(value)
    ? value
    : resolveCarouselSlidesArrayForQc(content, check.field_path);

  if (!slidesArr) {
    return {
      handled: true,
      passed: false,
      details: `Slide count check: could not resolve slides array (field_path: ${check.field_path ?? "—"})`,
    };
  }

  let expected = resolveExpectedSlideCountFromQcThreshold(content, threshold);
  if (expected == null) {
    const p = parseInt(threshold.trim(), 10);
    if (Number.isFinite(p)) expected = p;
  }

  if (expected == null) {
    return {
      handled: true,
      passed: false,
      details: `Could not resolve expected slide count from threshold "${threshold.slice(0, 120)}"`,
    };
  }

  const ok = slidesArr.length === expected;
  return {
    handled: true,
    passed: ok,
    details: ok ? undefined : `Expected ${expected} slides, got ${slidesArr.length}`,
  };
}

/**
 * True if `term` appears in `contentStrLower` as a keyword hit.
 * Single-word terms use \\b word boundaries so "psycho" does not match "psychology" / "psychological".
 * Phrases (whitespace in term) still use substring match.
 */
export function riskDetectionTermMatches(contentStrLower: string, termLower: string): boolean {
  const t = termLower.trim().toLowerCase();
  if (!t) return false;
  if (/\s/.test(t)) return contentStrLower.includes(t);
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(`\\b${escaped}\\b`).test(contentStrLower);
  } catch {
    return contentStrLower.includes(t);
  }
}

function runCheck(check: QcChecklistRow, content: Record<string, unknown>): QcCheckResult {
  const value = check.field_path ? resolveGeneratedOutputPath(content, check.field_path) : undefined;

  let passed = true;
  let details: string | undefined;

  switch (check.check_type) {
    case "required_keys": {
      const paths = (check.field_path ?? "").split(";").map((s) => s.trim()).filter(Boolean);
      const missing = paths.filter((p) => resolveGeneratedOutputPath(content, p) == null);
      passed = missing.length === 0;
      if (!passed) details = `Missing keys: ${missing.join(", ")}`;
      break;
    }
    case "equals": {
      const threshold = check.threshold_value ?? "";
      if (check.operator === "==" || check.operator === "equals") {
        const slideEq = tryCarouselSlideCountEquals(check, content, value, threshold);
        if (slideEq.handled) {
          passed = slideEq.passed;
          details = slideEq.details;
          break;
        }
        if (Array.isArray(value)) {
          let expected = parseInt(threshold, 10);
          if (isNaN(expected)) {
            expected = resolveExpectedSlideCountFromQcThreshold(content, threshold) ?? NaN;
          }
          passed = !isNaN(expected) && value.length === expected;
          if (!passed) {
            details = !isNaN(expected)
              ? `Expected length ${expected}, got ${value.length}`
              : `Expected slide count from threshold, got ${value.length} slides (unparsed threshold: ${threshold.slice(0, 80)})`;
          }
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

/** For unit tests — same as internal `runCheck`. */
export function runQcChecklistRow(check: QcChecklistRow, content: Record<string, unknown>): QcCheckResult {
  return runCheck(check, content);
}

function runRiskPolicy(policy: RiskPolicyRow, content: Record<string, unknown>, brandBanned: string[]): RiskFinding | null {
  const contentStr = JSON.stringify(content).toLowerCase();
  const terms = (policy.detection_terms ?? "").split(";").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const allTerms = [...terms, ...brandBanned];

  const matched: string[] = [];

  if (policy.detection_method === "keyword" || policy.detection_method === "both") {
    for (const term of allTerms) {
      if (riskDetectionTermMatches(contentStr, term)) {
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

  let qcContent = (job.generation_payload?.generated_output as Record<string, unknown>) ?? {};
  if (isCarouselFlow(job.flow_type) && Object.keys(qcContent).length > 0) {
    qcContent = normalizeLlmParsedForSchemaValidation(job.flow_type, { ...qcContent });
    await db.query(
      `UPDATE caf_core.content_jobs
       SET generation_payload = jsonb_set(
         COALESCE(generation_payload, '{}'::jsonb),
         '{generated_output}',
         $1::jsonb,
         true
       ),
       updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(qcContent), job.id]
    );
  }

  const flowDef = await getFlowDefinition(db, job.flow_type);

  const checks = flowDef?.qc_checklist_name
    ? await listQcChecks(db, job.flow_type)
    : [];

  const policies = await listRiskPolicies(db);
  const brand = await getBrandConstraints(db, job.project_id);
  const brandBanned = (brand?.banned_words ?? "").split(";").map((w) => w.trim().toLowerCase()).filter(Boolean);

  const checkResults = checks.map((c) => runCheck(c, qcContent));
  const blockingFailures = checkResults.filter((r) => !r.passed && r.blocking);
  const riskFindings = policies
    .map((p) => runRiskPolicy(p, qcContent, brandBanned))
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

  const cand = (job.generation_payload?.candidate_data as Record<string, unknown>) ?? {};
  const candRoute = String(cand.recommended_route ?? cand.recommendedRoute ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
  if (candRoute === "HUMAN_REVIEW" && recommendedRoute === "AUTO_PUBLISH") {
    recommendedRoute = "HUMAN_REVIEW";
  }

  const qcPayload = buildQcResultPayload({
    qcPassed,
    qcScore,
    checkResults,
    blockingFailures,
    riskFindings,
    riskLevel,
    recommendedRoute,
  });

  await db.query(`
    UPDATE caf_core.content_jobs SET
      qc_status = $1,
      generation_payload = generation_payload || $2::jsonb,
      recommended_route = $3,
      updated_at = now()
    WHERE id = $4
  `, [qcPassed ? "PASS" : "FAIL", JSON.stringify({ qc_result: qcPayload }), recommendedRoute, job.id]);

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
