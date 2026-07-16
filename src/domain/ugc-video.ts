/**
 * UGC-style talking-head video — peer voice, reaction hooks, creator hosts.
 * Script-led HeyGen (`/v3/videos`) with a dedicated UGC avatar pool.
 */
import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";
import { pickGeneratedOutputOrEmpty, type GenerationPayloadLike } from "./generation-payload-output.js";

export const FLOW_VID_UGC = CANONICAL_FLOW_TYPES.VID_UGC;

export function isUgcVideoFlow(flowType: string | null | undefined): boolean {
  const ft = (flowType ?? "").trim();
  return ft === FLOW_VID_UGC || /\bFLOW_VID_UGC\b|ugc_video|Vid_Ugc|VID_UGC/i.test(ft);
}

/** Prefer product UGC hosts when the idea/job is product-lens. */
export function ugcPreferProductPresenterPool(gen: Record<string, unknown>, payload?: GenerationPayloadLike): boolean {
  const lens = String(gen.content_lens ?? "").trim().toLowerCase();
  if (lens === "product") return true;
  const cd =
    payload && typeof payload === "object" && !Array.isArray(payload)
      ? (payload as Record<string, unknown>).candidate_data
      : null;
  if (cd && typeof cd === "object" && !Array.isArray(cd)) {
    const cl = String((cd as Record<string, unknown>).content_lens ?? "").trim().toLowerCase();
    if (cl === "product") return true;
    if ((cd as Record<string, unknown>).use_product_bible === true) return true;
  }
  if (gen.use_product_bible === true) return true;
  return false;
}

function extractUgcSpokenScript(gen: Record<string, unknown>, minLen = 20): string {
  for (const k of ["spoken_script", "script", "video_script", "narration", "voiceover_script", "ugc_script"]) {
    const v = gen[k];
    if (typeof v === "string" && v.trim().length >= minLen) return v.trim();
  }
  return "";
}

export function extractUgcOnScreenHook(gen: Record<string, unknown>): string {
  for (const k of ["on_screen_hook", "hook_line", "hook_overlay", "ugc_hook_text"]) {
    const v = gen[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  const ost = gen.on_screen_text;
  if (typeof ost === "string" && ost.trim()) return ost.trim();
  if (Array.isArray(ost) && ost.length > 0) {
    const first = String(ost[0] ?? "").trim();
    if (first) return first;
  }
  return "";
}

export function extractUgcSetting(gen: Record<string, unknown>): string {
  for (const k of ["ugc_setting", "setting_vibe", "setting", "location_vibe"]) {
    const v = gen[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

export function normalizeUgcGeneratedOutput(gen: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...gen };
  const script = extractUgcSpokenScript(out, 20);
  if (script) {
    if (!String(out.spoken_script ?? "").trim()) out.spoken_script = script;
    if (!String(out.script ?? "").trim()) out.script = script;
  }
  const hook = extractUgcOnScreenHook(out);
  if (hook && !String(out.on_screen_hook ?? "").trim()) out.on_screen_hook = hook;
  const setting = extractUgcSetting(out);
  if (setting && !String(out.ugc_setting ?? "").trim()) out.ugc_setting = setting;
  return out;
}

export function ugcPayloadReady(gen: Record<string, unknown>): boolean {
  return extractUgcSpokenScript(normalizeUgcGeneratedOutput(gen), 20).length >= 20;
}

export function ugcPayloadReadyFromJob(generationPayload: GenerationPayloadLike): boolean {
  return ugcPayloadReady(pickGeneratedOutputOrEmpty(generationPayload));
}

/** System addendum for primary LLM generation (script package). */
export const UGC_VIDEO_OUTPUT_ADDENDUM = `UGC creator video JSON (mandatory fields) — peer / testimonial voice, NOT brand spokesperson:
- \`spoken_script\`: first-person, conversational VO the host says **verbatim** (15–40s). Sound like a real person on TikTok/Reels — contractions, reactions, imperfect phrasing. No corporate thesis voice.
- \`on_screen_hook\`: big mobile hook line (≤ 12 words) for the first 1–3s — often a reaction/confession ("I could actually…", "Nobody talks about…"). May differ slightly from the opening spoken words.
- \`ugc_setting\`: casual real-world setting (car, couch, kitchen, hallway, desk) — selfie / phone-camera energy.
- Optional \`delivery\`: whispered | shocked | deadpan | excited | conspiratorial.
- \`caption\`, \`hashtags\`, \`cta\` / \`cta_line\`: native social, soft recommend — not hard sell.
- Optional \`visual_direction\`: framing notes (selfie, slightly imperfect, natural light).

Do NOT write brand-explainer or polished presenter scripts. Ground the story in the idea's insight/evidence — lived moment, reaction, then soft tip/proof.`;
