import type { Pool } from "pg";
import { qOne } from "../db/queries.js";

/**
 * Operator-facing description of the learning layer: what is automatic, what is not,
 * and where (if anywhere) an LLM is involved.
 */
export const LEARNING_TRANSPARENCY_STATIC = {
  schema_version: "1",
  summary:
    "Learning is not fully automatic. Editorial/performance analyzers use SQL + heuristics (no LLM in the analyzer itself). " +
    "Post-approval review uses Nemotron VL on rendered assets + intended copy (TP-parity output_insights_json). " +
    "Pending rules must be applied by an operator. Global observatory rows on caf-global are read-only aggregates. " +
    "Generation injects active learning context into the main content LLM.",
  loops: [
    {
      id: "B",
      name: "Editorial learning",
      evidence_source: "Human review rows in editorial_reviews (decisions, tags, overrides, notes)",
      analyzer: "editorial-learning.ts (SQL + heuristics); optional OpenAI synthesis on reviewer notes",
      llm_involved: true,
      llm_role:
        "When OPENAI_API_KEY is set and llm_notes_synthesis is enabled (default), a JSON-mode chat call summarizes themes in free-text notes and proposes actions (learning vs prompts vs code). " +
        "The same run still uses deterministic rules for tags/flows; the LLM does not auto-apply learning_rules.",
      automation: "manual_trigger or optional in-process cron (EDITORIAL_ANALYSIS_CRON_ENABLED on caf-core)",
      triggers: [
        "POST /v1/learning/:slug/editorial-analysis",
        "Review app → Run Editorial Analysis",
        "CLI: npm run editorial-analysis (dist/cli/run-editorial-analysis.js)",
      ],
      outputs:
        "Pending learning_rules (e.g. SCORE_PENALTY by rejection tag, REDUCE_VOLUME on low approval flows); " +
        "engineering brief (config-matched triggers + optional OpenAI block from notes) as markdown; upserted learning_insights (scope engineering) when persisting; llm_notes_synthesis object in API JSON",
      requires_human:
        "Apply pending rules before they affect ranking; optional auto_create_rules still creates pending first; review LLM suggestions before acting — no auto-merge to repo",
    },
    {
      id: "C",
      name: "Performance learning",
      evidence_source: "performance_metrics (JSON ingest or CSV upload) + job_outcomes publish anchor",
      analyzer: "performance-learning.ts + performance-learning-runner.ts (deterministic SQL + heuristics)",
      llm_involved: false,
      llm_role: null,
      automation: "manual_trigger",
      triggers: [
        "POST /v1/learning/:slug/performance/ingest",
        "POST /v1/learning/:slug/performance/csv",
        "POST /v1/learning/:slug/performance-analysis",
        "POST /v1/learning/:slug/market-analysis (alias)",
        "Review app → upload CSV / Run performance analysis",
      ],
      outputs:
        "caf-global learning_observations (performance_outcome_global); optional pending learning_rules when auto_create_rules=true",
      requires_human:
        "Ingest metrics then run performance analysis; apply pending rules only when rule suggestions were opted in",
    },
    {
      id: "generation_context",
      name: "Compiled learning context → LLM",
      evidence_source: "Active applied rules with rule_family=generation and GENERATION_GUIDANCE / GENERATION_HINT",
      analyzer: "learning-context-compiler.ts (string assembly, no model call)",
      llm_involved: true,
      llm_role:
        "The content generation model receives a short 'Validated learning context' block in its system prompt. " +
        "It does not run a separate 'learning analysis' job; it only consumes text you approved via active rules.",
      automation: "on_each_generate_for_job",
      triggers: ["generateForJob in llm-generator.ts"],
      outputs: "Shaped copy in drafts; learning_generation_attribution logs which rule ids were compiled",
      requires_human: "Someone must create/apply generation rules; no auto-LLM critique of past posts in Core today",
    },
    {
      id: "llm_post_approval",
      name: "LLM review (approved content only)",
      evidence_source:
        "content_jobs where latest editorial_reviews.decision = APPROVED; generation_payload + image public_urls from assets",
      analyzer:
        "approved-content-llm-review.ts + generated-output-nemotron-analysis.ts (Nemotron VL vision when images exist)",
      llm_involved: true,
      llm_role:
        "Nemotron VL scores rendered carousel/video frames and compares against intended copy. " +
        "Produces TP-parity output_insights_json (slide_arc, slides[], format_pattern, why_it_worked, mimic_evaluation). " +
        "Does not replace human approval; writes llm_approval_reviews + global observatory observations.",
      automation: "manual_trigger",
      triggers: [
        "POST /v1/learning/:slug/llm-review-approved",
        "Review app → Run LLM review (approved)",
      ],
      outputs:
        "caf_core.llm_approval_reviews (output_insights_json); learning_observations (llm_review_global); pending GENERATION_GUIDANCE when thresholds match",
      requires_human:
        "Operator runs the job; NVIDIA_NIM_API_KEY required; apply pending rules in the Learning UI; default skips tasks reviewed in the last 7 days unless forced",
    },
    {
      id: "global_observatory",
      name: "CAF global observatory",
      evidence_source:
        "caf-global learning_observations from editorial, Nemotron output, performance runs, and manual digest builds",
      analyzer: "global-learning-observe.ts + global-learning-digest.ts (no planning/generation facade calls)",
      llm_involved: false,
      llm_role: null,
      automation: "manual_trigger",
      triggers: [
        "POST /v1/learning/caf-global/digest",
        "GET /v1/learning/caf-global/digest/latest",
        "Side effects from editorial / performance / LLM review batch runs",
      ],
      outputs: "Read-only aggregates for operators and future LLM digests",
      requires_human: "Review observatory rows; never auto-applies project rules",
    },
    {
      id: "ranking",
      name: "Decision engine",
      evidence_source: "Active applied rules (ranking/suppression families), project-scoped only",
      analyzer: "decision_engine applyLearningBoosts (numeric only)",
      llm_involved: false,
      llm_role: null,
      automation: "automatic_on_each_plan",
      triggers: ["decideGenerationPlan"],
      outputs: "Adjusted pre_gen_score for candidates",
      requires_human: "Rules must already be active (applied)",
    },
  ],
  not_implemented_yet: [
    "Scheduled cron for editorial/performance/LLM review",
    "LLM review automatically on every human approval (webhook) without an explicit trigger",
    "Auto-apply of learning rules without human gate",
    "Event-driven performance analysis on every CSV row (onPerformanceMetricsIngested is stubbed)",
  ],
} as const;

export async function learningTransparencySnapshot(db: Pool, projectId: string): Promise<{
  pending_rules: number;
  active_rules: number;
  global_project_configured: boolean;
  observations_last_30d: number;
}> {
  const pending = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.learning_rules
     WHERE project_id = $1 AND status = 'pending'`,
    [projectId]
  );
  const active = await qOne<{ c: string }>(
    db,
    `SELECT COUNT(*)::text AS c FROM caf_core.learning_rules
     WHERE project_id = $1 AND status = 'active'`,
    [projectId]
  );
  let observationsLast30d = 0;
  try {
    const obs = await qOne<{ c: string }>(
      db,
      `SELECT COUNT(*)::text AS c FROM caf_core.learning_observations
       WHERE project_id = $1 AND observed_at >= now() - interval '30 days'`,
      [projectId]
    );
    observationsLast30d = obs ? parseInt(obs.c, 10) : 0;
  } catch {
    observationsLast30d = -1;
  }
  return {
    pending_rules: pending ? parseInt(pending.c, 10) : 0,
    active_rules: active ? parseInt(active.c, 10) : 0,
    global_project_configured: false,
    /** -1 if the observations table is missing (migration not applied). */
    observations_last_30d: observationsLast30d,
  };
}
