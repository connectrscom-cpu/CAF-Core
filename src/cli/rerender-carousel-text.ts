/**
 * Recomposite carousel / mimic text on stored background plates — no Flux/Qwen/BFL.
 *
 * Usage:
 *   npm run rerender-carousel-text -- --task-id SNS_2026W09__Instagram__... --project SNS
 *   npm run rerender-carousel-text -- --task-id ... --project SNS --slides 1,2,3
 */
import "dotenv/config";
import { loadConfig } from "../config.js";
import { createPool } from "../db/pool.js";
import { ensureProject } from "../repositories/core.js";
import { getContentJobByTaskId } from "../repositories/jobs.js";
import { rerenderCarouselTextOverlay } from "../services/job-pipeline.js";

function usage(): string {
  return `Reprint carousel text overlay (Puppeteer only — reuses MIMIC_BACKGROUND / MIMIC_VISUAL_PLATE)

Options:
  --task-id <id>     content_jobs.task_id (required)
  --project <slug>   Project slug (default: SNS or PROJECT_SLUG env)
  --slides <list>    Comma-separated 1-based slide indices (default: all slides)
  --help`;
}

function parseArgs(argv: string[]) {
  let projectSlug = process.env.PROJECT_SLUG ?? "SNS";
  let taskId = "";
  let slides: number[] | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") return { help: true as const, projectSlug, taskId, slides };
    if (a === "--project" && argv[i + 1]) {
      projectSlug = argv[++i]!;
      continue;
    }
    if (a === "--task-id" && argv[i + 1]) {
      taskId = argv[++i]!.trim();
      continue;
    }
    if (a === "--slides" && argv[i + 1]) {
      slides = argv[++i]!
        .split(/[,\s]+/)
        .map((s) => parseInt(s.trim(), 10))
        .filter((n) => Number.isFinite(n) && n >= 1);
      continue;
    }
  }

  return { help: false as const, projectSlug, taskId, slides };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.taskId) {
    console.log(usage());
    process.exit(args.taskId ? 0 : 1);
  }

  const config = loadConfig();
  const pool = createPool(config);

  try {
    const project = await ensureProject(pool, args.projectSlug);
    const job = await getContentJobByTaskId(pool, project.id, args.taskId);
    if (!job) {
      console.error(`Job not found: ${args.taskId} (project ${args.projectSlug})`);
      process.exit(1);
    }

    console.log(
      `Reprinting text overlay for ${job.task_id} (${job.flow_type})` +
        (args.slides?.length ? ` slides ${args.slides.join(",")}` : " — all slides") +
        " — Flux/Qwen skipped"
    );

    await rerenderCarouselTextOverlay(pool, config, String(job.id), args.slides);
    console.log("Done. New CAROUSEL_SLIDE PNGs are in assets for this task.");
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
