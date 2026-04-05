import type { Pool } from "pg";
import { listPromptVersionsForFlow } from "../repositories/core.js";

export interface SelectedPrompt {
  prompt_version_id: string;
  prompt_id: string;
  version: string;
}

/**
 * Pick prompt version: prefer `active`, then highest version string among `test`.
 * Respects max_active_prompt_versions by taking first N — here we pick single winner.
 */
export async function selectPromptVersion(
  db: Pool,
  projectId: string,
  flowType: string,
  maxActive: number | null
): Promise<SelectedPrompt | null> {
  const rows = await listPromptVersionsForFlow(db, projectId, flowType, ["active", "test"]);
  if (rows.length === 0) return null;
  const active = rows.filter((r) => r.status === "active");
  const pool = active.length > 0 ? active : rows;
  const limit = maxActive && maxActive > 0 ? Math.min(maxActive, pool.length) : pool.length;
  const chosen = pool.slice(0, Math.max(1, limit))[0];
  if (!chosen) return null;
  return {
    prompt_version_id: chosen.id,
    prompt_id: chosen.prompt_id,
    version: chosen.version,
  };
}
