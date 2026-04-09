export const PROMPT_LABS_ENV_HINTS = [
  "VIDEO_TARGET_DURATION_MIN_SEC / MAX_SEC — spoken length band for video script & prompt flows.",
  "SCENE_ASSEMBLY_TARGET_SCENE_COUNT_* and SCENE_ASSEMBLY_CLIP_DURATION_SEC — scene bundle planning.",
  "SCENE_VO_WORDS_PER_MINUTE — ties spoken_script length to expected scene timeline.",
] as const;

export const PROMPT_LABS_CORE_LAYER_META = {
  layers: [
    { id: "flow_engine", label: "Flow Engine templates (system + user)" },
    { id: "learning", label: "Compiled active generation learning rules" },
    { id: "publication", label: "Publication output contract (hashtags, CTA)" },
  ],
} as const;

export const PROMPT_LABS_HEYGEN_INTRO =
  "HeyGen Video Agent: rubric lines plus hook, spoken_script, video_prompt, and structured fields from the job payload.";

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
