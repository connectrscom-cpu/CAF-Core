/**
 * OpenAI chat.completions expects JSON numbers for max_tokens.
 * node-pg often returns NUMERIC columns as strings; coerce at the HTTP boundary.
 */

/** OpenAI completion-token ceiling (gpt-4o max is 16384; templates in DB often specify 25000+). */
function completionTokenUpperBound(): number {
  const raw = process.env.OPENAI_MAX_COMPLETION_TOKENS;
  if (raw != null && String(raw).trim() !== "") {
    const n = Number(String(raw).trim());
    if (Number.isFinite(n) && n >= 256) return Math.floor(Math.min(n, 200_000));
  }
  return 16_384;
}

export function openAiMaxTokens(value: unknown, fallback = 4000): number {
  if (value == null || value === "") return Math.min(fallback, completionTokenUpperBound());
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return Math.min(fallback, completionTokenUpperBound());
  const i = Math.floor(n);
  const cap = completionTokenUpperBound();
  return Math.max(1, Math.min(cap, i));
}
