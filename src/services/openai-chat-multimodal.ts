/**
 * OpenAI chat with multimodal user message (text + image_url parts) for vision models.
 */
import type { Pool } from "pg";
import { openAiMaxTokens } from "./openai-coerce.js";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import type { OpenAiAuditContext } from "./openai-chat.js";

const OPENAI_API_URL = "https://api.openai.com/v1/chat/completions";

export type ChatContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string; detail?: "low" | "high" | "auto" } };

export async function openaiChatMultimodal(
  apiKey: string,
  params: {
    model: string;
    system_prompt: string;
    user_content: ChatContentPart[];
    max_tokens: number;
    response_format?: "json_object" | "text";
  },
  audit?: OpenAiAuditContext | null
): Promise<{ content: string; model: string; total_tokens: number }> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: "system", content: params.system_prompt },
      { role: "user", content: params.user_content },
    ],
    max_tokens: openAiMaxTokens(params.max_tokens),
  };
  if (params.response_format === "json_object") {
    body.response_format = { type: "json_object" };
  }

  const imageCount = params.user_content.filter((p) => p.type === "image_url").length;
  const textLen = params.user_content
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .reduce((n, p) => n + p.text.length, 0);

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
            multimodal: true,
            image_parts: imageCount,
            text_chars: textLen,
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
          multimodal: true,
          system_prompt: params.system_prompt,
          image_parts: imageCount,
          text_chars: textLen,
          max_tokens: body.max_tokens,
          response_format: params.response_format ?? null,
        },
        responseJson: { assistant_content: content.slice(0, 12000) },
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
        requestJson: { multimodal: true, image_parts: imageCount, text_chars: textLen },
        responseJson: {},
      });
    }
    throw err;
  }
}
