import { z } from "zod";

export const candidateInputSchema = z.object({
  candidate_id: z.string(),
  content_idea: z.string().optional(),
  run_id: z.string().optional(),
  platform: z.string().optional(),
  origin_platform: z.string().optional(),
  target_platform: z.string().optional(),
  flow_type: z.string(),
  confidence_score: z.number().optional(),
  platform_fit: z.number().min(0).max(1).optional(),
  novelty_score: z.number().min(0).max(1).optional(),
  past_performance_similarity: z.number().min(0).max(1).optional(),
  recommended_route: z.string().optional(),
  dedupe_key: z.string().optional(),
  payload: z.record(z.unknown()).optional(),
});

export type CandidateInput = z.infer<typeof candidateInputSchema>;

export const generationPlanRequestSchema = z.object({
  project_slug: z.string(),
  run_id: z.string().optional(),
  candidates: z.array(candidateInputSchema).min(1),
  /** Override env defaults */
  min_score: z.number().optional(),
  max_candidates: z.number().int().positive().optional(),
  max_variations_per_candidate: z.number().int().min(1).max(10).optional(),
  /**
   * Prompt selection override for this planning call.
   *
   * Default behavior (when omitted):
   * - Prefer project prompt versions for the flow_type (status active/test)
   * - Fallback to CAF global template prompt versions (project_slug: 'caf-global')
   */
  prompt_override: z
    .object({
      prompt_version_id: z.string().optional(),
      prompt_id: z.string().optional(),
      template_only: z.boolean().optional(),
    })
    .optional(),
  dry_run: z.boolean().optional(),
});

export type GenerationPlanRequest = z.infer<typeof generationPlanRequestSchema>;

export interface ScoredCandidate extends CandidateInput {
  pre_gen_score: number;
  score_breakdown: Record<string, number>;
}

export interface PlannedJob {
  candidate_id: string;
  flow_type: string;
  platform: string | undefined;
  variation_index: number;
  variation_name: string;
  prompt_version_id: string | null;
  prompt_id: string | null;
  prompt_version_label: string | null;
  prompt_source: "project" | "template" | "override" | "none";
  recommended_route: string;
  pre_gen_score: number;
}

export interface SuppressionReason {
  code: string;
  message: string;
  rule_id?: string;
}

export interface GenerationPlanResult {
  trace_id: string;
  project_slug: string;
  run_id: string | null;
  suppressed: boolean;
  suppression_reasons: SuppressionReason[];
  dropped_candidates: Array<{
    candidate_id: string;
    reason: string;
    pre_gen_score?: number;
  }>;
  selected: PlannedJob[];
  meta: {
    engine_version: string;
    jobs_created_today: number;
    max_daily_jobs: number | null;
    min_score_used: number;
    variation_cap: number;
    prompt_override_used?: GenerationPlanRequest["prompt_override"] | null;
    max_carousel_jobs_per_run?: number | null;
    max_video_jobs_per_run?: number | null;
    default_other_flow_plan_cap?: number;
    max_jobs_per_flow_type?: Record<string, number>;
    planned_carousel_jobs?: number;
    planned_video_jobs?: number;
  };
}
