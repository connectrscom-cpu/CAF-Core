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

  try {
    const res = await fetch(OPENAI_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
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
          },
          responseJson: { raw_error: errText.slice(0, 8000) },
        });
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
        },
        responseJson: { assistant_content: content },
        tokenUsage: out.total_tokens,
      });
    }

    return out;
  } catch (err) {
    if (audit && !(err instanceof Error && err.message.startsWith("OpenAI API error"))) {
      const msg = err instanceof Error ? err.message : String(err);
      await tryInsertApiCallAudit(audit.db, {
        projectId: audit.projectId,
        runId: audit.runId,
        taskId: audit.taskId,
        signalPackId: audit.signalPackId,
        step: audit.step,
        provider: "openai",
        model: params.model,
        ok: false,
        errorMessage: msg.slice(0, 4000),
        requestJson: {
          endpoint: OPENAI_API_URL,
          system_prompt: params.system_prompt,
          user_prompt: params.user_prompt,
        },
        responseJson: {},
      });
    }
    throw err;
  }
}
