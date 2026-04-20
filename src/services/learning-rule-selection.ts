/**
 * Learning rule selection facade.
 *
 * Learning has two mental models in CAF Core today:
 *
 *   1. **Planning** — decides WHICH jobs get planned. Only `ranking` /
 *      `suppression` action types matter (`BOOST_RANK`, `SCORE_BOOST`,
 *      `SCORE_PENALTY`). Lives in the decision engine.
 *   2. **Generation** — steers WHAT the prompt says. Matches `generation`
 *      family or `GUIDANCE` / `HINT` action types. Lives in the LLM generator.
 *
 * Before this module, callers had to import the right function from two
 * different files and understand the split. This facade makes the split
 * explicit and becomes the single place to look when you ask "which rules
 * affect planning vs generation?". No behavior change — each function
 * delegates to the existing implementation.
 *
 * See `docs/GENERATION_GUIDANCE.md` and `docs/CAF_CORE_COMPLETE_GUIDE.md`.
 */
import type { Pool } from "pg";
import { listActiveAppliedLearningRules, type LearningRuleRow } from "../repositories/core.js";
import {
  compileLearningContexts,
  type CompiledLearning,
} from "./learning-context-compiler.js";

export interface GenerationRuleSelectionOptions {
  /** Include `pending` generation-guidance rules (used by rework to honor human steering). */
  include_pending_generation_guidance?: boolean;
}

/**
 * Rules that affect **planning** — i.e. scoring and suppression in
 * `decideGenerationPlan`. Only ranking-family action types are returned.
 */
export async function getLearningRulesForPlanning(
  db: Pool,
  projectId: string
): Promise<LearningRuleRow[]> {
  return listActiveAppliedLearningRules(db, projectId);
}

/**
 * Rules that affect **generation** — compiled into the prompt for a given
 * flow + platform. Returns merged guidance text (global + project) plus the
 * list of applied rule ids for attribution.
 */
export async function getLearningContextForGeneration(
  db: Pool,
  projectId: string,
  flowType: string | null,
  platform: string | null,
  opts?: GenerationRuleSelectionOptions
): Promise<CompiledLearning> {
  return compileLearningContexts(db, projectId, flowType, platform, opts);
}

export type { CompiledLearning, LearningRuleRow };
