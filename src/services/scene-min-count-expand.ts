import type { AppConfig } from "../config.js";

export function expandSceneAssemblyToMinScenes(
  scenes: Record<string, unknown>[],
  _gen: Record<string, unknown>,
  _config: AppConfig
): { scenes: Record<string, unknown>[]; didPad: boolean; countBefore: number } {
  return { scenes, didPad: false, countBefore: scenes.length };
}
