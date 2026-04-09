export function creationContextHasUnreplacedPlaceholders(userPrompt: string): boolean {
  return /\{\{[^}]+\}\}/.test(userPrompt);
}

export function userPromptLooksLikePerSceneVideoTemplate(userPrompt: string): boolean {
  return (
    (/per[-_ ]?scene/i.test(userPrompt) || /\bscene\s*\d+\b/i.test(userPrompt)) &&
    /video_prompt|scene_prompt/i.test(userPrompt)
  );
}

import { slimContextForCreationPackJson } from "./llm-generator-helpers.js";

export function sceneBundleFallbackUserPrompt(
  context: Record<string, unknown>,
  sceneTargets: { min: number; max: number }
): string {
  return [
    "Return a single JSON object with a `scene_bundle` object containing `scenes`: an array of scene objects.",
    "Each scene must include `video_prompt` (visuals) and `scene_narration_line` (one slice of the full script, in order).",
    `Target scene count: between ${sceneTargets.min} and ${sceneTargets.max} inclusive.`,
    "Use creation_pack_json context below.",
    "",
    JSON.stringify({ creation_pack: slimContextForCreationPackJson(context) }, null, 0),
  ].join("\n");
}
