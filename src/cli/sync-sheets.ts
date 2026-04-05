import "dotenv/config";
import pg from "pg";
import { syncRuntimeSheet, syncReviewQueueSheet } from "../adapters/sheets/index.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("DATABASE_URL required"); process.exit(1); }

const SPREADSHEET_ID = process.env.GOOGLE_REVIEW_QUEUE_SPREADSHEET_ID;
if (!SPREADSHEET_ID) { console.error("GOOGLE_REVIEW_QUEUE_SPREADSHEET_ID required"); process.exit(1); }

const PROJECT_SLUG = process.env.PROJECT_SLUG ?? "SNS";
const RUNTIME_TAB = process.env.GOOGLE_RUNTIME_SHEET_NAME ?? "Runtime";
const REVIEW_TAB = process.env.GOOGLE_REVIEW_QUEUE_SHEET_NAME ?? "Review Queue";

async function main() {
  const pool = new pg.Pool({ connectionString: DATABASE_URL });
  const mode = process.argv[2] ?? "both";

  try {
    if (mode === "runtime" || mode === "both") {
      console.log(`Syncing Runtime tab from sheet ${SPREADSHEET_ID} → caf_core...`);
      const result = await syncRuntimeSheet(pool, {
        spreadsheetId: SPREADSHEET_ID!,
        tabName: RUNTIME_TAB,
        projectSlug: PROJECT_SLUG,
      });
      console.log(`  Runtime: ${result.upserted} upserted, ${result.skipped} skipped (${result.total} rows)`);
    }

    if (mode === "review" || mode === "both") {
      console.log(`Syncing Review Queue tab from sheet ${SPREADSHEET_ID} → caf_core...`);
      const result = await syncReviewQueueSheet(pool, {
        spreadsheetId: SPREADSHEET_ID!,
        tabName: REVIEW_TAB,
        projectSlug: PROJECT_SLUG,
      });
      console.log(`  Reviews: ${result.synced} synced, ${result.skipped} skipped (${result.total} rows)`);
    }

    console.log("Done.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
