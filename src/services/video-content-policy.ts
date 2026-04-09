import type { AppConfig } from "../config.js";

function durBlock(cfg: AppConfig): string {
  const lo = cfg.VIDEO_TARGET_DURATION_MIN_SEC;
  const hi = cfg.VIDEO_TARGET_DURATION_MAX_SEC;
  return `Target spoken video length: **${lo}–${hi} seconds** (platform-safe). Plan pacing and script length accordingly.`;
}

function sceneBlock(cfg: AppConfig): string {
  return (
    `Scene assembly: produce **${cfg.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MIN}–${cfg.SCENE_ASSEMBLY_TARGET_SCENE_COUNT_MAX}** scenes; ` +
    `each clip ~**${cfg.SCENE_ASSEMBLY_CLIP_DURATION_SEC}s**; ` +
    `spoken_script should match total scene timeline (~${cfg.SCENE_VO_WORDS_PER_MINUTE} WPM guidance).`
  );
}

export function withVideoScriptDurationPolicy(
  base: string,
  config: AppConfig,
  opts?: { multiScene?: boolean }
): string {
  const extra = opts?.multiScene ? `${durBlock(config)}\n${sceneBlock(config)}` : durBlock(config);
  return `${base.trim()}\n\n${extra}`.trim();
}

export function withVideoPromptDurationPolicy(base: string, config: AppConfig): string {
  return `${base.trim()}\n\n${durBlock(config)}`.trim();
}

export function withSceneAssemblyPolicy(base: string, config: AppConfig): string {
  return `${base.trim()}\n\n${sceneBlock(config)}`.trim();
}

export function appendVideoUserPromptDurationHardFooter(
  userPrompt: string,
  config: AppConfig,
  kind: "script_json" | "video_plan" = "script_json"
): string {
  const label = kind === "video_plan" ? "video plan" : "script JSON";
  const footer =
    `\n\n---\n**Hard rules (${label}):** ${durBlock(config)} ` +
    `Do not promise durations outside this band in hooks or CTA.`;
  return `${userPrompt.trim()}${footer}`;
}

export function applySceneTargetsToScenes(
  scenes: Record<string, unknown>[],
  _config: AppConfig
): Record<string, unknown>[] {
  return scenes;
}
