import type { Pool } from "pg";
import type { AppConfig } from "../config.js";

/**
 * Admin Scene lab — full implementation is not present in this workspace (module was missing from tree).
 * Endpoints return a clear error until the real service is restored.
 */
export async function runSceneAssemblyLabNew(
  _db: Pool,
  _config: AppConfig,
  _args: Record<string, unknown>
): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error:
      "scene_assembly_lab is unavailable: add the real src/services/scene-assembly-lab.ts (missing from this checkout).",
  };
}

export async function runSceneAssemblyLabRegenerate(
  _db: Pool,
  _config: AppConfig,
  _args: Record<string, unknown>
): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error:
      "scene_assembly_lab is unavailable: add the real src/services/scene-assembly-lab.ts (missing from this checkout).",
  };
}
