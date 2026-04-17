/**
 * Apply pending SQL migrations (same ledger as `npm run migrate`).
 * Uses a Postgres advisory lock so concurrent deploys / multiple machines do not race.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool, PoolClient } from "pg";

const ADVISORY_LOCK_KEY1 = 20260216;
const ADVISORY_LOCK_KEY2 = 170001;

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function defaultMigrationsDir(): string {
  return path.join(__dirname, "..", "..", "migrations");
}

async function ensureMigrationLedger(client: PoolClient): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS caf_core`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS caf_core.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function isApplied(client: PoolClient, filename: string): Promise<boolean> {
  const r = await client.query(`SELECT 1 FROM caf_core.schema_migrations WHERE filename = $1`, [filename]);
  return r.rowCount !== null && r.rowCount > 0;
}

export interface RunPendingMigrationsOpts {
  /** Defaults to repo /app `migrations` (Docker + local). */
  migrationsDir?: string;
  log?: (line: string) => void;
}

export async function runPendingMigrations(pool: Pool, opts?: RunPendingMigrationsOpts): Promise<void> {
  const log = opts?.log ?? ((line: string) => console.log(line));
  const dir = opts?.migrationsDir ?? defaultMigrationsDir();

  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1, $2)", [ADVISORY_LOCK_KEY1, ADVISORY_LOCK_KEY2]);
    try {
      await ensureMigrationLedger(client);

      const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
      if (files.length === 0) {
        log(`No migrations found in ${dir}`);
        return;
      }

      for (const file of files) {
        if (await isApplied(client, file)) {
          log(`Skip (already applied): ${file}`);
          continue;
        }
        const full = path.join(dir, file);
        const sql = await readFile(full, "utf8");
        log(`Applying ${file} ...`);
        await client.query("BEGIN");
        try {
          await client.query(sql);
          await client.query(`INSERT INTO caf_core.schema_migrations (filename) VALUES ($1)`, [file]);
          await client.query("COMMIT");
          log(`Applied: ${file}`);
        } catch (e) {
          await client.query("ROLLBACK");
          throw e;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1, $2)", [ADVISORY_LOCK_KEY1, ADVISORY_LOCK_KEY2]);
    }
  } finally {
    client.release();
  }
}
