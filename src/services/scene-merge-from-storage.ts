import type { Pool } from "pg";
import type { AppConfig } from "../config.js";

/** Merge pre-uploaded scene MP4s from storage — stub until real module exists. */
export async function runSceneAssemblyMergeClipsFromStorage(
  _db: Pool,
  _config: AppConfig,
  _projectId: string,
  _taskId: string,
  _opts?: { expand_voiceover?: "auto" | "always" | "never" }
): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error:
      "scene_merge_from_storage is unavailable: add src/services/scene-merge-from-storage.ts (missing from this checkout).",
  };
}

export async function runSceneAssemblyResumePipelineFromJobPayload(
  _db: Pool,
  _config: AppConfig,
  _projectId: string,
  _taskId: string
): Promise<{ ok: false; error: string }> {
  return {
    ok: false,
    error:
      "scene_resume_pipeline is unavailable: add src/services/scene-merge-from-storage.ts (missing from this checkout).",
  };
}
