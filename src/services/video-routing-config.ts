import type { Pool } from "pg";
import type { AppConfig } from "../config.js";
import {
  DEFAULT_VIDEO_ROUTING,
  parseVideoRoutingConfig,
  type VideoRoutingConfig,
} from "../decision_engine/video-flow-routing.js";
import {
  defaultProductFlowHeygenMode,
  isProductVideoFlow,
  type ProductHeygenMode,
} from "../domain/product-flow-types.js";
import { resolveProductFlowHeygenMode } from "../repositories/project-config.js";
import { qOne } from "../db/queries.js";

export async function loadVideoRoutingConfig(
  db: Pool,
  _config: AppConfig,
  projectId: string
): Promise<VideoRoutingConfig> {
  try {
    const row = await qOne<{ video_routing: unknown }>(
      db,
      `SELECT video_routing FROM caf_core.project_system_constraints WHERE project_id = $1`,
      [projectId]
    );
    return parseVideoRoutingConfig(row?.video_routing, DEFAULT_VIDEO_ROUTING);
  } catch {
    return { ...DEFAULT_VIDEO_ROUTING };
  }
}

export async function loadProductHeygenModesForFlows(
  db: Pool,
  projectId: string,
  flowTypes: string[]
): Promise<Map<string, ProductHeygenMode | null>> {
  const map = new Map<string, ProductHeygenMode | null>();
  for (const ft of flowTypes) {
    if (!isProductVideoFlow(ft)) continue;
    try {
      map.set(ft, await resolveProductFlowHeygenMode(db, projectId, ft));
    } catch {
      map.set(ft, defaultProductFlowHeygenMode(ft));
    }
  }
  return map;
}
