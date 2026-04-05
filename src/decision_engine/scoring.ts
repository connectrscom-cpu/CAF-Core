import type { AppConfig } from "../config.js";
import type { CandidateInput, ScoredCandidate } from "./types.js";

export interface ScoreWeights {
  confidence: number;
  platform_fit: number;
  novelty: number;
  past_performance: number;
}

export function defaultWeights(config: AppConfig): ScoreWeights {
  return {
    confidence: config.SCORE_WEIGHT_CONFIDENCE,
    platform_fit: config.SCORE_WEIGHT_PLATFORM_FIT,
    novelty: config.SCORE_WEIGHT_NOVELTY,
    past_performance: config.SCORE_WEIGHT_PAST_PERF,
  };
}

/** Normalize confidence from various legacy scales to 0–1 */
function normConfidence(raw: number | undefined): number {
  if (raw === undefined || Number.isNaN(raw)) return 0.5;
  if (raw >= 0 && raw <= 1) return raw;
  if (raw > 1 && raw <= 100) return raw / 100;
  return Math.min(1, Math.max(0, raw / 10));
}

export function scoreCandidate(input: CandidateInput, weights: ScoreWeights): ScoredCandidate {
  const confidence = normConfidence(input.confidence_score);
  const platform_fit = input.platform_fit ?? 0.7;
  const novelty = input.novelty_score ?? 0.5;
  const past = input.past_performance_similarity ?? 0.5;

  const pre_gen_score =
    weights.confidence * confidence +
    weights.platform_fit * platform_fit +
    weights.novelty * novelty +
    weights.past_performance * past;

  return {
    ...input,
    pre_gen_score: Math.round(pre_gen_score * 10000) / 10000,
    score_breakdown: {
      confidence,
      platform_fit,
      novelty,
      past_performance: past,
    },
  };
}
