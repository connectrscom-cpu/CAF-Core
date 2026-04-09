import type { AppConfig } from "../config.js";
import type { Pool } from "pg";

export async function createUploadSoraSceneClip(
  _config: AppConfig,
  _args: {
    prompt: string;
    global_visual_context: string | null;
    taskId: string;
    runId: string;
    sceneIndex: number;
    audit: {
      db: Pool;
      projectId: string;
      runId: string;
      taskId: string;
      scene_index: number;
    };
  }
): Promise<{ publicUrl: string }> {
  throw new Error(
    "Sora scene clips: full OpenAI Videos upload pipeline is not wired in this build. " +
      "Set scene clip URLs on `scene_bundle.scenes[]` or extend sora-scene-clips.ts."
  );
}
