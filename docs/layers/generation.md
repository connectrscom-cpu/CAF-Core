# Layer: LLM generation

**Purpose:** Resolve **prompt templates**, build **creation pack** context, merge **learning guidance**, call **OpenAI**, validate/normalize output, write **drafts** and **`generation_payload`**.

## Main module

- **`src/services/llm-generator.ts`** — **`generateForJob(db, jobId, apiKey, model, options)`**.

## Helpers

| File | Role |
|------|------|
| **`llm-generator-helpers.ts`** | **`buildCreationPack`**, **`interpolateTemplate`**. |
| **`learning-context-compiler.ts`** | **`getLearningContextForGeneration (facade) → compileLearningContexts`** — see **[../GENERATION_GUIDANCE.md](../GENERATION_GUIDANCE.md)**. |
| **`llm-output-normalize.ts`** | Shape normalization before schema QC. |
| **`schema-validator.ts`** | Output schema validation vs **`output_schemas`**; rollout controlled by **`CAF_OUTPUT_SCHEMA_VALIDATION_MODE`** (`skip` / `warn` / `enforce`), resolved in **`src/config.ts`** (`resolveOutputSchemaValidationMode`). In `warn` mode, failures are logged and recorded under **`generation_payload.schema_validation_warnings`** without failing the job. |
| **`openai-chat.ts`** | Low-level chat call + audit hooks. |
| **`video-script-generator.ts`**, **`video-prompt-generator.ts`** | Pre-steps for video/scene flows. |

## Inputs

- **`caf_core.content_jobs`** row: **`flow_type`**, **`generation_payload`** ( **`prompt_id`**, **`signal_pack_id`**, **`candidate_data`**, …).

## Outputs

- **`caf_core.job_drafts`** — new row per attempt.
- **`content_jobs.generation_payload`** updated with **`generated_output`**, draft reference, model metadata as implemented.

## Reading `generated_output`

Prefer the typed helpers in **`src/domain/generation-payload-output.ts`** over ad-hoc casts:

- **`pickGeneratedOutput(gp)`** — `Record<string, unknown>` or `null`; rejects arrays and primitives instead of silently coercing to `{}`.
- **`pickGeneratedOutputOrEmpty(gp)`** — same, but returns `{}` on miss when that is the desired default.
- **`hasGeneratedOutput(gp)`** — boolean gate for "has this job been generated yet?".

## Special cases

- **Scene bundle** flows — **`prefersVideoSceneBundleTemplate`**; may call **`ensureVideoScriptInPayload`** first.
- **Product image flows** — **`generateForJob`** returns failure without calling OpenAI (**`product-flow-types.ts`**).
- **Carousel** — extra system addendum, high **`max_tokens`** floor, anti-repetition block.

## State owned

- Draft rows; **canonical** copy of latest output is on the **job** payload.

## See also

- [../QUALITY_CHECKS.md](../QUALITY_CHECKS.md) (downstream)
- [../GENERATION_GUIDANCE.md](../GENERATION_GUIDANCE.md)
- [job-pipeline.md](./job-pipeline.md)
