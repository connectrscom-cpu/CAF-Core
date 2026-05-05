# Generation guidance

**Generation guidance** is **text** (and related metadata) merged into **LLM prompts** so the model steers toward brand, strategy, or operator intent. It is **not** the same as **QC** (post-hoc validation) or **plan-time learning rules** (scoring only).

## Primary mechanism: `getLearningContextForGeneration`

**Facade:** **`src/services/learning-rule-selection.ts`** — `getLearningContextForGeneration(db, projectId, flow, platform, opts)`.  
**Implementation:** **`src/services/learning-context-compiler.ts`** — `compileLearningContexts`.  
**Called from:** **`src/services/llm-generator.ts`** during **`generateForJob`**, and **`src/routes/learning.ts`** for the context preview endpoint. Always reach the compiler through the facade — direct imports of `compileLearningContexts` in new code are considered drift.

### Which rules are included

1. Load rules for the project scope (**project-scoped only**; global learning is currently disabled).
2. **Active** rules where **`status === 'active'`** and the row is classified as a **generation** rule:
   - **`rule_family === 'generation'`**, or
   - **`action_type`** matches **`/GENERATION|GUIDANCE|HINT/i`**.
3. Optional **pending** guidance on **editorial rework** only: if **`include_pending_generation_guidance`** is true, **`pending`** rules with generation-guidance-style **`action_type`** are also merged (same file).

### Scoping

**`matchesScope`** filters by:

- **`scope_flow_type`** — exact or **`*`** wildcard pattern vs job **`flow_type`**.
- **`scope_platform`** — must match job platform when set.

### Text extraction

Guidance text is taken from **`action_payload`**: first non-empty of **`guidance`**, **`hint`**, **`text`**, **`message`**, **`summary`**.

### Injection into the prompt

**`llm-generator.ts`**:

1. Places **`global_learning_context`**, **`project_learning_context`**, **`learning_guidance`** into the **template context** (with **char caps** from **`LLM_LEARNING_*`** env in **`config.ts`**).
2. Appends **merged guidance** to the **system prompt** under a fixed preamble: *“Validated learning context … do not quote verbatim”*.

So guidance is **advisory** — the model may still ignore it.

## Anti-repetition (carousel)

Separate from **`learning_rules`**: **`buildLlmApprovalAntiRepetitionBlock`** adds a block from **recent approved** jobs’ copy (config **`LLM_APPROVAL_ANTI_REPETITION_*`**). Also appended to **system** for carousel flows when enabled.

## Editorial rework overrides

When **`generation_reason`** / **`rework_mode`** indicate rework, **reviewer notes** and **`editorial_overrides_json`** fields are merged into the **user** prompt (not the learning compiler). See **`llm-generator.ts`** block around **`isEditorialRework`**.

## Planning-time learning (different path)

The planning path is also fronted by the facade: **`getLearningRulesForPlanning(db, projectId)`** (`src/services/learning-rule-selection.ts`) wraps **`listActiveAppliedLearningRules`** (**`src/repositories/core.ts`**) and returns only **ranking-style** rules (**`BOOST_RANK`**, **`SCORE_BOOST`**, **`SCORE_PENALTY`**) for **`decideGenerationPlan`**. Those **do not** inject prompt text — they change **which jobs get planned**. See **`decision_engine/ranking_rules.ts`**.

## Attribution

**`caf_core.learning_generation_attribution`** records applied rule ids and context sizes (**`src/repositories/learning-evidence.ts`**, called from generation path).

## Related docs

- [QUALITY_CHECKS.md](./QUALITY_CHECKS.md)
- [RISK_RULES.md](./RISK_RULES.md)
- [layers/learning.md](./layers/learning.md)
- [layers/generation.md](./layers/generation.md)
