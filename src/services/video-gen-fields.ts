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

/** Nested object from LLM/JSONB; sometimes stored or echoed as a JSON string. */
function nestedRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  if (typeof v === "string") {
    const t = v.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      try {
        const o = JSON.parse(t) as unknown;
        if (o && typeof o === "object" && !Array.isArray(o)) return o as Record<string, unknown>;
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

/** Build an AI-video prompt string from production-plan JSON when `video_prompt` is omitted. */
export function synthesizeVideoPromptFromPlan(gen: Record<string, unknown>): string {
  const parts: string[] = [];
  const hook = gen.hook;
  if (typeof hook === "string" && hook.trim()) parts.push(`Hook: ${hook.trim()}`);

  const vd = nestedRecord(gen.visual_direction);
  if (vd) {
    for (const k of ["scene_style", "lighting", "background", "mood"]) {
      const v = vd[k];
      if (typeof v === "string" && v.trim()) parts.push(`${k.replace(/_/g, " ")}: ${v.trim()}`);
    }
  }

  const cam = nestedRecord(gen.camera_instructions);
  if (cam) {
    for (const k of ["framing", "movement", "angle"]) {
      const v = cam[k];
      if (typeof v === "string" && v.trim()) parts.push(`Camera ${k}: ${v.trim()}`);
    }
  }

  const en = nestedRecord(gen.editing_notes);
  if (en) {
    for (const k of ["pacing", "cuts"]) {
      const v = en[k];
      if (typeof v === "string" && v.trim()) parts.push(`Editing ${k}: ${v.trim()}`);
    }
  }

  const ost = gen.on_screen_text;
  if (Array.isArray(ost)) {
    const phrases = ost
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .slice(0, 8);
    if (phrases.length) parts.push(`On-screen text: ${phrases.join("; ")}`);
  }

  return parts.join(". ").trim();
}

function spokenScriptFromDialogue(gen: Record<string, unknown>, minLen: number): string {
  const dialogue = gen.dialogue;
  if (!Array.isArray(dialogue)) return "";
  const lines = dialogue
    .map((d) => {
      if (d && typeof d === "object" && "line" in d) return String((d as { line: unknown }).line).trim();
      return "";
    })
    .filter(Boolean);
  const s = lines.join(" ").trim();
  return s.length >= minLen ? s : "";
}

function spokenScriptFromBeats(gen: Record<string, unknown>, minLen: number): string {
  const beats = gen.beats;
  if (!Array.isArray(beats)) return "";
  const parts = beats.filter((b): b is string => typeof b === "string" && b.trim().length > 0);
  const s = parts.join(" ").trim();
  return s.length >= minLen ? s : "";
}

export function extractSpokenScriptText(gen: Record<string, unknown>, minLen = 20): string {
  for (const k of SCRIPT_KEYS) {
    const v = gen[k];
    if (v != null && String(v).trim().length >= minLen) return String(v).trim();
  }
  const fromDialogue = spokenScriptFromDialogue(gen, minLen);
  if (fromDialogue) return fromDialogue;
  const fromBeats = spokenScriptFromBeats(gen, minLen);
  if (fromBeats) return fromBeats;
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
  const synthesized = synthesizeVideoPromptFromPlan(gen);
  if (synthesized.length >= minLen) return synthesized;
  return "";
}
