/**
 * Normalize top-performer video LLM JSON (esp. Nemotron) into the flat schema CAF persists.
 */

const WRAPPER_KEYS = [
  "video_wide",
  "video_wide_summary",
  "video",
  "analysis",
  "result",
  "response",
  "output",
  "data",
  "deck",
] as const;

const ROOT_STRING_FIELDS = [
  "hook_visual",
  "message_clarity",
  "pacing_notes",
  "video_arc",
  "opening_vs_body",
  "visual_consistency",
  "on_screen_text_summary",
  "spoken_hook",
  "cta_clarity",
  "format_pattern",
  "why_it_worked",
  "video_as_whole_summary",
] as const;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function pickString(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function looksLikeGarbageVideoPayload(root: Record<string, unknown>): boolean {
  if ("error" in root || "ppcmd" in root || "missing_frame_pattern" in root) return true;
  if ("cmd" in root && !Array.isArray(root.frames)) return true;
  if ("zoom" in root && !Array.isArray(root.frames) && !root.video_arc) return true;
  return false;
}

function normalizeTextDensity(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().toLowerCase();
  if (s === "low" || s === "medium" || s === "high") return s;
  return null;
}

function normalizeFrameRecord(raw: unknown, fallbackIndex: number): Record<string, unknown> | null {
  const f = asRecord(raw);
  if (!f) return null;
  const out: Record<string, unknown> = { ...f };
  const frameIndex = Number(f.frame_index);
  out.frame_index = Number.isFinite(frameIndex) && frameIndex > 0 ? frameIndex : fallbackIndex;

  const shot = pickString(f, "shot_type", "hot_type", "hook_type", "frame_type");
  if (shot) out.shot_type = shot;

  const density = normalizeTextDensity(f.text_density);
  if (density) out.text_density = density;

  if (!out.on_screen_text_transcript) {
    const alt = pickString(f, "on_screen_text", "text_transcript", "ocr_text", "visible_text");
    if (alt) out.on_screen_text_transcript = alt;
  }

  return out;
}

function collectFrames(root: Record<string, unknown>): unknown[] {
  const direct = root.frames ?? root.frame_analysis ?? root.frame;
  if (Array.isArray(direct)) return direct;

  for (const wrap of WRAPPER_KEYS) {
    const inner = asRecord(root[wrap]);
    if (!inner) continue;
    const nested = inner.frames ?? inner.frame_analysis ?? inner.frame;
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

function unwrapRoot(parsed: Record<string, unknown>): Record<string, unknown> {
  let root: Record<string, unknown> = { ...parsed };

  for (const wrap of WRAPPER_KEYS) {
    const inner = asRecord(root[wrap]);
    if (!inner) continue;
    const merged: Record<string, unknown> = { ...root, ...inner };
    delete merged[wrap];
    root = merged;
  }

  return root;
}

function applyAliases(root: Record<string, unknown>): void {
  if (!pickString(root, "format_pattern")) {
    const hook = pickString(root, "hook_type", "video_format", "format");
    if (hook) root.format_pattern = hook;
  }
  if (!pickString(root, "why_it_worked")) {
    const why = pickString(root, "performance_reason", "summary", "why_it_performed");
    if (why) root.why_it_worked = why;
  }
  if (!pickString(root, "spoken_hook")) {
    const hook = pickString(root, "hook", "opening_hook", "hook_text");
    if (hook) root.spoken_hook = hook;
  }
  if (!pickString(root, "video_arc")) {
    const arc = pickString(root, "narrative_arc", "story_arc");
    if (arc) root.video_arc = arc;
  }
}

export function normalizeVideoInsightsLlmJson(
  parsed: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!parsed) return null;

  let root = unwrapRoot(parsed);
  if (looksLikeGarbageVideoPayload(root)) {
    const salvaged = pickString(root, "video_arc") ?? pickString(root, "why_it_worked");
    if (!salvaged) return null;
    root = {
      video_arc: root.video_arc,
      why_it_worked: root.why_it_worked,
      format_pattern: root.format_pattern,
      cta_clarity: root.cta_clarity,
      risk_flags: root.risk_flags ?? [],
    };
  }

  applyAliases(root);

  const framesRaw = collectFrames(root);
  if (framesRaw.length > 0) {
    root.frames = framesRaw
      .map((raw, i) => normalizeFrameRecord(raw, i + 1))
      .filter((f): f is Record<string, unknown> => f != null);
  }

  if (!Array.isArray(root.risk_flags)) {
    const risks = root.risk_flags ?? root.risks;
    root.risk_flags = Array.isArray(risks) ? risks : [];
  }

  for (const key of ROOT_STRING_FIELDS) {
    const v = root[key];
    if (v != null && typeof v !== "string") {
      root[key] = String(v);
    }
  }

  return root;
}

export function mergeVideoInsightChunks(chunks: Array<Record<string, unknown> | null>): Record<string, unknown> {
  const normalized = chunks
    .map((c) => normalizeVideoInsightsLlmJson(c))
    .filter((c): c is Record<string, unknown> => c != null);

  if (normalized.length === 0) return {};

  const merged: Record<string, unknown> = { ...normalized[0] };
  const frames: Record<string, unknown>[] = [];

  for (const part of normalized) {
    const partFrames = Array.isArray(part.frames) ? part.frames : [];
    for (const raw of partFrames) {
      const frame = normalizeFrameRecord(raw, frames.length + 1);
      if (frame) frames.push(frame);
    }
  }

  if (frames.length > 0) {
    frames.sort((a, b) => Number(a.frame_index) - Number(b.frame_index));
    merged.frames = frames;
  }

  return normalizeVideoInsightsLlmJson(merged) ?? merged;
}

export const TOP_PERFORMER_VIDEO_NVIDIA_JSON_APPENDIX = `

NVIDIA / Nemotron — strict output contract:
- Return ONE flat JSON object at the root. Never nest under "video_wide", "video_wide_summary", "analysis", or "result".
- Required root strings: hook_visual, message_clarity, video_arc, on_screen_text_summary, cta_clarity, format_pattern, why_it_worked
- Required root arrays: risk_flags (use [] when none), frames (one object per attached frame image)
- Each frames[] entry MUST include frame_index, on_screen_text_transcript, visual_description, layout_template, typography, color_tokens, shot_type, text_density
- format_pattern MUST be one of: talking_head, b_roll, text_on_screen, ugc, product_demo, mixed, unknown`;

export const TOP_PERFORMER_VIDEO_FRAMES_CHUNK_PROMPT = `You analyze a subset of frames from a larger short-form video.

Return ONLY flat JSON (no wrappers):
{
  "frames": [
    {
      "frame_index": <global index from user message>,
      "timestamp_sec": <seconds if known>,
      "on_screen_text_transcript": "...",
      "visual_description": "...",
      "layout_template": "...",
      "typography": { "headline_guess": "...", "body_guess": "...", "hierarchy": "..." },
      "color_tokens": { "background": "...", "primary_text": "...", "accent": [] },
      "shot_type": "...",
      "text_density": "low | medium | high"
    }
  ]
}

frames.length MUST equal the number of frame image attachments. frame_index values MUST match the global indices in the user message.`;
