/**
 * Shared OpenAI chat.completions call for CAF generators.
 */
import type { Pool } from "pg";
import { openAiMaxTokens } from "./openai-coerce.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export interface OpenAiChatParams {
  model: string;
  system_prompt: string;
  user_prompt: string;
  max_tokens: number;
  response_format?: "json_object" | "text";
}

/** When set, full system/user prompts and assistant output are stored in api_call_audit. */
export interface OpenAiAuditContext {
  db: Pool;
  projectId: string;
  runId?: string | null;
  taskId?: string | null;
  signalPackId?: string | null;
  /** e.g. llm_carousel, llm_video_script_prep, scene_assembly_bundle, scene_candidate_router */
  step: string;
}

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryableOpenAiHttp(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || (status >= 500 && status <= 599);
}

export async function openaiChat(
  apiKey: string,
  params: OpenAiChatParams,
  audit?: OpenAiAuditContext | null
): Promise<{ content: string; model: string; total_tokens: number }> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: "system", content: params.system_prompt },
      { role: "user", content: params.user_prompt },
    ],
    max_tokens: openAiMaxTokens(params.max_tokens),
  };
  if (params.response_format === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const timeoutMs = envInt("OPENAI_CHAT_TIMEOUT_MS", 180_000);
  const maxRetries = Math.min(8, Math.max(0, envInt("OPENAI_CHAT_MAX_RETRIES", 2)));

  const startedAt = Date.now();
  let attempt = 0;
  let lastErr: unknown = null;

  while (attempt <= maxRetries) {
    const attemptStartedAt = Date.now();
    try {
      const res = await fetch(OPENAI_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!res.ok) {
        const errText = await res.text();
        const retryable = isRetryableOpenAiHttp(res.status);
        if (audit) {
          await tryInsertApiCallAudit(audit.db, {
            projectId: audit.projectId,
            runId: audit.runId,
            taskId: audit.taskId,
            signalPackId: audit.signalPackId,
            step: audit.step,
            provider: "openai",
            model: params.model,
            ok: false,
            errorMessage: `HTTP ${res.status}: ${errText.slice(0, 2000)}`,
            requestJson: {
              endpoint: OPENAI_API_URL,
              body: { ...body, messages: body.messages },
              timeout_ms: timeoutMs,
              attempt,
              max_retries: maxRetries,
              duration_ms: Date.now() - attemptStartedAt,
            },
            responseJson: { raw_error: errText.slice(0, 8000) },
          });
        }
        if (retryable && attempt < maxRetries) {
          const backoff = Math.min(30_000, 500 * 2 ** attempt);
          await sleep(backoff);
          attempt++;
          continue;
        }
        throw new Error(`OpenAI API error ${res.status}: ${errText}`);
      }

      const json = (await res.json()) as {
        choices: Array<{ message: { content: string } }>;
        model: string;
        usage: { total_tokens: number };
      };

      const content = json.choices[0]?.message?.content ?? "";
      const out = {
        content,
        model: json.model,
        total_tokens: json.usage?.total_tokens ?? 0,
      };

      const durationMs = Date.now() - attemptStartedAt;
      if (audit) {
        await tryInsertApiCallAudit(audit.db, {
          projectId: audit.projectId,
          runId: audit.runId,
          taskId: audit.taskId,
          signalPackId: audit.signalPackId,
          step: audit.step,
          provider: "openai",
          model: out.model,
          ok: true,
          requestJson: {
            endpoint: OPENAI_API_URL,
            system_prompt: params.system_prompt,
            user_prompt: params.user_prompt,
            max_tokens: body.max_tokens,
            response_format: params.response_format ?? null,
            timeout_ms: timeoutMs,
            attempt,
            max_retries: maxRetries,
          },
          responseJson: { assistant_content: content },
          tokenUsage: out.total_tokens,
        });
      }
      if (durationMs >= 20_000) {
        const label = audit?.step ? `[${audit.step}]` : "[openaiChat]";
        console.info(
          `${label} completed in ${durationMs}ms (attempt ${attempt}/${maxRetries}, model=${out.model}, tokens=${out.total_tokens})`
        );
      }
      return out;
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "";
      const isAbort = name === "AbortError" || name === "TimeoutError" || /timed out|timeout|aborted/i.test(msg);
      const isFetchNet = err instanceof TypeError && /fetch/i.test(msg);
      const retryable = isAbort || isFetchNet;

      if (audit && !(err instanceof Error && err.message.startsWith("OpenAI API error"))) {
        await tryInsertApiCallAudit(audit.db, {
          projectId: audit.projectId,
          runId: audit.runId,
          taskId: audit.taskId,
          signalPackId: audit.signalPackId,
          step: audit.step,
          provider: "openai",
          model: params.model,
          ok: false,
          errorMessage: `${name ? `${name}: ` : ""}${msg}`.slice(0, 4000),
          requestJson: {
            endpoint: OPENAI_API_URL,
            system_prompt: params.system_prompt,
            user_prompt: params.user_prompt,
            timeout_ms: timeoutMs,
            attempt,
            max_retries: maxRetries,
          },
          responseJson: {},
        });
      }

      if (retryable && attempt < maxRetries) {
        const backoff = Math.min(30_000, 500 * 2 ** attempt);
        await sleep(backoff);
        attempt++;
        continue;
      }
      throw err;
    }
  }

  const totalMs = Date.now() - startedAt;
  const label = audit?.step ? `[${audit.step}]` : "[openaiChat]";
  throw new Error(`${label} exhausted retries after ${totalMs}ms: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`);
}
