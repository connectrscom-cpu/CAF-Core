/**
 * OpenAI Audio API — speech-to-text for top-performer video (optional).
 */
import type { Pool } from "pg";
import { tryInsertApiCallAudit } from "../repositories/api-call-audit.js";
import type { OpenAiAuditContext } from "./openai-chat.js";

const WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";

export async function openaiWhisperTranscribe(
  apiKey: string,
  params: {
    model: string;
    audio: Buffer;
    filename: string;
    language?: string;
  },
  audit?: OpenAiAuditContext | null
): Promise<{ text: string; model: string }> {
  const form = new FormData();
  form.append("file", new Blob([Uint8Array.from(params.audio)], { type: "audio/mpeg" }), params.filename);
  form.append("model", params.model);
  form.append("response_format", "json");
  if (params.language?.trim()) form.append("language", params.language.trim());

  const started = Date.now();
  const res = await fetch(WHISPER_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(180_000),
  });

  const raw = await res.text();
  if (!res.ok) {
    if (audit) {
      await tryInsertApiCallAudit(audit.db, {
        projectId: audit.projectId,
        runId: audit.runId ?? null,
        taskId: audit.taskId ?? null,
        signalPackId: audit.signalPackId ?? null,
        step: audit.step ?? "openai_whisper",
        provider: "openai",
        model: params.model,
        ok: false,
        requestJson: { filename: params.filename, bytes: params.audio.length },
        responseJson: { status: res.status, body: raw.slice(0, 2000) },
        latencyMs: Date.now() - started,
      });
    }
    throw new Error(`Whisper HTTP ${res.status}: ${raw.slice(0, 400)}`);
  }

  let parsed: { text?: string } = {};
  try {
    parsed = JSON.parse(raw) as { text?: string };
  } catch {
    throw new Error("Whisper returned non-JSON body");
  }
  const text = String(parsed.text ?? "").trim();

  if (audit) {
    await tryInsertApiCallAudit(audit.db, {
      projectId: audit.projectId,
      runId: audit.runId ?? null,
      taskId: audit.taskId ?? null,
      signalPackId: audit.signalPackId ?? null,
      step: audit.step ?? "openai_whisper",
      provider: "openai",
      model: params.model,
      ok: true,
      requestJson: { filename: params.filename, bytes: params.audio.length },
      responseJson: { text_chars: text.length },
      latencyMs: Date.now() - started,
    });
  }

  return { text, model: params.model };
}
