/**
 * Import a CAF project from a local onboarding pack (markdown / plain text).
 *
 * Usage:
 *   DATABASE_URL=... npm run import:onboarding-pack -- --file src/data/vaultlm-onboarding-pack.md
 *   DATABASE_URL=... npm run import:onboarding-pack -- --file pack.md --slug VAULTLM --dry-run
 *
 * Flags:
 *   --file <path>     Required (unless --template). Pack file to import.
 *   --slug <slug>     Optional. Overrides / supplies the project slug.
 *   --dry-run         Optional. Parse + validate only; no DB writes.
 *   --display-name    Optional. Default display name when creating a new project.
 *   --template        Print the sample pack template to stdout and exit (no DB connection).
 */
import pg from "pg";
import "dotenv/config";
import { readFile } from "node:fs/promises";
import { importProjectFromOnboardingPack } from "../services/onboarding-pack-import.js";
import { ONBOARDING_PACK_TEMPLATE } from "../services/onboarding-pack-parser.js";

interface Args {
  file?: string;
  slug?: string;
  displayName?: string;
  dryRun: boolean;
  template: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { dryRun: false, template: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" || a === "-f") out.file = argv[++i];
    else if (a === "--slug" || a === "-s") out.slug = argv[++i];
    else if (a === "--display-name") out.displayName = argv[++i];
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--template") out.template = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function printHelp() {
  console.log(
    [
      "Usage: npm run import:onboarding-pack -- --file <path> [--slug <slug>] [--dry-run]",
      "",
      "Flags:",
      "  --file <path>       Onboarding pack .md/.txt to import (required unless --template)",
      "  --slug <slug>       Override / supply the project slug",
      "  --display-name <s>  Default display name for new projects",
      "  --dry-run           Parse + validate only; no DB writes",
      "  --template          Print the pack template to stdout and exit",
      "  --help              Show this message",
    ].join("\n")
  );
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }
  if (args.template) {
    process.stdout.write(ONBOARDING_PACK_TEMPLATE);
    return;
  }
  if (!args.file) {
    console.error("Error: --file is required (or pass --template / --help).\n");
    printHelp();
    process.exit(2);
  }

  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const packText = await readFile(args.file, "utf8");
  const pool = new pg.Pool({ connectionString: url });
  try {
    const result = await importProjectFromOnboardingPack(pool, packText, {
      slug_override: args.slug ?? null,
      default_display_name: args.displayName ?? null,
      dry_run: args.dryRun,
    });

    if (result.gaps.length > 0) {
      console.log(`gaps (${result.gaps.length}):`);
      for (const g of result.gaps.slice(0, 12)) console.log(`  - ${g}`);
      if (result.gaps.length > 12) console.log(`  ... and ${result.gaps.length - 12} more`);
    }
    if (result.warnings.length > 0) {
      for (const w of result.warnings) console.warn(`warn: ${w}`);
    }
    if (result.errors.length > 0) {
      for (const e of result.errors) console.error(`error: ${e}`);
    }

    console.log("");
    console.log(result.dry_run ? "Dry run — no changes written." : "Import complete.");
    if (result.project) {
      console.log(`  project: ${result.project.slug} (${result.project.id})`);
    }
    console.log("  applied:");
    const sections = Object.keys(result.applied).sort();
    if (sections.length === 0) {
      console.log("    (nothing)");
    } else {
      for (const s of sections) {
        console.log(`    ${s}: ${result.applied[s]}`);
      }
    }

    if (!result.ok) process.exit(1);
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
