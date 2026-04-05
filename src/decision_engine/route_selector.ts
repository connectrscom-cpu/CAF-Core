import type { CandidateInput } from "./types.js";

/**
 * Route selection: high risk / low score → human review; otherwise auto path when allowed.
 */
export function selectRoute(
  candidate: CandidateInput & { pre_gen_score: number },
  opts: { autoValidationThreshold: number | null; riskScore?: number }
): string {
  const risk = opts.riskScore ?? 0;
  if (risk >= 0.7) return "HUMAN_REVIEW";
  if (candidate.recommended_route === "HUMAN_REVIEW") return "HUMAN_REVIEW";
  if (opts.autoValidationThreshold !== null && candidate.pre_gen_score < opts.autoValidationThreshold) {
    return "HUMAN_REVIEW";
  }
  return candidate.recommended_route && candidate.recommended_route !== "" ? candidate.recommended_route : "AUTO_PUBLISH";
}
