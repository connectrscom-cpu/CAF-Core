import type { Pool } from "pg";
import { qOne } from "../db/queries.js";
import type { SuppressionRuleRow } from "../repositories/core.js";
import { getRejectionRateForScope } from "../repositories/core.js";
import type { CandidateInput, SuppressionReason } from "./types.js";

export interface KillSwitchResult {
  hardStop: boolean;
  reasons: SuppressionReason[];
  blockedFlowTypes: Set<string>;
}

async function qcFailRate(db: Pool, projectId: string, flowType: string | null, windowDays: number): Promise<number> {
  const row = await qOne<{ rate: string }>(
    db,
    `SELECT CASE WHEN COUNT(*) = 0 THEN 0::float8
            ELSE (COUNT(*) FILTER (
              WHERE jsonb_array_length(COALESCE(a.failure_types, '[]'::jsonb)) > 0
            ))::float8 / COUNT(*)::float8 END AS rate
     FROM caf_core.diagnostic_audits a
     INNER JOIN caf_core.content_jobs j ON j.task_id = a.task_id AND j.project_id = a.project_id
     WHERE a.project_id = $1
       AND ($2::text IS NULL OR j.flow_type = $2)
       AND a.created_at > now() - make_interval(days => $3)`,
    [projectId, flowType, windowDays]
  );
  return row ? parseFloat(row.rate) : 0;
}

async function avgStabilizedEngagement(
  db: Pool,
  projectId: string,
  flowType: string | null,
  windowDays: number
): Promise<number> {
  const row = await qOne<{ avg: string }>(
    db,
    `SELECT COALESCE(AVG(m.engagement_rate), 0)::text AS avg
     FROM caf_core.performance_metrics m
     LEFT JOIN caf_core.content_jobs j ON j.task_id = m.task_id AND j.project_id = m.project_id
     WHERE m.project_id = $1
       AND m.metric_window = 'stabilized'
       AND m.created_at > now() - make_interval(days => $2)
       AND ($3::text IS NULL OR j.flow_type = $3)`,
    [projectId, windowDays, flowType]
  );
  return row ? parseFloat(row.avg) : 0;
}

/**
 * Project-wide gates (daily cap checked separately) + rule evaluation.
 */
export async function evaluateKillSwitches(
  db: Pool,
  projectId: string,
  rules: SuppressionRuleRow[],
  _candidates: CandidateInput[]
): Promise<KillSwitchResult> {
  const reasons: SuppressionReason[] = [];
  const blockedFlowTypes = new Set<string>();
  let hardStop = false;

  for (const rule of rules) {
    const window = rule.window_days ?? 7;
    const threshold = rule.threshold_numeric ? parseFloat(rule.threshold_numeric) : null;

    switch (rule.rule_type) {
      case "BLOCK_FLOW": {
        if (rule.scope_flow_type) blockedFlowTypes.add(rule.scope_flow_type);
        reasons.push({
          code: "BLOCK_FLOW",
          message: `Flow blocked by rule ${rule.id}: ${rule.scope_flow_type ?? "unknown"}`,
          rule_id: rule.id,
        });
        break;
      }
      case "REJECTION_RATE": {
        if (threshold === null) break;
        const rate = await getRejectionRateForScope(db, projectId, rule.scope_flow_type, window);
        if (rate > threshold) {
          if (rule.action === "BLOCK_FLOW" && rule.scope_flow_type) {
            blockedFlowTypes.add(rule.scope_flow_type);
          }
          reasons.push({
            code: "REJECTION_RATE",
            message: `Rejection rate ${(rate * 100).toFixed(1)}% > threshold ${(threshold * 100).toFixed(1)}%`,
            rule_id: rule.id,
          });
          if (rule.action === "BLOCK_FLOW" && !rule.scope_flow_type) hardStop = true;
        }
        break;
      }
      case "QC_FAIL_RATE": {
        if (threshold === null) break;
        const rate = await qcFailRate(db, projectId, rule.scope_flow_type, window);
        if (rate > threshold) {
          reasons.push({
            code: "QC_FAIL_RATE",
            message: `QC fail rate ${(rate * 100).toFixed(1)}% > ${(threshold * 100).toFixed(1)}%`,
            rule_id: rule.id,
          });
          if (rule.action === "BLOCK_FLOW") {
            if (rule.scope_flow_type) blockedFlowTypes.add(rule.scope_flow_type);
            else hardStop = true;
          }
        }
        break;
      }
      case "ENGAGEMENT_FLOOR": {
        if (threshold === null) break;
        const avg = await avgStabilizedEngagement(db, projectId, rule.scope_flow_type, window);
        if (avg < threshold) {
          reasons.push({
            code: "ENGAGEMENT_FLOOR",
            message: `Stabilized engagement avg ${avg.toFixed(4)} < floor ${threshold}`,
            rule_id: rule.id,
          });
          if (rule.action === "BLOCK_FLOW" && rule.scope_flow_type) blockedFlowTypes.add(rule.scope_flow_type);
        }
        break;
      }
      case "BLOCK_PROMPT_VERSION":
        reasons.push({
          code: "BLOCK_PROMPT_VERSION",
          message: `Prompt version block active (rule ${rule.id})`,
          rule_id: rule.id,
        });
        break;
      default:
        break;
    }
  }

  return { hardStop, reasons, blockedFlowTypes };
}
