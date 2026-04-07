/**
 * Ingest an SNS Insights .xlsx, insert signal_pack + run, start the run (plan + content_jobs),
 * then by default runs the job pipeline (LLM → QC → carousel render / HeyGen video → IN_REVIEW).
 *
 * Review queue = caf_core.content_jobs (via CAF Core API / Review app). No Google Sheets involved.
 * Assets upload to Supabase when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
 *
 * Usage:
 *   npm run start-run:xlsx -- "C:\path\file.xlsx" --project SNS
 *   npm run start-run:xlsx -- file.xlsx --no-process   # plan jobs only, skip render pipeline
 *
 * Env: DATABASE_URL (required). RENDERER_BASE_URL, VIDEO_ASSEMBLY_BASE_URL for media. PROJECT_SLUG default SNS.
 */
import { readFileSync, existsSync } from "node:fs";
import "dotenv/config";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { ensureProject } from "../repositories/core.js";
import { insertSignalPack } from "../repositories/signal-packs.js";
import { createRun } from "../repositories/runs.js";
import { parseSignalPackExcel } from "../services/signal-pack-parser.js";
import { startRun } from "../services/run-orchestrator.js";
import { processRunJobs } from "../services/job-pipeline.js";

function parseArgs() {
  const raw = process.argv.slice(2);
  let projectSlug = process.env.PROJECT_SLUG ?? "SNS";
  const pi = raw.indexOf("--project");
  if (pi >= 0 && raw[pi + 1]) {
    projectSlug = raw[pi + 1];
    raw.splice(pi, 2);
  }
  const skipProcess = raw.includes("--no-process");
  const rest = raw.filter((a) => a !== "--no-process");
  const xlsxPath = process.env.SIGNAL_PACK_XLSX ?? process.env.XLSX_PATH ?? rest[0];
  return { xlsxPath, projectSlug, alsoProcess: !skipProcess };
}

async function main() {
  const { xlsxPath, projectSlug, alsoProcess } = parseArgs();
  if (!xlsxPath) {
    console.error(
      "Usage: start-run-from-xlsx <path-to.xlsx> [--project SNS] [--process]\n" +
        "   or: SIGNAL_PACK_XLSX=path npm run start-run:xlsx"
    );
    process.exit(1);
  }
  if (!existsSync(xlsxPath)) {
    console.error("File not found:", xlsxPath);
    process.exit(1);
  }

  const config = loadConfig();
  const pool = createPool(config);
  const fileName = xlsxPath.replace(/^.*[/\\]/, "") || "upload.xlsx";

  try {
    const buffer = readFileSync(xlsxPath);
    const parsed = parseSignalPackExcel(buffer);
    const { sheets_ingested, used_published_signal_pack_row, ...packForDb } = parsed;
    const overall = Array.isArray(parsed.overall_candidates_json)
      ? parsed.overall_candidates_json
      : [];

    const project = await ensureProject(pool, projectSlug);
    const runId = `RUN_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}_${Date.now().toString(36).toUpperCase()}`;

    const pack = await insertSignalPack(pool, {
      run_id: runId,
      project_id: project.id,
      upload_filename: fileName,
      notes: "start-run-from-xlsx CLI",
      ...packForDb,
      overall_candidates_json: overall,
    });

    const run = await createRun(pool, {
      run_id: runId,
      project_id: project.id,
      signal_pack_id: pack.id,
      metadata_json: {
        upload_filename: fileName,
        total_candidates: overall.length,
        derived_globals: parsed.derived_globals_json,
        sheets_ingested,
        source: "start-run-from-xlsx",
        used_published_signal_pack_row: used_published_signal_pack_row ?? false,
      },
    });

    console.log("Created signal_pack_id:", pack.id);
    console.log("Run:", run.run_id, "uuid:", run.id);
    console.log("Overall candidates rows:", overall.length);

    const startResult = await startRun(pool, config, run.id);
    console.log("Start result:", JSON.stringify(startResult, null, 2));

    if (alsoProcess && startResult.planned_jobs > 0) {
      console.log("Running job pipeline (LLM, render, → IN_REVIEW in caf_core; assets → Supabase if configured)…");
      const proc = await processRunJobs(pool, config, run.id);
      console.log("Process result:", JSON.stringify(proc, null, 2));
    } else if (alsoProcess) {
      console.log("Pipeline skipped: no planned jobs");
    } else {
      console.log("Skipped pipeline (--no-process). Run: npm run process-run --", run.id, "--project", projectSlug);
    }
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
