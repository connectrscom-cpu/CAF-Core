/**
 * Rule lifecycle suggestions (read-only advisor).
 *
 * Combines the per-rule effectiveness scorecard with rule metadata and emits
 * operator suggestions: retire rules that measurably hurt outcomes, renew /
 * keep rules that help, flag dead rules that never match anything, and — for
 * ranking-family rules — suggest a data-driven multiplier from the observed
 * approval lift (holdout delta preferred over baseline delta).
 *
 * Nothing here mutates learning_rules. Operators act through the existing
 * apply / retire / dismiss endpoints; this endpoint just tells them where to
 * look and why.
 */
import type { Pool } from "pg";
import {
  getRuleEffectivenessForProject,
  type RuleEffectiveness,
} from "./learning-rule-effectiveness.js";

export type LifecycleSuggestionKind =
  | "retire"
  | "renew"
  | "adjust_weight"
  | "needs_more_data"
  | "dead_rule";

export interface RuleLifecycleSuggestion {
  rule_id: string;
  suggestion: LifecycleSuggestionKind;
  reason: string;
  /** Which delta backed the call: holdout beats baseline when available. */
  evidence: "holdout" | "baseline" | "none";
  approval_delta: number | null;
  decided_tasks: number;
  /** Ranking rules only: multiplier implied by the observed lift. */
  suggested_multiplier: number | null;
  current_multiplier: number | null;
  action_type: string | null;
  status: string | null;
}

export interface LifecycleSuggestionOptions {
  /** Delta at/below which an active rule should be retired (default -0.10). */
  retire_below_delta?: number;
  /** Delta at/above which a rule is confirmed working (default +0.05). */
  renew_at_or_above_delta?: number;
  /** Relative change needed before suggesting a weight adjustment (default 0.05). */
  min_multiplier_change?: number;
}

const RANKING_ACTIONS = new Set(["BOOST_RANK", "SCORE_BOOST", "SCORE_PENALTY"]);

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Extract the effective multiplier a ranking rule applies today. */
export function currentRuleMultiplier(
  actionType: string | null,
  actionPayload: Record<string, unknown> | null
): number | null {
  if (!actionType || !RANKING_ACTIONS.has(actionType)) return null;
  const p = actionPayload ?? {};
  if (actionType === "BOOST_RANK") {
    return typeof p.multiplier === "number" ? p.multiplier : 1.05;
  }
  if (actionType === "SCORE_BOOST") {
    const b =
      typeof p.boost === "number"
        ? p.boost
        : typeof p.multiplier === "number"
          ? p.multiplier - 1
          : 0.05;
    return clamp(1 + b, 1, 2);
  }
  // SCORE_PENALTY
  const pen = typeof p.penalty === "number" ? p.penalty : -0.1;
  return Math.max(0.05, 1 + pen);
}

/**
 * Map an observed approval delta to a suggested ranking multiplier.
 * A rule that lifts approvals by +10pp earns ~1.10; one that costs 10pp earns
 * ~0.90. Clamped to [0.7, 1.3] — planning boosts should nudge, not dominate.
 */
export function multiplierFromApprovalDelta(delta: number): number {
  return round4(clamp(1 + delta, 0.7, 1.3));
}

export interface RuleForLifecycle {
  effectiveness: RuleEffectiveness;
  action_type: string | null;
  status: string | null;
  action_payload: Record<string, unknown> | null;
}

/** Pure: one suggestion per rule that warrants operator attention. */
export function suggestRuleLifecycle(
  rules: RuleForLifecycle[],
  opts?: LifecycleSuggestionOptions
): RuleLifecycleSuggestion[] {
  const retireBelow = opts?.retire_below_delta ?? -0.1;
  const renewAt = opts?.renew_at_or_above_delta ?? 0.05;
  const minMultChange = Math.max(0.005, opts?.min_multiplier_change ?? 0.05);

  const out: RuleLifecycleSuggestion[] = [];
  for (const { effectiveness: e, action_type, status, action_payload } of rules) {
    const isActive = status === "active";
    const currentMult = currentRuleMultiplier(action_type, action_payload);

    // Prefer holdout (treatment vs control) evidence when it exists and is decided.
    let delta: number | null = null;
    let evidence: RuleLifecycleSuggestion["evidence"] = "none";
    if (e.holdout && e.holdout.approval_delta_vs_control != null && e.holdout.control_decided >= 3) {
      delta = e.holdout.approval_delta_vs_control;
      evidence = "holdout";
    } else if (e.approval_delta_vs_baseline != null) {
      delta = e.approval_delta_vs_baseline;
      evidence = "baseline";
    }

    const base = {
      rule_id: e.rule_id,
      approval_delta: delta,
      decided_tasks: e.decided_tasks,
      suggested_multiplier: null as number | null,
      current_multiplier: currentMult,
      action_type,
      status,
    };

    if (isActive && e.attributed_tasks === 0) {
      out.push({
        ...base,
        suggestion: "dead_rule",
        evidence: "none",
        reason:
          "Active rule with zero attributed tasks in the window — scope may not match any planned/generated work. Consider narrowing scope or retiring.",
      });
      continue;
    }

    if (!e.sample_sufficient || delta == null) {
      // Only surface insufficient-data entries for active rules; pending/expired
      // rules without data are just noise.
      if (isActive && e.attributed_tasks > 0) {
        out.push({
          ...base,
          suggestion: "needs_more_data",
          evidence,
          reason: `Only ${e.decided_tasks} decided task(s) attributed — below the significance threshold. Keep collecting before judging.`,
        });
      }
      continue;
    }

    if (isActive && delta <= retireBelow) {
      out.push({
        ...base,
        suggestion: "retire",
        evidence,
        reason: `Approval rate is ${Math.round(delta * 100)}pp ${evidence === "holdout" ? "below its own control group" : "below the project baseline"} across ${e.decided_tasks} decided tasks. Retire or rescope.`,
      });
      continue;
    }

    if (delta >= renewAt) {
      const suggestedMult = currentMult != null ? multiplierFromApprovalDelta(delta) : null;
      const wantsAdjust =
        suggestedMult != null &&
        currentMult != null &&
        Math.abs(suggestedMult - currentMult) >= minMultChange;
      if (wantsAdjust) {
        out.push({
          ...base,
          suggestion: "adjust_weight",
          evidence,
          suggested_multiplier: suggestedMult,
          reason: `Observed +${Math.round(delta * 100)}pp approval lift (${evidence}) implies multiplier ~${suggestedMult}; rule currently applies ${currentMult}.`,
        });
      } else {
        out.push({
          ...base,
          suggestion: "renew",
          evidence,
          suggested_multiplier: suggestedMult,
          reason: `Approval rate is +${Math.round(delta * 100)}pp vs ${evidence === "holdout" ? "control" : "baseline"} across ${e.decided_tasks} decided tasks — keep active${e.holdout ? "" : "; consider a holdout to confirm causality"}.`,
        });
      }
      continue;
    }

    // Middle band: measurable but unremarkable — only flag ranking rules whose
    // configured weight is far from what the evidence supports.
    if (isActive && currentMult != null) {
      const suggestedMult = multiplierFromApprovalDelta(delta);
      if (Math.abs(suggestedMult - currentMult) >= minMultChange * 2) {
        out.push({
          ...base,
          suggestion: "adjust_weight",
          evidence,
          suggested_multiplier: suggestedMult,
          reason: `Configured multiplier ${currentMult} is out of line with observed ${Math.round(delta * 100)}pp approval delta (${evidence}); evidence supports ~${suggestedMult}.`,
        });
      }
    }
  }

  const order: Record<LifecycleSuggestionKind, number> = {
    retire: 0,
    adjust_weight: 1,
    renew: 2,
    dead_rule: 3,
    needs_more_data: 4,
  };
  out.sort(
    (a, b) => order[a.suggestion] - order[b.suggestion] || b.decided_tasks - a.decided_tasks
  );
  return out;
}

export async function getRuleLifecycleSuggestionsForProject(
  db: Pool,
  projectId: string,
  opts?: LifecycleSuggestionOptions & { window_days?: number; min_decided?: number }
): Promise<{
  window_days: number;
  suggestions: RuleLifecycleSuggestion[];
}> {
  const windowDays = Math.max(1, Math.min(365, opts?.window_days ?? 90));
  const report = await getRuleEffectivenessForProject(db, projectId, {
    window_days: windowDays,
    min_decided: opts?.min_decided,
  });

  // Effectiveness already joins rule metadata but not action_payload; fetch it
  // for the rules present in the report so weight suggestions can compare.
  const ruleIds = report.rules.map((r) => r.rule_id);
  const payloadById = new Map<string, Record<string, unknown> | null>();
  if (ruleIds.length > 0) {
    const rows = await db.query<{ rule_id: string; action_payload: Record<string, unknown> | null }>(
      `SELECT rule_id, action_payload FROM caf_core.learning_rules
       WHERE project_id = $1 AND rule_id = ANY($2::text[])`,
      [projectId, ruleIds]
    );
    for (const r of rows.rows) payloadById.set(r.rule_id, r.action_payload);
  }

  const suggestions = suggestRuleLifecycle(
    report.rules.map((r) => ({
      effectiveness: r,
      action_type: r.action_type,
      status: r.status,
      action_payload: payloadById.get(r.rule_id) ?? null,
    })),
    opts
  );
  return { window_days: windowDays, suggestions };
}
