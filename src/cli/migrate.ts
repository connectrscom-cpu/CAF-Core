/**
 * Run SQL migrations in migrations/*.sql order (filenames sorted).
 * Each file runs at most once (recorded in caf_core.schema_migrations).
 * Usage: DATABASE_URL=... npm run migrate
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import "dotenv/config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function ensureMigrationLedger(client: pg.PoolClient): Promise<void> {
  await client.query(`CREATE SCHEMA IF NOT EXISTS caf_core`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS caf_core.schema_migrations (
      filename text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

async function isApplied(client: pg.PoolClient, filename: string): Promise<boolean> {
  const r = await client.query(`SELECT 1 FROM caf_core.schema_migrations WHERE filename = $1`, [filename]);
  return r.rowCount !== null && r.rowCount > 0;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const dir = path.join(__dirname, "..", "..", "migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  if (files.length === 0) {
    console.error("No migrations found in", dir);
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    await ensureMigrationLedger(client);

    for (const file of files) {
      if (await isApplied(client, file)) {
        console.log("Skip (already applied):", file);
        continue;
      }
      const full = path.join(dir, file);
      const sql = await readFile(full, "utf8");
      console.log("Applying", file, "...");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(`INSERT INTO caf_core.schema_migrations (filename) VALUES ($1)`, [file]);
        await client.query("COMMIT");
        console.log("Applied:", file);
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      }
    }
    console.log("Migrations finished.");
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
