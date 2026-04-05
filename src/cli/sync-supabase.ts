import "dotenv/config";
import pg from "pg";
import { syncTasksFromSupabase, syncAssetsFromSupabase } from "../adapters/supabase/index.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required"); process.exit(1); }

const PROJECT_SLUG = process.env.PROJECT_SLUG ?? "SNS";
const SINCE_HOURS = parseInt(process.env.SYNC_SINCE_HOURS ?? "72", 10);

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const mode = process.argv[2] ?? "both";

  try {
    if (mode === "tasks" || mode === "both") {
      console.log(`Syncing Supabase tasks → caf_core (last ${SINCE_HOURS}h)...`);
      const result = await syncTasksFromSupabase(pool, {
        supabaseUrl: SUPABASE_URL!,
        supabaseKey: SUPABASE_KEY!,
        projectSlug: PROJECT_SLUG,
        sinceHoursAgo: SINCE_HOURS,
      });
      console.log(`  Tasks: ${result.upserted} upserted, ${result.skipped} skipped (${result.total} total)`);
    }

    if (mode === "assets" || mode === "both") {
      console.log(`Syncing Supabase assets → caf_core (last ${SINCE_HOURS}h)...`);
      const result = await syncAssetsFromSupabase(pool, {
        supabaseUrl: SUPABASE_URL!,
        supabaseKey: SUPABASE_KEY!,
        projectSlug: PROJECT_SLUG,
        sinceHoursAgo: SINCE_HOURS,
      });
      console.log(`  Assets: ${result.upserted} upserted, ${result.skipped} skipped (${result.total} total)`);
    }

    console.log("Done.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
