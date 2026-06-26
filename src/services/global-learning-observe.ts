/**
 * Write read-only global observatory rows on caf-global (never affects planning/generation).
 */
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getGlobalLearningProjectId } from "../repositories/learning-global.js";
import { insertObservation } from "../repositories/learning-evidence.js";

export async function emitGlobalLearningObservation(
  db: Pool,
  opts: {
    source_type: string;
    observation_type: string;
    payload_json: Record<string, unknown>;
    entity_ref?: string | null;
    flow_type?: string | null;
    platform?: string | null;
    confidence?: number | null;
    observation_id?: string;
  }
): Promise<boolean> {
  const globalId = await getGlobalLearningProjectId(db);
  if (!globalId) return false;

  const observationId =
    opts.observation_id?.trim() ||
    `glob_${opts.source_type}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;

  await insertObservation(db, {
    observation_id: observationId,
    scope_type: "global",
    project_id: globalId,
    source_type: opts.source_type,
    flow_type: opts.flow_type ?? null,
    platform: opts.platform ?? null,
    observation_type: opts.observation_type,
    entity_ref: opts.entity_ref ?? null,
    payload_json: opts.payload_json,
    confidence: opts.confidence ?? null,
    observed_at: new Date().toISOString(),
  });
  return true;
}
