/**
 * Hook-first hybrid video — cinematic AI hook clip (4–8s) + HeyGen body segment.
 */
import { CANONICAL_FLOW_TYPES } from "./canonical-flow-types.js";
import { pickGeneratedOutputOrEmpty, type GenerationPayloadLike } from "./generation-payload-output.js";

export const FLOW_VID_HOOK_FIRST = CANONICAL_FLOW_TYPES.VID_HOOK_FIRST;

export type HookFirstBodyLane = "script_avatar" | "prompt_avatar" | "no_avatar";

const BODY_LANE_ALIASES: Record<string, HookFirstBodyLane> = {
  script_avatar: "script_avatar",
  script: "script_avatar",
  prompt_avatar: "prompt_avatar",
  prompt: "prompt_avatar",
  avatar: "prompt_avatar",
  no_avatar: "no_avatar",
  noavatar: "no_avatar",
};

export const HOOK_CLIP_DURATION_MIN_SEC = 4;
export const HOOK_CLIP_DURATION_MAX_SEC = 8;

export function clampHookClipDurationSec(raw: unknown, fallbackSec = 6): number {
  const n = Math.round(Number(raw) || fallbackSec);
  return Math.max(HOOK_CLIP_DURATION_MIN_SEC, Math.min(HOOK_CLIP_DURATION_MAX_SEC, n));
}

export function resolveHookClipProvider(
  config: Pick<{ HOOK_FIRST_CLIP_PROVIDER: "sora" | "heygen" }, "HOOK_FIRST_CLIP_PROVIDER">
): "sora" | "heygen" {
  if (config.HOOK_FIRST_CLIP_PROVIDER === "sora") return "sora";
  return "heygen";
}

export function isHookFirstVideoFlow(flowType: string | null | undefined): boolean {
  const ft = (flowType ?? "").trim();
  return ft === FLOW_VID_HOOK_FIRST || /hook_first|Hook_First|VID_HOOK_FIRST/i.test(ft);
}

export function resolveHookFirstBodyLane(raw: unknown): HookFirstBodyLane {
  const s = String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  return BODY_LANE_ALIASES[s] ?? "script_avatar";
}

export function hookFirstBodyFlowType(lane: HookFirstBodyLane): string {
  switch (lane) {
    case "script_avatar":
      return CANONICAL_FLOW_TYPES.VID_SCRIPT;
    case "prompt_avatar":
      return CANONICAL_FLOW_TYPES.VID_PROMPT;
    case "no_avatar":
      return CANONICAL_FLOW_TYPES.VID_PROMPT_NO_AVATAR;
  }
}

export function extractHookScenePrompt(gen: Record<string, unknown>, minLen = 20): string {
  for (const k of ["hook_scene_prompt", "hook_clip_prompt", "hook_visual_prompt", "cinematic_hook_prompt"]) {
    const v = gen[k];
    if (typeof v === "string" && v.trim().length >= minLen) return v.trim();
  }
  const hook = String(gen.hook ?? gen.hook_line ?? "").trim();
  if (hook.length >= minLen) {
    return `Cinematic scroll-stopping opener: ${hook}. Extreme emotional reaction, dramatic lighting, no on-screen text, no avatar.`;
  }
  return "";
}

export function extractHookFirstBridgeLine(gen: Record<string, unknown>): string {
  for (const k of ["bridge_line", "hook_bridge", "transition_line"]) {
    const v = gen[k];
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}

function extractHookFirstSpokenScript(gen: Record<string, unknown>, minLen = 20): string {
  for (const k of ["spoken_script", "script", "video_script", "narration", "voiceover_script"]) {
    const v = gen[k];
    if (typeof v === "string" && v.trim().length >= minLen) return v.trim();
  }
  const dialogue = gen.dialogue;
  if (Array.isArray(dialogue)) {
    const lines = dialogue
      .map((d) => {
        if (!d || typeof d !== "object" || Array.isArray(d)) return "";
        return String((d as Record<string, unknown>).line ?? "").trim();
      })
      .filter(Boolean);
    const joined = lines.join(" ").replace(/\s+/g, " ").trim();
    if (joined.length >= minLen) return joined;
  }
  if (Array.isArray(gen.beats)) {
    const joined = gen.beats
      .map((b) => String(b ?? "").trim())
      .filter(Boolean)
      .join(" ")
      .trim();
    if (joined.length >= minLen) return joined;
  }
  return "";
}

/** Materialize hook-first fields expected by render prep (heygen_package / script drift). */
export function normalizeHookFirstGeneratedOutput(gen: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...gen };
  const hook = extractHookScenePrompt(out, 20);
  if (hook && !String(out.hook_scene_prompt ?? "").trim()) {
    out.hook_scene_prompt = hook;
  }
  const body = extractHookFirstSpokenScript(out, 20);
  if (body && !String(out.spoken_script ?? out.script ?? "").trim()) {
    out.spoken_script = body;
    if (!String(out.script ?? "").trim()) out.script = body;
  }
  return out;
}

export function hookFirstPayloadReady(gen: Record<string, unknown>): boolean {
  const normalized = normalizeHookFirstGeneratedOutput(gen);
  const hook = extractHookScenePrompt(normalized, 20);
  const body = extractHookFirstSpokenScript(normalized, 20);
  return hook.length >= 20 && body.length >= 20;
}

/**
 * FAILED hook-first jobs with both segments rendered but no merged output — safe to retry concat only
 * (no HeyGen re-bill for hook/body when URLs are still in generated_output).
 */
export function isHookFirstFailedConcatRetryEligible(
  flowType: string | null | undefined,
  status: string | null | undefined,
  generationPayload: GenerationPayloadLike
): boolean {
  if (String(status ?? "").toUpperCase() !== "FAILED") return false;
  if (!isHookFirstVideoFlow(flowType)) return false;
  const gen = pickGeneratedOutputOrEmpty(generationPayload);
  const hook = String(gen.hook_clip_url ?? "").trim();
  const body = String(gen.body_video_url ?? "").trim();
  const merged = String(gen.merged_video_url ?? "").trim();
  return hook.length > 0 && body.length > 0 && merged.length === 0;
}

/** System addendum for primary LLM generation and render-time prep. */
export const HOOK_FIRST_VIDEO_OUTPUT_ADDENDUM = `Hook-first hybrid video JSON (mandatory fields):
- \`hook_line\`: short scroll-stopping line (≤ 12 words) — **spoken in the hook clip** as off-screen VO or in-scene reaction (no on-screen talking head).
- \`hook_scene_prompt\`: 4–8 second **cinematic AI video** prompt — dramatic emotional reaction imagery, pattern interrupt, hyper-real or stylized B-roll. **No avatar, no on-screen text** in the hook clip; **audio required** (spoken hook_line + cinematic SFX/ambient).
- \`hook_duration_sec\`: number 4–8 (target hook clip length).
- Optional \`hook_audio_direction\`: SFX/ambient cues for the hook (e.g. "sizzle, gasp, tense kitchen ambience").
- \`bridge_line\`: one sentence that **connects** the hook visual to the body (e.g. "And that's exactly why…").
- \`spoken_script\`: voiceover for the **body segment only** (after the hook). Start with \`bridge_line\` or a natural continuation — do **not** repeat the hook_line verbatim as the opening body VO.
- \`body_lane\`: one of \`script_avatar\` | \`prompt_avatar\` | \`no_avatar\` — how the body renders in HeyGen (default \`script_avatar\`).
- \`caption\`, \`hashtags\`, \`cta\` / \`cta_line\`: standard publication fields.
- Optional \`visual_direction\`, \`on_screen_text\` for the body segment only.

Continuity rule: the hook visual and body script must be about the **same topic**; the bridge must make the handoff feel intentional, not random.`;
