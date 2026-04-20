# Layer: Decision engine (planning)

**Purpose:** From a list of **candidate inputs**, produce a **plan**: which rows become **`content_jobs`**, with scores, caps, suppression, and **prompt version** selection.

## Main entry

- **`src/decision_engine/index.ts`** — **`decideGenerationPlan(db, config, req)`**.

## Supporting modules

| Module | Role |
|--------|------|
| **`scoring.ts`** | **`scoreCandidate`** — weighted signal score. |
| **`ranking_rules.ts`** | **`applyLearningBoosts`** — active learning rules with **`BOOST_RANK`**, **`SCORE_BOOST`**, **`SCORE_PENALTY`**. |
| **`kill_switches.ts`** | **`evaluateKillSwitches`** — suppression rules, blocked flow types. |
| **`route_selector.ts`** | **`selectRoute`** — `HUMAN_REVIEW` vs **`AUTO_PUBLISH`** heuristics from score/risk (planning-time). |
| **`prompt_selector.ts`** | **`resolvePromptVersion`** — ties to **`prompt_versions`** / flow engine. |
| **`default-plan-caps.ts`** | Per-flow caps when constraints omit values. |
| **`flow-kind.ts`** | **`isCarouselFlow`**, **`isVideoFlow`** for caps and behavior flags. |

## Inputs

- **`GenerationPlanRequest`** — **`project_slug`**, **`run_id`**, **`candidates[]`** (Zod: **`types.ts`**).

## Outputs

- **`GenerationPlanResult`** — **`selected[]`** (planned jobs with **`task_id`**, **`flow_type`**, **`prompt_id`**, etc.), **`dropped_candidates`**, **`suppression_reasons`**, **`trace_id`**.
- **`caf_core.decision_traces`** persisted (unless **`dry_run`**).

## Learning at planning time

Only rules returned by **`getLearningRulesForPlanning (facade) → listActiveAppliedLearningRules`** (**`src/repositories/core.ts`**) — **active**, **`rule_family`** in **`ranking` / `suppression`** (or null), **`action_type`** in **`BOOST_RANK`**, **`SCORE_BOOST`**, **`SCORE_PENALTY`**. **No prompt text** here.

## State owned

- **Traces** only; jobs are created by **orchestrator** calling **`upsertContentJob`**.

## See also

- [orchestration.md](./orchestration.md)
- [../GENERATION_GUIDANCE.md](../GENERATION_GUIDANCE.md) (prompt-side learning)
