/** Human-readable label for chat/completions HTTP failures (OpenAI vs NVIDIA NIM / Nemotron). */
export function chatCompletionsApiLabel(provider?: string): string {
  const p = (provider ?? "openai").trim().toLowerCase();
  if (p === "nvidia") return "NVIDIA NIM API";
  if (p === "openai") return "OpenAI API";
  if (!p) return "Chat API";
  return `${p} chat API`;
}

export function formatChatCompletionsHttpError(
  status: number,
  errText: string,
  provider?: string
): string {
  return `${chatCompletionsApiLabel(provider)} error ${status}: ${errText}`;
}

/** True when `formatChatCompletionsHttpError` built the message (skip duplicate audit on rethrow). */
export function isChatCompletionsHttpError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return / API error \d{3}:/.test(err.message);
}
