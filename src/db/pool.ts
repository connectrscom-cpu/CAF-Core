import pg from "pg";
import type { AppConfig } from "../config.js";

const { Pool } = pg;

export function createPool(config: AppConfig): pg.Pool {
  return new Pool({
    connectionString: config.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
  });
}

export type DbPool = pg.Pool;
