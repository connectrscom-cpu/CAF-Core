/**
 * Second-pass **text** synthesis for top-performer video insights.
 * Combines Whisper transcript, caption, per-frame vision OCR/descriptions into cohesive prose fields.
 */
import type { AppConfig } from "../config.js";
import { parseJsonObjectFromLlmText } from "./llm-json-extract.js";
import { openaiChat, type OpenAiAuditContext } from "./openai-chat.js";
import { openAiMaxTokens } from "./openai-coerce.js";
import { isSpokenHookPlaceholder } from "./video-insights-llm-normalize.js";

const SYNTHESIS_SYSTEM = `You synthesize a **full short-form video analysis** from structured evidence (ASR transcript, caption, per-frame vision notes).

You did NOT watch the video. Ground every claim in the supplied evidence only. When audio and on-screen text disagree, note both.

Return ONLY valid JSON:
{
  "narrative_arc": "2–5 sentences: story/list progression from opening through close",
  "message_thesis": "one clear sentence — the core takeaway for the viewer",
  "spoken_script_summary": "faithful summary of what is said aloud (not necessarily verbatim); use (inaudible) when ASR is empty",
  "on_screen_text_script": "concatenate readable on-screen copy in chronological frame order; separate frames with blank lines",
  "hook_analysis": {
    "visual": "what the opening frames signal",
    "spoken": "best opening spoken hook line (short)",
    "on_screen": "opening on-screen hook text if any"
  },
  "why_it_worked": "3–6 sentences: retention, clarity, emotional angle, proof, pacing — why this may outperform",
  "retention_devices": ["specific tricks: pattern interrupt, list structure, social proof, etc."],
  "audience_fit": "who this speaks to and why the format fits",
  "cta_analysis": "how the ask / next step lands (or 'none visible')",
  "message_clarity": "how clear the value prop is",
  "pacing_notes": "cuts, energy, density inferred from frame sequence + speech",
  "opening_vs_body": "how hook differs from middle/ending",
  "spoken_hook": "short best opening spoken line for DB hook (≤200 chars)",
  "video_arc": "synonym-quality arc string if narrative_arc is long — can mirror narrative_arc"
}`;

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function stringCap(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s) return undefined;
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

/** Compact vision output for the synthesis LLM (no base64 / huge blobs). */
export function buildVideoInsightSynthesisEvidencePack(args: {
  captionTranscript: string;
  whisperTranscript: string;
  frameCount: number;
  frameTimestampsSec: number[];
  visionParsed: Record<string, unknown>;
}): Record<string, unknown> {
  const frames = Array.isArray(args.visionParsed.frames) ? args.visionParsed.frames : [];
  const frameSummaries = frames.slice(0, 16).map((raw, i) => {
    const f = asRecord(raw);
    if (!f) return null;
    const idx = Number(f.frame_index) || i + 1;
    const ts = args.frameTimestampsSec[idx - 1];
    return {
      frame_index: idx,
      timestamp_sec: ts ?? f.timestamp_sec ?? null,
      on_screen_text: stringCap(f.on_screen_text_transcript, 600),
      visual_description: stringCap(f.visual_description, 400),
      layout_template: stringCap(f.layout_template, 80),
      shot_type: stringCap(f.shot_type, 40),
    };
  }).filter(Boolean);

  const visionWide: Record<string, unknown> = {};
  for (const k of [
    "hook_visual",
    "message_clarity",
    "format_pattern",
    "video_arc",
    "why_it_worked",
    "on_screen_text_summary",
    "spoken_hook",
    "video_as_whole_summary",
  ] as const) {
    const v = args.visionParsed[k];
    if (typeof v === "string" && v.trim()) visionWide[k] = v.trim();
  }

  return {
    frame_count: args.frameCount,
    caption_transcript: args.captionTranscript.trim() || null,
    whisper_transcript: args.whisperTranscript.trim() || null,
    vision_wide: visionWide,
    frames: frameSummaries,
  };
}

export function shouldRunVideoInsightFullAnalysis(args: {
  openAiApiKey: string;
  frameCount: number;
  whisperTranscript: string;
  captionTranscript: string;
  visionParsed: Record<string, unknown> | null;
}): boolean {
  if (!args.openAiApiKey.trim()) return false;
  if (!args.visionParsed) return false;
  const hasAudio = !!args.whisperTranscript.trim();
  const hasCaption = !!args.captionTranscript.trim();
  const hasFrames = args.frameCount >= 2;
  const hasVisionWide = !!String(args.visionParsed.why_it_worked ?? args.visionParsed.video_as_whole_summary ?? "").trim();
  return hasAudio || hasCaption || hasFrames || hasVisionWide;
}

/** Merge synthesis JSON into vision parse — synthesis wins on narrative fields when non-empty. */
export function mergeFullVideoAnalysisIntoParsed(
  visionParsed: Record<string, unknown>,
  synthesis: Record<string, unknown> | null
): Record<string, unknown> {
  if (!synthesis) return visionParsed;
  const out = { ...visionParsed };

  const fullBlock: Record<string, unknown> = {};
  for (const k of [
    "narrative_arc",
    "message_thesis",
    "spoken_script_summary",
    "on_screen_text_script",
    "retention_devices",
    "audience_fit",
    "cta_analysis",
  ] as const) {
    if (synthesis[k] !== undefined) fullBlock[k] = synthesis[k];
  }
  const hookAnalysis = asRecord(synthesis.hook_analysis);
  if (hookAnalysis) fullBlock.hook_analysis = hookAnalysis;

  if (Object.keys(fullBlock).length > 0) {
    out.full_video_analysis = fullBlock;
  }

  const overwriteStrings = [
    "why_it_worked",
    "video_arc",
    "message_clarity",
    "pacing_notes",
    "opening_vs_body",
    "spoken_hook",
    "on_screen_text_summary",
    "narrative_arc",
    "message_thesis",
  ] as const;

  for (const key of overwriteStrings) {
    const syn = synthesis[key];
    if (typeof syn === "string" && syn.trim()) {
      out[key] = syn.trim();
    }
  }

  if (typeof synthesis.on_screen_text_script === "string" && synthesis.on_screen_text_script.trim()) {
    const script = synthesis.on_screen_text_script.trim();
    if (!out.on_screen_text_summary || String(out.on_screen_text_summary).length < 40) {
      out.on_screen_text_summary = script.length > 800 ? `${script.slice(0, 800)}…` : script;
    }
    out.on_screen_text_script = script;
  }

  const spokenHook = typeof synthesis.spoken_hook === "string" ? synthesis.spoken_hook.trim() : "";
  if (spokenHook && !isSpokenHookPlaceholder(spokenHook)) {
    out.spoken_hook = spokenHook.length > 240 ? `${spokenHook.slice(0, 240)}…` : spokenHook;
  } else if (hookAnalysis?.spoken && typeof hookAnalysis.spoken === "string") {
    const h = hookAnalysis.spoken.trim();
    if (h && !isSpokenHookPlaceholder(h)) out.spoken_hook = h;
  }

  out._full_video_synthesis = true;
  return out;
}

export async function synthesizeVideoInsightFullAnalysis(args: {
  config: AppConfig;
  openAiApiKey: string;
  captionTranscript: string;
  whisperTranscript: string;
  frameCount: number;
  frameTimestampsSec: number[];
  visionParsed: Record<string, unknown>;
  audit: OpenAiAuditContext;
}): Promise<{ parsed: Record<string, unknown> | null; model: string | null }> {
  if (
    !shouldRunVideoInsightFullAnalysis({
      openAiApiKey: args.openAiApiKey,
      frameCount: args.frameCount,
      whisperTranscript: args.whisperTranscript,
      captionTranscript: args.captionTranscript,
      visionParsed: args.visionParsed,
    })
  ) {
    return { parsed: null, model: null };
  }

  const evidence = buildVideoInsightSynthesisEvidencePack({
    captionTranscript: args.captionTranscript,
    whisperTranscript: args.whisperTranscript,
    frameCount: args.frameCount,
    frameTimestampsSec: args.frameTimestampsSec,
    visionParsed: args.visionParsed,
  });

  const user = [
    "Synthesize full-video analysis from this evidence pack.",
    "When whisper_transcript is present, treat it as ground truth for spoken content.",
    "",
    JSON.stringify(evidence, null, 2),
  ].join("\n");

  const llm = await openaiChat(
    args.openAiApiKey,
    {
      model: args.config.OPENAI_MODEL,
      system_prompt: SYNTHESIS_SYSTEM,
      user_prompt: user,
      max_tokens: openAiMaxTokens(4096),
      response_format: "json_object",
    },
    { ...args.audit, step: "inputs_top_performer_video_full_analysis" }
  );

  const parsed = parseJsonObjectFromLlmText(llm.content);
  return { parsed, model: llm.model };
}
