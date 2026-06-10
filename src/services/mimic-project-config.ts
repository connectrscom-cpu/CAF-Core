import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { effectiveMimicBflModel, parseProjectMimicBflModel, type MimicBflModelSlug } from "../domain/mimic-bfl-model.js";

export async function loadProjectMimicBflModel(
  db: Pool,
  projectId: string
): Promise<MimicBflModelSlug | null> {
  try {
    const row = await qOne<{ mimic_image_bfl_model: string | null }>(
      db,
      `SELECT mimic_image_bfl_model FROM caf_core.project_system_constraints WHERE project_id = $1`,
      [projectId]
    );
    return parseProjectMimicBflModel(row?.mimic_image_bfl_model);
  } catch {
    return null;
  }
}

export function appConfigWithMimicBflModel(
  config: AppConfig,
  projectModel: MimicBflModelSlug | null | undefined
): AppConfig {
  const model = effectiveMimicBflModel(projectModel, config.MIMIC_IMAGE_BFL_MODEL);
  if (model === config.MIMIC_IMAGE_BFL_MODEL.trim()) return config;
  return { ...config, MIMIC_IMAGE_BFL_MODEL: model };
}
