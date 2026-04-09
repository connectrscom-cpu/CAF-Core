import type { Pool } from "pg";
import { qOne } from "../db/queries.js";

/** UUID of the `caf-global` project (global learning rules), or null if not seeded. */
export async function getGlobalLearningProjectId(db: Pool): Promise<string | null> {
  const r = await qOne<{ id: string }>(
    db,
    `SELECT id FROM caf_core.projects WHERE slug = 'caf-global' LIMIT 1`
  );
  return r?.id ?? null;
}
