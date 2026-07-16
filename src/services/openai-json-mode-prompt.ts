/**
 * OpenAI requires the word "json" in messages when using response_format json_object.
 */
export const OPENAI_JSON_OBJECT_MODE_HINT =
  "Return a single valid JSON object only (no markdown fences or commentary outside the JSON).";

export function messagesIncludeJsonKeyword(systemPrompt: string, userPrompt: string): boolean {
  return /json/i.test(systemPrompt) || /json/i.test(userPrompt);
}

export function ensureOpenAiJsonObjectPromptHints(
  systemPrompt: string,
  userPrompt: string
): { system_prompt: string; user_prompt: string } {
  if (messagesIncludeJsonKeyword(systemPrompt, userPrompt)) {
    return { system_prompt: systemPrompt, user_prompt: userPrompt };
  }
  return {
    system_prompt: `${systemPrompt.trim()}\n\n${OPENAI_JSON_OBJECT_MODE_HINT}`.trim(),
    user_prompt: userPrompt,
  };
}
