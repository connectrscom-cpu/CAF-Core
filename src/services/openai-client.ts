/**
 * Shared OpenAI HTTP helpers for CAF services (chat + JSON).
 */

import { openAiMaxTokens } from "./openai-coerce.js";

const OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions";

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(String(raw), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export async function openaiChatCompletion(params: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
  max_tokens?: number;
  jsonObject?: boolean;
}): Promise<{ content: string; model: string; total_tokens: number }> {
  const body: Record<string, unknown> = {
    model: params.model,
    messages: [
      { role: "system", content: params.system },
      { role: "user", content: params.user },
    ],
    max_tokens: openAiMaxTokens(params.max_tokens, 4000),
  };
  if (params.jsonObject) body.response_format = { type: "json_object" };

  const timeoutMs = envInt("OPENAI_CHAT_TIMEOUT_MS", 180_000);
  const res = await fetch(OPENAI_CHAT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${errText}`);
  }

  const json = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage: { total_tokens: number };
  };

  return {
    content: json.choices[0]?.message?.content ?? "",
    model: json.model,
    total_tokens: json.usage?.total_tokens ?? 0,
  };
}

export function parseJsonObject(content: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(content) as unknown;
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
