/**
 * Per-env-var hints keyed by variable name so the UI can render a description
 * next to each env knob row. Keep keys aligned with the env vars surfaced in
 * `env_tuning` in `/v1/admin/prompt-labs`.
 */
export const PROMPT_LABS_ENV_HINTS: Record<string, string> = {
  VIDEO_TARGET_DURATION_MIN_SEC:
    "Lower bound of the spoken video length band (seconds). With SCENE_VO_WORDS_PER_MINUTE, drives min/max spoken word counts enforced before HeyGen and in script-prep LLM.",
  VIDEO_TARGET_DURATION_MAX_SEC:
    "Upper bound of the spoken video length band (seconds). Same word-count mapping as MIN.",
  HEYGEN_ENFORCE_SPOKEN_SCRIPT_WORD_BOUNDS:
    "When true (default), HeyGen submit enforces min/max spoken word counts from VIDEO_TARGET_* × SCENE_VO_WORDS_PER_MINUTE (trim / expand / fail).",
  SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN:
    "Minimum number of scenes in the scene_bundle produced by Video_Scene_Generator.",
  SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX:
    "Maximum number of scenes in the scene_bundle produced by Video_Scene_Generator.",
  SCENE_ASSEMBLY_CLIP_DURATION_SEC:
    "Target per-clip duration used by the scene assembly system suffix.",
};

/**
 * Per-addendum metadata keyed by the addendum id returned in `core_addenda`.
 * Each entry gets a human title + description + a bucket telling the UI which
 * tab the addendum belongs to (`heygen` goes under HeyGen agent, everything
 * else under the merged Prompts tab).
 */
export const PROMPT_LABS_CORE_LAYER_META: Record<
  string,
  { title: string; description: string; bucket: "heygen" | "general" }
> = {
  publication_system_addendum: {
    title: "Publication system addendum",
    description:
      "Appended to every generator system prompt so outputs include the publication contract (hashtags, CTA, caption hygiene).",
    bucket: "general",
  },
  video_script_system_suffix: {
    title: "Video script system suffix (HeyGen script path)",
    description:
      "Duration-band policy appended to Video_Script_Generator system prompts. Feeds the HeyGen script-led path (POST /v3/videos).",
    bucket: "heygen",
  },
  video_prompt_system_suffix: {
    title: "Video prompt system suffix (HeyGen prompt path)",
    description:
      "Duration-band policy appended to Video_Prompt_Generator system prompts. Feeds the HeyGen Video Agent (POST /v3/video-agents).",
    bucket: "heygen",
  },
  scene_assembly_system_suffix: {
    title: "Scene assembly system suffix",
    description:
      "Scene-count and clip-duration policy appended to Video_Scene_Generator. Not part of the HeyGen path.",
    bucket: "general",
  },
  user_footer_script_json: {
    title: "User footer — script JSON (HeyGen script path)",
    description:
      "Hard footer appended to the user prompt for Video_Script_Generator to enforce the duration band against any earlier platform-specific target.",
    bucket: "heygen",
  },
  user_footer_video_plan: {
    title: "User footer — video plan (HeyGen prompt path)",
    description:
      "Hard footer appended to the user prompt for Video_Prompt_Generator to enforce the duration band against any earlier platform-specific target.",
    bucket: "heygen",
  },
};

export const PROMPT_LABS_HEYGEN_INTRO =
  "HeyGen Video Agent: rubric lines plus hook, spoken_script, video_prompt, and structured fields from the job payload.";

/**
 * Flow-engine `flow_type` values whose prompt templates belong to the HeyGen
 * path (single-video script-led and prompt-led generators). Scene assembly is
 * video but not HeyGen, so it stays under the generic Prompts tab.
 */
export const HEYGEN_FLOW_TYPES: readonly string[] = [
  "Video_Script_Generator",
  "Video_Prompt_Generator",
] as const;

export function isHeygenFlowType(flowType: string | null | undefined): boolean {
  const ft = (flowType ?? "").trim();
  return HEYGEN_FLOW_TYPES.includes(ft);
}

export function promptTemplateRoleHint(
  role: string | null | undefined,
  name: string | null | undefined
): string {
  const r = (role ?? "").toLowerCase();
  if (r === "scene_assembly") return "Builds `scene_bundle` for multi-scene assembly.";
  if (r === "generator") return "Primary structured output for this flow type.";
  if (r === "system") return "System instructions for the model.";
  const n = (name ?? "").trim();
  return n || role || "Prompt template";
}
