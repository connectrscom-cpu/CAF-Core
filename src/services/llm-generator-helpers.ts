import type { Pool } from "pg";
import { getStrategyDefaults, getBrandConstraints, listPlatformConstraints } from "../repositories/project-config.js";
import { getSignalPackById } from "../repositories/signal-packs.js";

export async function buildCreationPack(
  db: Pool,
  projectId: string,
  signalPackId: string | null,
  candidateData: Record<string, unknown>,
  platform: string | null
): Promise<Record<string, unknown>> {
  const [strategy, brand, platforms, signalPack] = await Promise.all([
    getStrategyDefaults(db, projectId),
    getBrandConstraints(db, projectId),
    listPlatformConstraints(db, projectId),
    signalPackId ? getSignalPackById(db, signalPackId) : null,
  ]);

  const platformConstraint = platforms.find(
    (p) => p.platform?.toLowerCase() === (platform ?? "").toLowerCase()
  );

  return {
    strategy: strategy ?? {},
    brand_constraints: brand ?? {},
    platform_constraints: platformConstraint ?? {},
    signal_pack: signalPack
      ? {
          run_id: signalPack.run_id,
          overall_candidates_json: signalPack.overall_candidates_json,
          derived_globals_json: signalPack.derived_globals_json,
        }
      : {},
    candidate: candidateData,
  };
}

export function interpolateTemplate(template: string, context: Record<string, unknown>): string {
  let result = template;
  result = result.replace(/\{\{creation_pack_json\}\}/g, JSON.stringify(context));
  result = result.replace(/\{\{creation_pack\}\}/g, JSON.stringify(context));

  for (const [key, value] of Object.entries(context)) {
    const placeholder = `{{${key}}}`;
    if (result.includes(placeholder)) {
      result = result.replace(
        new RegExp(placeholder.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
        typeof value === "string" ? value : JSON.stringify(value)
      );
    }
  }
  return result;
}
