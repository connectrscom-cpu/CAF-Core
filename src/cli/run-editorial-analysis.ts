/**
 * Run editorial analysis for one or more projects (CLI / Fly cron / CI).
 *
 * Usage:
 *   DATABASE_URL=... OPENAI_API_KEY=... node dist/cli/run-editorial-analysis.js
 *   node dist/cli/run-editorial-analysis.js SNS
 *   node dist/cli/run-editorial-analysis.js SNS,Cuisina
 *
 * Honors EDITORIAL_ANALYSIS_CRON_PROJECT_SLUGS and EDITORIAL_ANALYSIS_CRON_WINDOW_DAYS from env when no argv slugs.
 */
import "dotenv/config";
import pg from "pg";
import { loadConfig } from "../config.js";
import { runEditorialAnalysisForCronProjects } from "../services/editorial-analysis-cron.js";

const log = {
  info: (o: object, msg?: string) => console.log(msg ?? "info", JSON.stringify(o)),
  warn: (o: object, msg?: string) => console.warn(msg ?? "warn", JSON.stringify(o)),
  error: (o: object, msg?: string) => console.error(msg ?? "error", JSON.stringify(o)),
};

async function main() {
  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL });

  const arg = process.argv[2]?.trim();
  const slugs = arg
    ? arg
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : undefined;

  try {
    await runEditorialAnalysisForCronProjects(pool, config, log, {
      windowDays: config.EDITORIAL_ANALYSIS_CRON_WINDOW_DAYS,
      slugs,
    });
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
