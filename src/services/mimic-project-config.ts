import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import { qOne } from "../db/queries.js";
import { effectiveMimicBflModel, parseProjectMimicBflModel, type MimicBflModelSlug } from "../domain/mimic-bfl-model.js";
import {
  effectiveMimicCarouselTextViaFlux,
  effectiveMimicVisualSimilarityPct,
  parseProjectMimicCarouselTextViaFlux,
  parseProjectMimicVisualSimilarityPct,
} from "../domain/mimic-render-settings.js";

export interface ProjectMimicRenderSettings {
  bflModel: MimicBflModelSlug | null;
  visualSimilarityPct: number;
  carouselTextViaFlux: boolean;
}

type MimicConstraintsRow = {
  mimic_image_bfl_model: string | null;
  mimic_visual_similarity_pct: number | null;
  mimic_carousel_text_via_flux: boolean | null;
};

export async function loadProjectMimicConstraintsRow(
  db: Pool,
  projectId: string
): Promise<MimicConstraintsRow | null> {
  try {
    return await qOne<MimicConstraintsRow>(
      db,
      `SELECT mimic_image_bfl_model, mimic_visual_similarity_pct, mimic_carousel_text_via_flux
       FROM caf_core.project_system_constraints WHERE project_id = $1`,
      [projectId]
    );
  } catch {
    return null;
  }
}

export async function loadProjectMimicRenderSettings(
  db: Pool,
  projectId: string,
  config: AppConfig
): Promise<ProjectMimicRenderSettings> {
  const row = await loadProjectMimicConstraintsRow(db, projectId);
  return {
    bflModel: parseProjectMimicBflModel(row?.mimic_image_bfl_model),
    visualSimilarityPct: effectiveMimicVisualSimilarityPct(
      parseProjectMimicVisualSimilarityPct(row?.mimic_visual_similarity_pct),
      config.MIMIC_VISUAL_SIMILARITY_PCT
    ),
    carouselTextViaFlux: effectiveMimicCarouselTextViaFlux(
      parseProjectMimicCarouselTextViaFlux(row?.mimic_carousel_text_via_flux),
      config.MIMIC_CAROUSEL_TEXT_VIA_FLUX
    ),
  };
}

/** @deprecated Use loadProjectMimicRenderSettings */
export async function loadProjectMimicBflModel(
  db: Pool,
  projectId: string
): Promise<MimicBflModelSlug | null> {
  const row = await loadProjectMimicConstraintsRow(db, projectId);
  return parseProjectMimicBflModel(row?.mimic_image_bfl_model);
}

export function appConfigWithMimicBflModel(
  config: AppConfig,
  projectModel: MimicBflModelSlug | null | undefined
): AppConfig {
  const model = effectiveMimicBflModel(projectModel, config.MIMIC_IMAGE_BFL_MODEL);
  if (model === config.MIMIC_IMAGE_BFL_MODEL.trim()) return config;
  return { ...config, MIMIC_IMAGE_BFL_MODEL: model };
}
