/**
 * Process all jobs for a run through the pipeline (PLANNED/GENERATING → … → IN_REVIEW in caf_core).
 * Review queue is Postgres `caf_core.content_jobs`; optional Supabase asset URLs. Not Google Sheets.
 *
 * Usage:
 *   npm run process-run -- <run_uuid>
 *   npm run process-run -- RUN_20260406_ABC --project SNS
 */
import "dotenv/config";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { ensureProject } from "../repositories/core.js";
import { getRunById, getRunByRunId } from "../repositories/runs.js";
import { processRunJobs } from "../services/job-pipeline.js";

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
    console.error("Usage: process-run <run_uuid | run_id> [--project SNS]");
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

    console.log("Processing run", run.run_id, "uuid:", run.id);
    const proc = await processRunJobs(pool, config, run.id);
    console.log(JSON.stringify(proc, null, 2));
    if (proc.errors.length) {
      console.error("Errors:", proc.errors.length, "job(s); see JSON above");
      process.exit(proc.processed > 0 ? 0 : 1);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
