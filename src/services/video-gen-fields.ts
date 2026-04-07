/**
 * Read script / prompt text from generated_output with nested and alias keys (LLM shape drift).
 */

const SCRIPT_KEYS = [
  "spoken_script",
  "video_script",
  "script",
  "spokenScript",
  "narration",
  "voiceover_script",
  "spoken_text",
] as const;

const PROMPT_KEYS = ["video_prompt", "prompt", "heygen_prompt", "videoPrompt", "visual_prompt"] as const;

export function extractSpokenScriptText(gen: Record<string, unknown>, minLen = 20): string {
  for (const k of SCRIPT_KEYS) {
    const v = gen[k];
    if (v != null && String(v).trim().length >= minLen) return String(v).trim();
  }
  for (const nestKey of ["output", "data", "video", "generated", "result"]) {
    const nest = gen[nestKey];
    if (nest && typeof nest === "object" && !Array.isArray(nest)) {
      const s = extractSpokenScriptText(nest as Record<string, unknown>, minLen);
      if (s.length >= minLen) return s;
    }
  }
  return "";
}

export function extractVideoPromptText(gen: Record<string, unknown>, minLen = 10): string {
  for (const k of PROMPT_KEYS) {
    const v = gen[k];
    if (v != null && String(v).trim().length >= minLen) return String(v).trim();
  }
  for (const nestKey of ["output", "data", "video", "generated", "result"]) {
    const nest = gen[nestKey];
    if (nest && typeof nest === "object" && !Array.isArray(nest)) {
      const s = extractVideoPromptText(nest as Record<string, unknown>, minLen);
      if (s.length >= minLen) return s;
    }
  }
  return "";
}
