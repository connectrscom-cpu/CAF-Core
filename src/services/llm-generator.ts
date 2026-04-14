/**
 * LLM Generation Service — calls OpenAI to generate content from prompt templates.
 *
 * Given a content_job with a prompt template reference and candidate data,
 * builds the creation_pack context, resolves the prompt template, calls the LLM,
 * optionally validates the output against the output schema (see CAF_SKIP_OUTPUT_SCHEMA_VALIDATION), and stores the result as a job_draft.
 */
import type { Pool } from "pg";
import { qOne } from "../db/queries.js";
import { getPromptTemplate, getOutputSchema, getFlowDefinition } from "../repositories/flow-engine.js";
import { resolveFlowEngineTemplateFlowType } from "../domain/canonical-flow-types.js";
import { validateAgainstOutputSchema } from "./schema-validator.js";
import { normalizeLlmParsedForSchemaValidation } from "./llm-output-normalize.js";
import { randomUUID } from "node:crypto";
import { buildCreationPack, interpolateTemplate } from "./llm-generator-helpers.js";
import { isCarouselFlow, isVideoFlow } from "../decision_engine/flow-kind.js";
import { loadConfig } from "../config.js";
import {
  appendVideoUserPromptDurationHardFooter,
  withSceneAssemblyPolicy,
  withVideoPromptDurationPolicy,
  withVideoScriptDurationPolicy,
} from "./video-content-policy.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { openaiChat } from "./openai-chat.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import {
  creationContextHasUnreplacedPlaceholders,
  sceneBundleFallbackUserPrompt,
  userPromptLooksLikePerSceneVideoTemplate,
} from "./scene-bundle-fallback-prompt.js";
import { ensureVideoScriptInPayload } from "./video-script-generator.js";
import { extractSpokenScriptText, mergeSceneBundleParsedIntoGeneratedOutput } from "./video-gen-fields.js";
import { buildVideoScriptInputJsonString } from "./llm-creation-pack-budget.js";
import { CAROUSEL_COPY_SYSTEM_ADDENDUM } from "./carousel-copy-prompt-policy.js";
import {
  PUBLICATION_SYSTEM_ADDENDUM,
  enrichGeneratedOutputForReview,
  maxHashtagsFromPlatformConstraints,
  maxSlidesFromPlatformConstraints,
} from "./publish-metadata-enrich.js";
import { compileLearningContexts } from "./learning-context-compiler.js";
import { insertGenerationAttribution } from "../repositories/learning-evidence.js";

async function nextJobDraftSequence(
  db: Pool,
  projectId: string,
  taskId: string
): Promise<{ attempt_no: number; revision_round: number }> {
  const row = await qOne<{ max_a: number | null; max_r: number | null }>(
    db,
    `SELECT MAX(attempt_no) AS max_a, MAX(revision_round) AS max_r
     FROM caf_core.job_drafts WHERE project_id = $1 AND task_id = $2`,
    [projectId, taskId]
  );
  const nextA = (row?.max_a ?? 0) + 1;
  const nextR = (row?.max_r ?? 0) + 1;
  return { attempt_no: nextA, revision_round: nextR };
}

function truncateForContext(s: string, maxChars: number, label: string): string {
  if (!maxChars || maxChars <= 0) return "";
  const t = (s ?? "").trim();
  if (t.length <= maxChars) return t;
  return `${t.slice(0, maxChars)}\n\n…(truncated ${t.length - maxChars} chars from ${label} for model context)`;
}

/**
 * Jobs keyed as `Video_Scene_Generator` (incl. legacy FLOW_SCENE_ASSEMBLY) must run the **bundle**
 * `scene_assembly` prompt first. The `generator` role is for per-scene n8n steps with
 * `{{scene_script}}` / `direction_pack` filled by the orchestrator — not for Core's primary job LLM.
 */
export function prefersVideoSceneBundleTemplate(resolvedTemplateFt: string, jobFlowType: string): boolean {
  if (resolvedTemplateFt === "Video_Scene_Generator") return true;
  return /FLOW_SCENE_ASSEMBLY|Flow_Scene_Assembly|VIDEO_SCENE_ASSEMBLY|Scene_Assembly/i.test(jobFlowType);
}

export interface GenerationResult {
  draft_id: string;
  task_id: string;
  raw_output: string;
  parsed_output: Record<string, unknown> | null;
  model_used: string;
  prompt_name: string;
  tokens_used: number;
  success: boolean;
  error?: string;
}

/**
 * Generate content for a single content_job.
 */
export async function generateForJob(
  db: Pool,
  jobId: string,
  apiKey: string,
  model: string = "gpt-4o",
  options?: { skipOutputSchemaValidation?: boolean }
): Promise<GenerationResult> {
  let job = await qOne<{
    id: string; task_id: string; project_id: string; run_id: string;
    candidate_id: string | null; flow_type: string; platform: string | null;
    generation_payload: Record<string, unknown>;
  }>(db, `SELECT * FROM caf_core.content_jobs WHERE id = $1`, [jobId]);

  if (!job) throw new Error(`Job not found: ${jobId}`);

  /** Match Flow Engine workbook `flow_type`; legacy job rows still resolve templates. */
  const templateFlowType = resolveFlowEngineTemplateFlowType(job.flow_type);
  const wantSceneBundle = prefersVideoSceneBundleTemplate(templateFlowType, job.flow_type);

  if (wantSceneBundle && apiKey.trim()) {
    const appCfg = loadConfig();
    /** Script-first scene assembly: spoken_script / video_script in payload before scene_bundle LLM. */
    await ensureVideoScriptInPayload(db, appCfg, jobId).catch(() => {});
    const refreshed = await qOne<{
      id: string;
      task_id: string;
      project_id: string;
      run_id: string;
      candidate_id: string | null;
      flow_type: string;
      platform: string | null;
      generation_payload: Record<string, unknown>;
    }>(db, `SELECT * FROM caf_core.content_jobs WHERE id = $1`, [jobId]);
    if (refreshed) job = refreshed;
  }

  const payload = job.generation_payload;
  const promptId = String(payload.prompt_id ?? "");
  const promptVersionLabel = String(payload.prompt_version_label ?? "");
  const signalPackId = (payload.signal_pack_id as string) ?? null;
  const candidateData = (payload.candidate_data as Record<string, unknown>) ?? {};

  let promptTemplate = promptId
    ? await getPromptTemplate(db, promptId, templateFlowType)
    : null;

  if (!promptTemplate) {
    const fe = await import("../repositories/flow-engine.js");
    const tryTypes = [...new Set([templateFlowType, job.flow_type].filter(Boolean))];
    for (const ft of tryTypes) {
      const templates = await fe.listPromptTemplates(db, ft);
      if (templates.length === 0) continue;

      if (wantSceneBundle) {
        promptTemplate =
          templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "scene_assembly") ??
          templates.find((t) => /scene_assembly|scene bundle|scenes?\s*bundle/i.test(t.prompt_name ?? "")) ??
          null;
      }

      if (!promptTemplate) {
        promptTemplate =
          templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "generator") ??
          templates.find((t) => (t.prompt_role ?? "").toLowerCase() === "preparation") ??
          templates.find((t) => Boolean(t.user_prompt_template?.trim())) ??
          templates[0] ??
          null;
      }

      if (promptTemplate?.user_prompt_template?.trim()) break;
      promptTemplate = null;
    }
  }

  if (!promptTemplate) {
    return {
      draft_id: `d_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
      task_id: job.task_id,
      raw_output: "",
      parsed_output: null,
      model_used: model,
      prompt_name: promptId || "unknown",
      tokens_used: 0,
      success: false,
      error: `No prompt template found for flow_type=${job.flow_type} (templates keyed as ${templateFlowType}), prompt_id=${promptId}`,
    };
  }

  const flowDef = await getFlowDefinition(db, templateFlowType);
  let outputSchemaRow = null;
  if (flowDef?.output_schema_name && flowDef?.output_schema_version) {
    outputSchemaRow = await getOutputSchema(db, flowDef.output_schema_name, flowDef.output_schema_version);
  }
  if (!outputSchemaRow && promptTemplate.output_schema_name && promptTemplate.output_schema_version) {
    outputSchemaRow = await getOutputSchema(
      db,
      promptTemplate.output_schema_name,
      promptTemplate.output_schema_version
    );
  }

  const creationPack = await buildCreationPack(
    db,
    job.project_id,
    signalPackId,
    candidateData,
    job.platform,
    job.flow_type
  );

  const appCfg = loadConfig();
  const hf = payload.human_feedback as { notes?: string | null; rejection_tags?: unknown } | undefined;
  const gr = String(payload.generation_reason ?? "");
  const reworkMode = payload.rework_mode;
  const isEditorialRework =
    gr === "REWORK_PARTIAL" ||
    gr === "REWORK_FULL" ||
    reworkMode === "FULL_REWORK" ||
    reworkMode === "PARTIAL_REWRITE" ||
    (typeof payload.rework_parent_task_id === "string" && payload.rework_parent_task_id.trim() !== "");

  const compiledLearningRaw = await compileLearningContexts(db, job.project_id, job.flow_type, job.platform, {
    include_pending_generation_guidance: isEditorialRework,
  });
  const compiledLearning = {
    ...compiledLearningRaw,
    global_context: truncateForContext(
      compiledLearningRaw.global_context,
      appCfg.LLM_LEARNING_GLOBAL_CONTEXT_MAX_CHARS,
      "global_learning_context"
    ),
    project_context: truncateForContext(
      compiledLearningRaw.project_context,
      appCfg.LLM_LEARNING_PROJECT_CONTEXT_MAX_CHARS,
      "project_learning_context"
    ),
    merged_guidance: truncateForContext(
      compiledLearningRaw.merged_guidance,
      appCfg.LLM_LEARNING_GUIDANCE_MAX_CHARS,
      "learning_guidance"
    ),
  };
  const templateContext: Record<string, unknown> = {
    ...creationPack,
    global_learning_context: compiledLearning.global_context,
    project_learning_context: compiledLearning.project_context,
    learning_guidance: compiledLearning.merged_guidance,
  };
  if (isVideoFlow(job.flow_type)) {
    const genOut = (payload.generated_output as Record<string, unknown>) ?? {};
    const includeVs = wantSceneBundle || extractSpokenScriptText(genOut, 1).length > 0;
    templateContext.script_input = buildVideoScriptInputJsonString(candidateData, genOut, {
      includeVideoScript: includeVs,
    });
  }

  let systemPrompt =
    promptTemplate.system_prompt ??
    "You are a content generator. When structured output is needed, include one JSON object (bare or markdown ```json fence).";
  const sceneAssemblyTemplate =
    (promptTemplate.prompt_role ?? "").toLowerCase() === "scene_assembly";
  if (isVideoFlow(job.flow_type)) {
    const ft = job.flow_type;
    if (sceneAssemblyTemplate) {
      systemPrompt = withSceneAssemblyPolicy(systemPrompt, appCfg);
    } else if (
      /Video_Prompt|video_prompt|Prompt_HeyGen|HeyGen_NoAvatar|PROMPT/i.test(ft) &&
      !/Video_Script|video_script|Script_HeyGen|script_generator/i.test(ft)
    ) {
      systemPrompt = withVideoPromptDurationPolicy(systemPrompt, appCfg);
    } else {
      const resolvedFt = resolveFlowEngineTemplateFlowType(ft);
      const multiScene =
        /FLOW_SCENE|scene_assembly|Video_Scene_Generator/i.test(ft) || resolvedFt === "Video_Scene_Generator";
      systemPrompt = withVideoScriptDurationPolicy(systemPrompt, appCfg, { multiScene });
    }
  }
  let userPrompt = interpolateTemplate(
    promptTemplate.user_prompt_template ?? "Generate content using: {{creation_pack_json}}",
    templateContext
  );

  if (wantSceneBundle) {
    const roleOk = sceneAssemblyTemplate;
    const unreplaced = creationContextHasUnreplacedPlaceholders(userPrompt);
    const perSceneShape = userPromptLooksLikePerSceneVideoTemplate(userPrompt);
    if (!roleOk || unreplaced || perSceneShape) {
      userPrompt = sceneBundleFallbackUserPrompt(templateContext, {
        min: appCfg.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN,
        max: appCfg.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX,
      });
      systemPrompt = withSceneAssemblyPolicy(
        "You are a video scene planner. Return only one JSON object. No markdown or commentary.",
        appCfg
      );
    }
  }

  /** Sheet templates often say 15–25s; user-message "Hard rules" beat system duration — enforce CAF floor here. */
  if (isVideoFlow(job.flow_type) && !wantSceneBundle) {
    const ft = job.flow_type;
    const isVideoPlan =
      /Video_Prompt|video_prompt|Prompt_HeyGen|HeyGen_NoAvatar|PROMPT/i.test(ft) &&
      !/Video_Script|video_script|Script_HeyGen|script_generator/i.test(ft);
    userPrompt = appendVideoUserPromptDurationHardFooter(
      userPrompt,
      appCfg,
      isVideoPlan ? "video_plan" : "script_json"
    );
  }

  if (isCarouselFlow(job.flow_type)) {
    systemPrompt = `${systemPrompt.trim()}\n\n${CAROUSEL_COPY_SYSTEM_ADDENDUM}`.trim();
  }

  if (compiledLearning.merged_guidance.trim()) {
    systemPrompt = `${systemPrompt.trim()}\n\nValidated learning context (shape tone, hooks, and structure; do not quote this section verbatim):\n${compiledLearning.merged_guidance}`.trim();
  }

  systemPrompt = `${systemPrompt.trim()}\n\n${PUBLICATION_SYSTEM_ADDENDUM}`.trim();

  /** Carousel JSON is slide-heavy; low DB defaults truncate copy before it reaches the renderer. */
  const carouselFloor = 5500;
  let maxTokens = openAiMaxTokens(promptTemplate.max_tokens_default, 4000);
  if (isCarouselFlow(job.flow_type)) {
    maxTokens = Math.max(maxTokens, carouselFloor);
  }
  if (isEditorialRework && hf) {
    const notes = (hf.notes ?? "").trim();
    const tags = Array.isArray(hf.rejection_tags)
      ? hf.rejection_tags.map((t) => String(t).trim()).filter(Boolean)
      : [];
    const bits = [
      notes ? `Reviewer notes: ${notes}` : "",
      tags.length ? `Rework tags: ${tags.join(", ")}` : "",
    ].filter(Boolean);
    if (bits.length) {
      userPrompt = `${userPrompt.trim()}\n\n---\nEditorial rework for task ${job.task_id}. Address this feedback in the output:\n${bits.join("\n")}`.trim();
    }
  }

  const draftId = `d_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  try {
    let llmResult = await openaiChat(
      apiKey,
      {
        model,
        system_prompt: systemPrompt,
        user_prompt: userPrompt,
        max_tokens: maxTokens,
      },
      {
        db,
        projectId: job.project_id,
        runId: job.run_id,
        taskId: job.task_id,
        signalPackId,
        step: `llm_primary_${templateFlowType}`,
      }
    );

    let parsedRaw = parseJsonObjectFromLlmText(llmResult.content);

    if (!parsedRaw && wantSceneBundle) {
      const appCfg = loadConfig();
      const strictSys = withSceneAssemblyPolicy(
        "You are a video scene planner. Return only one JSON object. No markdown or commentary.",
        appCfg
      );
      const fallbackUser = sceneBundleFallbackUserPrompt(templateContext, {
        min: appCfg.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN,
        max: appCfg.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX,
      });
      const llmRetry = await openaiChat(
        apiKey,
        {
          model,
          system_prompt: strictSys,
          user_prompt: fallbackUser,
          max_tokens: maxTokens,
        },
        {
          db,
          projectId: job.project_id,
          runId: job.run_id,
          taskId: job.task_id,
          signalPackId,
          step: `llm_primary_${templateFlowType}_scene_bundle_retry`,
        }
      );
      parsedRaw = parseJsonObjectFromLlmText(llmRetry.content);
      llmResult = {
        content: llmRetry.content,
        model: llmRetry.model,
        total_tokens: llmResult.total_tokens + llmRetry.total_tokens,
      };
    }

    if (!parsedRaw) {
      return {
        draft_id: draftId,
        task_id: job.task_id,
        raw_output: llmResult.content,
        parsed_output: null,
        model_used: llmResult.model,
        prompt_name: promptTemplate.prompt_name,
        tokens_used: llmResult.total_tokens,
        success: false,
        error:
          "Could not extract a JSON object from the model reply (include one {...} or a ```json fenced block).",
      };
    }

    let parsed = normalizeLlmParsedForSchemaValidation(job.flow_type, parsedRaw);
    if (!options?.skipOutputSchemaValidation) {
      const validation = validateAgainstOutputSchema(parsed, outputSchemaRow);
      if (!validation.valid) {
        return {
          draft_id: draftId,
          task_id: job.task_id,
          raw_output: llmResult.content,
          parsed_output: parsed,
          model_used: llmResult.model,
          prompt_name: promptTemplate.prompt_name,
          tokens_used: llmResult.total_tokens,
          success: false,
          error: `Output schema validation failed: ${validation.errors.join("; ")}`,
        };
      }
    }

    const maxHt = maxHashtagsFromPlatformConstraints(creationPack.platform_constraints);
    const maxSlides = maxSlidesFromPlatformConstraints(creationPack.platform_constraints);
    parsed = enrichGeneratedOutputForReview(job.flow_type, parsed, { maxHashtags: maxHt, maxSlides });

    const draftSeq = await nextJobDraftSequence(db, job.project_id, job.task_id);
    await db.query(`
      INSERT INTO caf_core.job_drafts (
        draft_id, task_id, candidate_id, run_id, project_id,
        attempt_no, revision_round, prompt_name, prompt_version, generated_payload
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
    `, [
      draftId, job.task_id, job.candidate_id, job.run_id, job.project_id,
      draftSeq.attempt_no, draftSeq.revision_round, promptTemplate.prompt_name, promptVersionLabel || "1.0",
      JSON.stringify({
        raw_output: llmResult.content,
        parsed: parsed,
        model: llmResult.model,
        tokens: llmResult.total_tokens,
        generation_reason: payload.generation_reason ?? null,
        rework_mode: payload.rework_mode ?? null,
      }),
    ]);

    let parsedOutputForResponse: Record<string, unknown> | null = parsed;

    if (parsed) {
      let storedOutput: Record<string, unknown> = parsed;
      if (wantSceneBundle) {
        const fresh = await qOne<{ generation_payload: Record<string, unknown> }>(
          db,
          `SELECT generation_payload FROM caf_core.content_jobs WHERE id = $1`,
          [job.id]
        );
        const prior = (fresh?.generation_payload?.generated_output as Record<string, unknown>) ?? {};
        storedOutput = mergeSceneBundleParsedIntoGeneratedOutput(prior, parsed);
        storedOutput = enrichGeneratedOutputForReview(job.flow_type, storedOutput, { maxHashtags: maxHt, maxSlides });
        parsedOutputForResponse = storedOutput;
      }
      await db.query(
        `
        UPDATE caf_core.content_jobs
        SET generation_payload = generation_payload || $1::jsonb, updated_at = now()
        WHERE id = $2
      `,
        [JSON.stringify({ generated_output: storedOutput, draft_id: draftId }), job.id]
      );
    }

    void insertGenerationAttribution(db, {
      task_id: job.task_id,
      project_id: job.project_id,
      flow_type: job.flow_type,
      platform: job.platform,
      applied_rule_ids: compiledLearning.applied_rule_ids,
      global_context_chars: compiledLearning.global_context.length,
      project_context_chars: compiledLearning.project_context.length,
    }).catch(() => {});

    return {
      draft_id: draftId,
      task_id: job.task_id,
      raw_output: llmResult.content,
      parsed_output: parsedOutputForResponse,
      model_used: llmResult.model,
      prompt_name: promptTemplate.prompt_name,
      tokens_used: llmResult.total_tokens,
      success: true,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      draft_id: draftId,
      task_id: job.task_id,
      raw_output: "",
      parsed_output: null,
      model_used: model,
      prompt_name: promptTemplate.prompt_name,
      tokens_used: 0,
      success: false,
      error: msg,
    };
  }
}
