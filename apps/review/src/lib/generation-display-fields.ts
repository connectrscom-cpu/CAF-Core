/**
 * Map CAF `generation_payload` / `generated_output` into Workbench display fields.
 * Video script JSON uses hook_line / cta_line / on_screen_text — not always top-level title/hook/caption.
 */

function stringVal(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function recordVal(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return v as Record<string, unknown>;
}

function arrayVal(v: unknown): unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function pickFromNestedCaptionObjects(root: Record<string, unknown> | null): string {
  if (!root) return "";
  const direct = stringVal(root.caption) || stringVal(root.post_caption) || stringVal(root.description);
  if (direct.trim()) return direct.trim();

  for (const k of ["content", "publish", "publication", "post", "video", "result", "output", "data"]) {
    const nest = recordVal(root[k]);
    if (!nest) continue;
    const v = stringVal(nest.caption) || stringVal(nest.post_caption) || stringVal(nest.description);
    if (v.trim()) return v.trim();
  }
  return "";
}

function composeCaptionFromVideoScriptJson(go: Record<string, unknown>): string {
  const cap = stringVal(go.caption).trim();
  if (cap) return cap;
  const post = stringVal(go.post_caption).trim();
  if (post) return post;
  const parts: string[] = [];
  const cta = stringVal(go.cta_line ?? go.cta).trim();
  if (cta) parts.push(cta);
  const ost = arrayVal(go.on_screen_text);
  if (ost) {
    const lines = ost.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim());
    if (lines.length) parts.push(lines.join("\n"));
  }
  const disc = stringVal(go.disclaimer_line).trim();
  if (disc) parts.push(disc);
  return parts.join("\n\n").trim();
}

/**
 * Post / carousel caption: explicit caption fields first, then video-script CTA + on-screen + disclaimer.
 */
export function pickCaptionFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? undefined;
  const direct =
    stringVal(p?.caption) ||
    stringVal(p?.generated_caption) ||
    stringVal(p?.post_caption) ||
    stringVal(p?.final_caption) ||
    stringVal(p?.final_caption_override);
  if (direct.trim()) return direct.trim();

  const generatedOutput = recordVal(p?.generated_output);
  if (generatedOutput) {
    const fromScript = composeCaptionFromVideoScriptJson(generatedOutput);
    if (fromScript.trim()) return fromScript.trim();

    const goDirect = pickFromNestedCaptionObjects(generatedOutput) || stringVal(generatedOutput?.generated_caption);
    if (goDirect.trim()) return goDirect.trim();

    const carousel = recordVal(generatedOutput?.carousel);
    const carouselCaption = pickFromNestedCaptionObjects(carousel);
    if (carouselCaption.trim()) return carouselCaption.trim();

    const variations = arrayVal(generatedOutput?.variations);
    const firstVar = variations?.[0] ? recordVal(variations[0]) : null;
    const varCaption = pickFromNestedCaptionObjects(firstVar);
    if (varCaption.trim()) return varCaption.trim();
  }

  return "";
}

/** Page / export title: prefer explicit title, then script hook_line (video script schema). */
export function pickTitleFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? undefined;
  const top =
    stringVal(p?.title).trim() ||
    stringVal(p?.generated_title).trim() ||
    stringVal(p?.headline).trim();
  if (top) return top;

  const go = recordVal(p?.generated_output);
  if (go) {
    const g =
      stringVal(go.title).trim() ||
      stringVal(go.headline).trim() ||
      stringVal(go.hook_line).trim() ||
      stringVal(go.hook).trim();
    if (g) return g;
  }
  return "";
}

/** Same key order as `src/services/video-gen-fields.ts` SCRIPT_KEYS — keep Workbench in sync with render/TTS. */
const SPOKEN_SCRIPT_KEYS = [
  "spoken_script",
  "video_script",
  "script",
  "spokenScript",
  "narration",
  "voiceover_script",
  "spoken_text",
] as const;

function recordFromGeneratedOutput(raw: unknown): Record<string, unknown> | null {
  const r = recordVal(raw);
  if (r) return r;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (t.startsWith("{") && t.endsWith("}")) {
      try {
        const o = JSON.parse(t) as unknown;
        return recordVal(o);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function spokenScriptFromDialogue(gen: Record<string, unknown>): string {
  const dialogue = gen.dialogue;
  if (!Array.isArray(dialogue)) return "";
  const lines = dialogue
    .map((d) => {
      if (d && typeof d === "object" && "line" in d) return String((d as { line: unknown }).line).trim();
      return "";
    })
    .filter(Boolean);
  return lines.join(" ").trim();
}

function spokenScriptFromBeats(gen: Record<string, unknown>): string {
  const beats = gen.beats;
  if (!Array.isArray(beats)) return "";
  return beats.filter((b): b is string => typeof b === "string" && b.trim().length > 0).join(" ").trim();
}

/** Join per-scene narration slices (multi-scene assembly) when a single full `spoken_script` string is absent. */
function spokenScriptFromSceneBundle(gen: Record<string, unknown>): string {
  const sb = recordVal(gen.scene_bundle);
  if (!sb) return "";
  const scenes = arrayVal(sb.scenes);
  if (!scenes?.length) return "";
  const parts: string[] = [];
  for (const sc of scenes) {
    const r = recordVal(sc);
    if (!r) continue;
    const line = stringVal(r.scene_narration_line).trim();
    if (line) parts.push(line);
  }
  return parts.join(" ").trim();
}

/**
 * Extract narration text from one `generated_output`-shaped object (display: allow short scripts).
 * Mirrors `extractSpokenScriptText` but with min length 1 and no duplicate imports from Core `src/`.
 */
function extractSpokenScriptFromGenRecord(gen: Record<string, unknown>): string {
  for (const k of SPOKEN_SCRIPT_KEYS) {
    const v = gen[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  const fromDialogue = spokenScriptFromDialogue(gen);
  if (fromDialogue.trim()) return fromDialogue.trim();
  const fromBeats = spokenScriptFromBeats(gen);
  if (fromBeats.trim()) return fromBeats.trim();
  for (const nestKey of ["output", "data", "video", "generated", "result"]) {
    const nest = recordVal(gen[nestKey]);
    if (!nest) continue;
    const inner = extractSpokenScriptFromGenRecord(nest);
    if (inner) return inner;
  }
  return "";
}

function pickSpokenScriptFromGeneratedOutputRecord(go: Record<string, unknown> | null | undefined): string {
  if (!go) return "";
  const direct = extractSpokenScriptFromGenRecord(go);
  if (direct) return direct;
  const fromScenes = spokenScriptFromSceneBundle(go);
  if (fromScenes.trim()) return fromScenes.trim();

  const variations = arrayVal(go.variations);
  const firstVar = variations?.[0] ? recordVal(variations[0]) : null;
  if (firstVar) {
    const v = extractSpokenScriptFromGenRecord(firstVar);
    if (v) return v;
  }
  return "";
}

/** Spoken VO for HeyGen / video script flows — full parity with pipeline script sources. */
export function pickSpokenScriptFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? {};

  for (const k of SPOKEN_SCRIPT_KEYS) {
    const s = stringVal(p[k]).trim();
    if (s) return s;
  }

  const go = recordFromGeneratedOutput(p.generated_output);
  let s = pickSpokenScriptFromGeneratedOutputRecord(go);
  if (s) return s;

  const data = recordVal(p.data);
  if (data) {
    for (const k of SPOKEN_SCRIPT_KEYS) {
      const t = stringVal(data[k]).trim();
      if (t) return t;
    }
    const goData = recordFromGeneratedOutput(data.generated_output);
    s = pickSpokenScriptFromGeneratedOutputRecord(goData);
    if (s) return s;
  }

  return "";
}

/**
 * Video / HeyGen prompt text for the review workbench.
 * Mirrors `src/services/video-gen-fields.ts#extractVideoPromptText` and accepts legacy aliases
 * (`prompt`, `heygen_prompt`, `visual_prompt`) that sometimes land on the payload.
 * When the LLM emitted only a production-plan object (visual_direction, camera_instructions, …)
 * we synthesize a readable prompt so reviewers can still audit what HeyGen was asked for.
 */
const VIDEO_PROMPT_KEYS = ["video_prompt", "prompt", "heygen_prompt", "videoPrompt", "visual_prompt"] as const;

function synthesizeVideoPromptFromPlan(gen: Record<string, unknown>): string {
  const parts: string[] = [];
  const hook = gen.hook;
  if (typeof hook === "string" && hook.trim()) parts.push(`Hook: ${hook.trim()}`);
  const vd = recordVal(gen.visual_direction);
  if (vd) {
    for (const k of ["scene_style", "lighting", "background", "mood"]) {
      const v = vd[k];
      if (typeof v === "string" && v.trim()) parts.push(`${k.replace(/_/g, " ")}: ${v.trim()}`);
    }
  }
  const cam = recordVal(gen.camera_instructions);
  if (cam) {
    for (const k of ["framing", "movement", "angle"]) {
      const v = cam[k];
      if (typeof v === "string" && v.trim()) parts.push(`Camera ${k}: ${v.trim()}`);
    }
  }
  const en = recordVal(gen.editing_notes);
  if (en) {
    for (const k of ["pacing", "cuts"]) {
      const v = en[k];
      if (typeof v === "string" && v.trim()) parts.push(`Editing ${k}: ${v.trim()}`);
    }
  }
  const ost = arrayVal(gen.on_screen_text);
  if (ost) {
    const phrases = ost.filter((x): x is string => typeof x === "string" && x.trim().length > 0).slice(0, 8);
    if (phrases.length) parts.push(`On-screen text: ${phrases.join("; ")}`);
  }
  return parts.join(". ").trim();
}

function extractVideoPromptFromRecord(gen: Record<string, unknown>): string {
  for (const k of VIDEO_PROMPT_KEYS) {
    const v = gen[k];
    if (v != null && String(v).trim()) return String(v).trim();
  }
  for (const nestKey of ["output", "data", "video", "generated", "result"]) {
    const nest = recordVal(gen[nestKey]);
    if (!nest) continue;
    const s = extractVideoPromptFromRecord(nest);
    if (s) return s;
  }
  const synthesized = synthesizeVideoPromptFromPlan(gen);
  return synthesized;
}

export function pickVideoPromptFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? {};
  for (const k of VIDEO_PROMPT_KEYS) {
    const s = stringVal(p[k]).trim();
    if (s) return s;
  }
  const go = recordFromGeneratedOutput(p.generated_output);
  if (go) {
    const s = extractVideoPromptFromRecord(go);
    if (s) return s;
  }
  const data = recordVal(p.data);
  if (data) {
    for (const k of VIDEO_PROMPT_KEYS) {
      const t = stringVal(data[k]).trim();
      if (t) return t;
    }
    const goData = recordFromGeneratedOutput(data.generated_output);
    if (goData) {
      const s = extractVideoPromptFromRecord(goData);
      if (s) return s;
    }
  }
  return "";
}

/** Hook line for rework / sidebar — hook_line beats generic hook. */
export function pickHookFromGenerationPayload(payload: Record<string, unknown> | null | undefined): string {
  const p = payload ?? undefined;
  const top = stringVal(p?.hook).trim() || stringVal(p?.generated_hook).trim();
  if (top) return top;

  const go = recordVal(p?.generated_output);
  if (go) {
    const g = stringVal(go.hook_line).trim() || stringVal(go.hook).trim();
    if (g) return g;
  }
  return "";
}
