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

function synthesizeSceneBundlePrompt(gen: Record<string, unknown>): string {
  const bundle = nestedRecord(gen.scene_bundle);
  if (!bundle) return "";
  const scenes = Array.isArray(bundle.scenes) ? bundle.scenes : [];
  if (scenes.length === 0) return "";
  const lines: string[] = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = nestedRecord(scenes[i]);
    if (!s) continue;
    const order = s.order ?? s.scene_id ?? i + 1;
    const prompt = String(
      s.video_prompt ?? s.prompt ?? s.direction ?? s.scene_prompt ?? s.scene_description ?? ""
    ).trim();
    const narration = String(s.scene_narration_line ?? s.narration ?? "").trim();
    if (!prompt && !narration) continue;
    const header = `--- Scene ${order} ---`;
    const block = [header, prompt, narration ? `VO: ${narration}` : ""].filter(Boolean).join("\n");
    lines.push(block);
  }
  return lines.join("\n\n");
}

/** Build an AI-video prompt string from production-plan JSON when `video_prompt` is omitted. */
export function synthesizeVideoPromptFromPlan(gen: Record<string, unknown>): string {
  const fromScenes = synthesizeSceneBundlePrompt(gen);
  if (fromScenes) return fromScenes;

  const parts: string[] = [];
  const hook = gen.hook ?? gen.hook_line;
  if (typeof hook === "string" && hook.trim()) parts.push(`Hook: ${hook.trim()}`);

  const subject = gen.subject;
  if (typeof subject === "string" && subject.trim()) parts.push(`Subject: ${subject.trim()}`);

  const vd = nestedRecord(gen.visual_direction);
  if (vd) {
    for (const k of ["scene_style", "lighting", "background", "mood", "color_palette", "wardrobe"]) {
      const v = vd[k];
      if (typeof v === "string" && v.trim()) parts.push(`${k.replace(/_/g, " ")}: ${v.trim()}`);
    }
  }

  const cam = nestedRecord(gen.camera_instructions);
  if (cam) {
    for (const k of ["framing", "movement", "angle", "lens"]) {
      const v = cam[k];
      if (typeof v === "string" && v.trim()) parts.push(`Camera ${k}: ${v.trim()}`);
    }
  }

  const en = nestedRecord(gen.editing_notes);
  if (en) {
    for (const k of ["pacing", "cuts", "transitions"]) {
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

  const spoken = String(gen.spoken_script ?? gen.script ?? "").trim();
  if (spoken) parts.push(`Spoken script: ${spoken}`);

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

/**
 * Scene-bundle LLM output is usually only `{ scene_bundle }`. Persisting it must not replace the
 * prior `generated_output` from `ensureVideoScriptInPayload` (spoken_script, beats, hook, …).
 */
export function mergeSceneBundleParsedIntoGeneratedOutput(
  prior: Record<string, unknown> | null | undefined,
  bundleParsed: Record<string, unknown>
): Record<string, unknown> {
  const p = prior && typeof prior === "object" && !Array.isArray(prior) ? { ...prior } : {};
  return { ...p, ...bundleParsed };
}

/** Subset of generated script JSON to inject into scene-assembly `script_input` (beat alignment, TTS, captions). */
export function buildVideoScriptInputSlice(gen: Record<string, unknown>): Record<string, unknown> {
  const slice: Record<string, unknown> = {
    spoken_script: extractSpokenScriptText(gen, 1),
  };
  if (Array.isArray(gen.beats)) slice.beats = gen.beats;
  if (Array.isArray(gen.dialogue)) slice.dialogue = gen.dialogue;
  if (gen.hook_line != null || gen.hook != null) {
    slice.hook_line = gen.hook_line ?? gen.hook;
  }
  if (gen.cta_line != null || gen.cta != null) {
    slice.cta_line = gen.cta_line ?? gen.cta;
  }
  if (gen.estimated_runtime_seconds != null) slice.estimated_runtime_seconds = gen.estimated_runtime_seconds;
  if (Array.isArray(gen.on_screen_text)) slice.on_screen_text = gen.on_screen_text;
  return slice;
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
