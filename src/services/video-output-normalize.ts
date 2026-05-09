/**
 * Post-parse fixes for video LLM JSON: flatten nested `spoken_script`, backfill `video_prompt`, VO hygiene.
 */
import { isVideoFlow } from "../decision_engine/flow-kind.js";
import {
  extractExplicitVideoPromptText,
  extractSpokenScriptText,
  extractVideoPromptText,
} from "./video-gen-fields.js";

/** Primary LLM for HeyGen prompt-led path (product flows + Video_Prompt_* without Script). */
function isPrimaryVideoPlanFlow(flowType: string): boolean {
  const ft = flowType ?? "";
  return (
    (/Video_Prompt|video_prompt|Prompt_HeyGen|HeyGen_NoAvatar|PROMPT/i.test(ft) &&
      !/Video_Script|video_script|Script_HeyGen|script_generator/i.test(ft)) ||
    /^FLOW_PRODUCT_/i.test(ft)
  );
}

/** Strip a single pair of outer ASCII quotes when the model wraps the whole VO in quotes (bad for TTS). */
function stripOuterQuoteWrap(s: string): string {
  const t = s.trim();
  if (t.length < 2) return t;
  const q = t[0];
  if ((q === '"' || q === "'") && t[t.length - 1] === q) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return t;
    return inner;
  }
  return t;
}

export function normalizeVideoLlmParsed(flowType: string, parsed: Record<string, unknown>): Record<string, unknown> {
  if (!isVideoFlow(flowType)) return parsed;
  const out = { ...parsed };

  const flatScript = extractSpokenScriptText(out, 1).trim();
  const ss = out.spoken_script;
  if (flatScript) {
    if (ss != null && typeof ss !== "string") {
      out.spoken_script = flatScript;
      if ("script" in out && typeof out.script === "object") out.script = flatScript;
      if ("video_script" in out && typeof out.video_script === "object") out.video_script = flatScript;
    } else if (typeof ss === "string" && ss.trim()) {
      const cleaned = stripOuterQuoteWrap(ss);
      if (cleaned !== ss.trim()) out.spoken_script = cleaned;
    }
  }

  if (isPrimaryVideoPlanFlow(flowType)) {
    const existing = String(out.video_prompt ?? "").trim();
    const explicit = extractExplicitVideoPromptText(out, 10);
    if (!existing || existing.length < 10) {
      const fill = explicit.length >= 10 ? explicit : extractVideoPromptText(out, 10);
      if (fill) out.video_prompt = fill;
    }
  }

  return out;
}
