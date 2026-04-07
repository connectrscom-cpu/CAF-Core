/**
 * Delete all jobs for a run, reset to CREATED, and run the decision engine again (current caps apply).
 *
 * Usage:
 *   npm run replan-run -- <run_uuid | run_id> [--project SNS]
 */
import "dotenv/config";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { ensureProject } from "../repositories/core.js";
import { getRunById, getRunByRunId } from "../repositories/runs.js";
import { replanRun } from "../services/run-orchestrator.js";

function parseArgs() {
  const raw = process.argv.slice(2);
  let projectSlug = process.env.PROJECT_SLUG ?? "SNS";
  const pi = raw.indexOf("--project");
  if (pi >= 0 && raw[pi + 1]) {
    projectSlug = raw[pi + 1];
    raw.splice(pi, 2);
  }
  const runRef = raw.filter((a) => !a.startsWith("-"))[0];
  return { runRef, projectSlug };
}

const UUID_RE = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

function looksLikeRunUuid(ref: string): boolean {
  return UUID_RE.test(ref.trim());
}

async function main() {
  const { runRef, projectSlug } = parseArgs();
  if (!runRef) {
    console.error("Usage: replan-run <run_uuid | run_id> [--project SNS]");
    process.exit(1);
  }

  const config = loadConfig();
  const pool = createPool(config);

  try {
    let run = looksLikeRunUuid(runRef) ? await getRunById(pool, runRef) : null;
    if (!run) {
      const project = await ensureProject(pool, projectSlug);
      run = await getRunByRunId(pool, project.id, runRef);
    }
    if (!run) {
      console.error("Run not found:", runRef);
      process.exit(1);
    }

    console.log("Re-planning run", run.run_id, "uuid:", run.id);
    const out = await replanRun(pool, config, run.id);
    console.log(JSON.stringify(out, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
