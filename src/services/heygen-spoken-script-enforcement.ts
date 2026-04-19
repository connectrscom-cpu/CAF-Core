/**
 * HeyGen avatar v3 has no `duration_sec` on POST /v3/videos — output length follows TTS. Soft LLM hints were ignored;
 * this module enforces word budgets derived from VIDEO_TARGET_DURATION_* × SCENE_VO_WORDS_PER_MINUTE.
 */
import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { openaiChat } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { extractSpokenScriptText } from "./video-gen-fields.js";
import {
  countWords,
  fitSpokenScriptToWordBudget,
  heygenSpokenScriptWordBoundsFromConfig,
} from "./spoken-script-word-budget.js";
export type HeygenSpokenScriptEnforcementMeta = {
  min_words: number;
  max_words: number;
  words_before: number;
  words_after: number;
  action: "none" | "trimmed_max" | "expanded_min";
};

function applyScriptToGen(gen: Record<string, unknown>, script: string): Record<string, unknown> {
  const out = { ...gen, spoken_script: script };
  if ("script" in out) out.script = script;
  if ("video_script" in out) out.video_script = script;
  return out;
}

async function expandSpokenScriptToMinimum(
  appConfig: AppConfig,
  apiKey: string,
  script: string,
  minWords: number,
  audit: {
    db: Pool;
    projectId: string;
    runId: string;
    taskId: string;
  }
): Promise<string> {
  const user = [
    `Current voiceover (${countWords(script)} words):`,
    `"""${script.trim()}"""`,
    "",
    `Rewrite into ONE continuous voiceover for an on-camera avatar. Minimum ${minWords} words (hard requirement).`,
    "Keep the same topic, tone, and factual claims. Add specific detail, examples, and natural transitions.",
    "Forbidden: meta phrases like 'in this video', 'today we will', 'make sure to subscribe'.",
    "Output plain text only — no title, no quotes, no markdown.",
  ].join("\n");

  const llm = await openaiChat(
    apiKey,
    {
      model: appConfig.OPENAI_MODEL,
      system_prompt:
        "You are a short-form video copywriter. You expand voiceover scripts to meet a minimum word count while preserving intent.",
      user_prompt: user,
      max_tokens: openAiMaxTokens(2500),
    },
    {
      db: audit.db,
      projectId: audit.projectId,
      runId: audit.runId,
      taskId: audit.taskId,
      step: "heygen_spoken_script_expand_min_words",
    }
  );

  let text = llm.content.trim();
  text = text.replace(/^["'`]+|["'`]+$/g, "").trim();
  return text;
}

async function persistGeneratedOutputPatch(
  db: Pool,
  jobId: string,
  patch: Record<string, unknown>
): Promise<void> {
  await db.query(
    `UPDATE caf_core.content_jobs
     SET generation_payload = jsonb_set(
       generation_payload,
       '{generated_output}',
       coalesce(generation_payload->'generated_output', '{}'::jsonb) || $1::jsonb
     ),
     updated_at = now()
     WHERE id = $2`,
    [JSON.stringify(patch), jobId]
  );
}

/**
 * Enforces min/max spoken word bounds before HeyGen. Mutates returned `gen` and persists when changed.
 * Skips when enforcement disabled, or when there is no extractable spoken script (visual-only / silence VO).
 */
export async function enforceHeygenSpokenScriptWordLaw(
  db: Pool,
  appConfig: AppConfig,
  job: { id: string; task_id: string; project_id: string; run_id: string },
  gen: Record<string, unknown>
): Promise<{ gen: Record<string, unknown>; meta: HeygenSpokenScriptEnforcementMeta | null }> {
  if (!appConfig.HEYGEN_ENFORCE_SPOKEN_SCRIPT_WORD_BOUNDS) {
    return { gen, meta: null };
  }

  const raw = extractSpokenScriptText(gen, 1);
  if (!raw.trim()) {
    return { gen, meta: null };
  }

  const { minWords, maxWords } = heygenSpokenScriptWordBoundsFromConfig(appConfig);
  let script = raw.trim();
  let wordsBefore = countWords(script);
  let action: HeygenSpokenScriptEnforcementMeta["action"] = "none";

  if (wordsBefore > maxWords) {
    const fitted = fitSpokenScriptToWordBudget(script, [], maxWords);
    script = fitted.script;
    const wordsAfter = countWords(script);
    gen = applyScriptToGen(gen, script);
    action = "trimmed_max";
    await persistGeneratedOutputPatch(db, job.id, {
      spoken_script: script,
      script: script,
      heygen_spoken_script_enforcement: {
        min_words: minWords,
        max_words: maxWords,
        words_before: wordsBefore,
        words_after: wordsAfter,
        action,
      } satisfies HeygenSpokenScriptEnforcementMeta,
    });
    return {
      gen,
      meta: {
        min_words: minWords,
        max_words: maxWords,
        words_before: wordsBefore,
        words_after: wordsAfter,
        action,
      },
    };
  }

  if (wordsBefore >= minWords) {
    return {
      gen,
      meta: {
        min_words: minWords,
        max_words: maxWords,
        words_before: wordsBefore,
        words_after: wordsBefore,
        action: "none",
      },
    };
  }

  const apiKey = appConfig.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      `HeyGen: spoken_script is too short (${wordsBefore} words; minimum ${minWords} for ~${appConfig.VIDEO_TARGET_DURATION_MIN_SEC}s at ${appConfig.SCENE_VO_WORDS_PER_MINUTE} WPM). ` +
        `Set OPENAI_API_KEY on Core for automatic expansion, lengthen the script in review, or set HEYGEN_ENFORCE_SPOKEN_SCRIPT_WORD_BOUNDS=false to disable (not recommended).`
    );
  }

  const expanded = await expandSpokenScriptToMinimum(appConfig, apiKey, script, minWords, {
    db,
    projectId: job.project_id,
    runId: job.run_id,
    taskId: job.task_id,
  });
  const wordsAfter = countWords(expanded);
  if (wordsAfter < minWords) {
    throw new Error(
      `HeyGen: after expansion, spoken_script still has ${wordsAfter} words (minimum ${minWords}). Edit the script in review or adjust VIDEO_TARGET_DURATION_MIN_SEC / SCENE_VO_WORDS_PER_MINUTE.`
    );
  }

  let finalScript = expanded;
  let finalWords = wordsAfter;
  if (finalWords > maxWords) {
    const fitted = fitSpokenScriptToWordBudget(expanded, [], maxWords);
    finalScript = fitted.script;
    finalWords = countWords(finalScript);
    action = "trimmed_max";
  } else {
    action = "expanded_min";
  }

  gen = applyScriptToGen(gen, finalScript);
  await persistGeneratedOutputPatch(db, job.id, {
    spoken_script: finalScript,
    script: finalScript,
    heygen_spoken_script_enforcement: {
      min_words: minWords,
      max_words: maxWords,
      words_before: wordsBefore,
      words_after: finalWords,
      action,
    } satisfies HeygenSpokenScriptEnforcementMeta,
  });

  return {
    gen,
    meta: {
      min_words: minWords,
      max_words: maxWords,
      words_before: wordsBefore,
      words_after: finalWords,
      action,
    },
  };
}
