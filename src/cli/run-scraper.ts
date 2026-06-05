/**
 * Run INPUTS scrapers (Apify / HTML) into inputs_evidence_imports.
 *
 * Usage:
 *   npm run run-scraper -- SNS html
 *   npm run run-scraper -- SNS all
 *   npm run run-scraper -- --project SNS instagram
 */
import "dotenv/config";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { ensureProject } from "../repositories/core.js";
import { runInputsScraper, SCRAPER_KEYS, type ScraperKey } from "../services/inputs-scraper-orchestrator.js";

function parseArgs(): { projectSlug: string; scraper: ScraperKey; maxSources: number | null } {
  const raw = process.argv.slice(2);
  let projectSlug = process.env.PROJECT_SLUG ?? "SNS";
  let maxSources: number | null = null;
  const pi = raw.indexOf("--project");
  if (pi >= 0 && raw[pi + 1]) {
    projectSlug = raw[pi + 1]!;
    raw.splice(pi, 2);
  }
  const mi = raw.indexOf("--max-sources");
  if (mi >= 0 && raw[mi + 1]) {
    const n = parseInt(raw[mi + 1]!, 10);
    if (Number.isFinite(n) && n > 0) maxSources = n;
    raw.splice(mi, 2);
  }
  const positional = raw.filter((a) => !a.startsWith("-"));
  if (positional.length >= 2) {
    return { projectSlug: positional[0]!, scraper: positional[1]! as ScraperKey, maxSources };
  }
  if (positional.length === 1) {
    return { projectSlug, scraper: positional[0]! as ScraperKey, maxSources };
  }
  return { projectSlug, scraper: "all", maxSources };
}

async function main() {
  const { projectSlug, scraper, maxSources } = parseArgs();
  if (!SCRAPER_KEYS.includes(scraper)) {
    console.error(`Invalid scraper "${scraper}". Use one of: ${SCRAPER_KEYS.join(", ")}`);
    process.exit(1);
  }

  const config = loadConfig();
  const db = createPool(config);

  try {
    const project = await ensureProject(db, projectSlug);
    console.log(`Running scraper "${scraper}" for project ${projectSlug} (${project.id})…`);
    const result = await runInputsScraper(db, config, project.id, scraper, { maxSources });
    console.log(JSON.stringify({ ok: true, project_slug: projectSlug, ...result }, null, 2));
  } finally {
    await db.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
