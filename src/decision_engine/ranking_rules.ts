import type { ScoredCandidate } from "./types.js";
import type { LearningRuleRow } from "../repositories/core.js";

/** Apply rank boosts from learning rules (BOOST_RANK in action_payload) */
export function applyLearningBoosts(
  scored: ScoredCandidate[],
  rules: LearningRuleRow[]
): ScoredCandidate[] {
  const boosts = rules.filter((r) => r.action_type === "BOOST_RANK");
  if (boosts.length === 0) return scored;

  return scored.map((c) => {
    let mult = 1;
    for (const r of boosts) {
      if (r.scope_flow_type && r.scope_flow_type !== c.flow_type) continue;
      if (r.scope_platform && r.scope_platform !== (c.target_platform ?? c.platform)) continue;
      const delta = typeof r.action_payload?.multiplier === "number" ? r.action_payload.multiplier : 1.05;
      mult *= delta;
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