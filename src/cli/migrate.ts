/**
 * Run SQL migrations in migrations/*.sql order (filenames sorted).
 * Each file runs at most once (recorded in caf_core.schema_migrations).
 * Usage: DATABASE_URL=... npm run migrate
 */
import pg from "pg";
import "dotenv/config";
import { runPendingMigrations } from "../db/run-migrations.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  try {
    await runPendingMigrations(pool, { log: console.log });
    console.log("Migrations finished.");
  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
