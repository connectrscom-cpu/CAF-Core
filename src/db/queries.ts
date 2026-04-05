import type { Pool, PoolClient } from "pg";

/** Run query with pool or transaction client */
export async function q<T extends object = Record<string, unknown>>(
  db: Pool | PoolClient,
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const res = await db.query(text, params);
  return res.rows as T[];
}

export async function qOne<T extends object = Record<string, unknown>>(
  db: Pool | PoolClient,
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await q<T>(db, text, params);
  return rows[0] ?? null;
}
