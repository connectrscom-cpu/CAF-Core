import type { ScoredCandidate } from "./types.js";
import type { LearningRuleRow } from "../repositories/core.js";

function ruleMatchesCandidate(
  r: LearningRuleRow,
  c: ScoredCandidate
): boolean {
  if (r.scope_flow_type && r.scope_flow_type !== c.flow_type) return false;
  if (r.scope_platform && r.scope_platform !== (c.target_platform ?? c.platform)) return false;
  return true;
}

/** Apply rank boosts / penalties from learning rules (ranking family). */
export function applyLearningBoosts(
  scored: ScoredCandidate[],
  rules: LearningRuleRow[]
): ScoredCandidate[] {
  const relevant = rules.filter((r) =>
    ["BOOST_RANK", "SCORE_BOOST", "SCORE_PENALTY"].includes(r.action_type)
  );
  if (relevant.length === 0) return scored;

  return scored.map((c) => {
    let mult = 1;
    for (const r of relevant) {
      if (!ruleMatchesCandidate(r, c)) continue;
      const p = r.action_payload ?? {};
      if (r.action_type === "BOOST_RANK") {
        const delta = typeof p.multiplier === "number" ? p.multiplier : 1.05;
        mult *= delta;
      } else if (r.action_type === "SCORE_BOOST") {
        const b = typeof p.boost === "number" ? p.boost : typeof p.multiplier === "number" ? p.multiplier - 1 : 0.05;
        mult *= Math.min(2, Math.max(1, 1 + b));
      } else if (r.action_type === "SCORE_PENALTY") {
        const pen = typeof p.penalty === "number" ? p.penalty : -0.1;
        mult *= Math.max(0.05, 1 + pen);
      }
    }
    return {
      ...c,
      pre_gen_score: Math.min(1, Math.round(c.pre_gen_score * mult * 10000) / 10000),
    };
  });
}

export function sortByScoreDesc(candidates: ScoredCandidate[]): ScoredCandidate[] {
  return [...candidates].sort((a, b) => b.pre_gen_score - a.pre_gen_score);
}

export function dedupeByKey(candidates: ScoredCandidate[]): ScoredCandidate[] {
  const seen = new Set<string>();
  const out: ScoredCandidate[] = [];
  for (const c of candidates) {
    const key =
      c.dedupe_key ?? `${c.candidate_id}:${c.content_idea ?? ""}:${c.flow_type}:${c.target_platform ?? c.platform ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

// extend CandidateInput in types - we used content_idea optional - add to schema