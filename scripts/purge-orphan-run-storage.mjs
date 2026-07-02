/**
 * Delete Supabase Storage render output for run folders that no longer exist in caf_core.runs.
 *
 * Dry run:  node scripts/purge-orphan-run-storage.mjs
 * Delete:   node scripts/purge-orphan-run-storage.mjs --delete
 * Project:  node scripts/purge-orphan-run-storage.mjs --project=SNS
 *
 * Keeps top_performer_inspection, evidence_media, brand-kit, mimic_backgrounds (not scanned).
 */
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { config as loadEnv } from "dotenv";

loadEnv();

const confirm = process.argv.includes("--delete");
const projectSlug = process.argv.find((a) => a.startsWith("--project="))?.slice("--project=".length) ?? null;

const bucket = (process.env.SUPABASE_ASSETS_BUCKET || "assets").trim();
const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const databaseUrl = process.env.DATABASE_URL?.trim();

const RENDER_PREFIXES = [
  "carousels",
  "videos",
  "scenes",
  "audios",
  "audios_muxed",
  "videos_edit",
  "subtitles",
];

if (!url || !key) {
  console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  process.exit(1);
}
if (!databaseUrl) {
  console.error("DATABASE_URL is required.");
  process.exit(1);
}

const client = createClient(url, key, { auth: { persistSession: false } });
const db = new pg.Pool({ connectionString: databaseUrl });

function assetObjectKeyInBucket(b, relativePath) {
  const root = (b || "assets").trim() || "assets";
  let p = relativePath.replace(/^\/+/, "").trim();
  if (!p) return `${root}/unnamed`;
  if (p.startsWith(`${root}/`)) return p;
  return `${root}/${p}`;
}

async function listFolderEntries(folderKey) {
  const { data, error } = await client.storage.from(bucket).list(folderKey, { limit: 1000 });
  if (error) {
    if (/not found/i.test(error.message)) return [];
    throw new Error(`list ${folderKey}: ${error.message}`);
  }
  return data ?? [];
}

async function collectFilesRecursive(folderKey) {
  const files = [];
  const entries = await listFolderEntries(folderKey);
  for (const item of entries) {
    const childKey = `${folderKey}/${item.name}`;
    if (item.metadata) {
      files.push(childKey);
      continue;
    }
    files.push(...(await collectFilesRecursive(childKey)));
  }
  return files;
}

async function deleteInChunks(paths) {
  const chunkSize = 200;
  let deleted = 0;
  for (let i = 0; i < paths.length; i += chunkSize) {
    const slice = paths.slice(i, i + chunkSize);
    const { error } = await client.storage.from(bucket).remove(slice);
    if (error) throw new Error(`remove failed: ${error.message}`);
    deleted += slice.length;
  }
  return deleted;
}

async function loadKnownRunIds() {
  const params = projectSlug ? [projectSlug] : [];
  const filter = projectSlug ? "WHERE p.slug = $1" : "";
  const { rows } = await db.query(
    `SELECT DISTINCT r.run_id
     FROM caf_core.runs r
     JOIN caf_core.projects p ON p.id = r.project_id
     ${filter}`,
    params
  );
  const known = new Set(rows.map((r) => r.run_id));
  return known;
}

try {
  const knownRunIds = await loadKnownRunIds();
  console.log(`Bucket: ${bucket}`);
  console.log(`Known run_id(s) in caf_core.runs${projectSlug ? ` (${projectSlug})` : ""}: ${knownRunIds.size}`);
  if (knownRunIds.size > 0 && knownRunIds.size <= 30) {
    console.log([...knownRunIds].sort().join(", "));
  }
  console.log("Rendered prefixes:", RENDER_PREFIXES.join(", "));
  console.log("");

  let orphanFiles = 0;
  let keptFiles = 0;
  const pathsToDelete = [];

  for (const prefix of RENDER_PREFIXES) {
    const rootKey = assetObjectKeyInBucket(bucket, prefix);
    const runFolders = await listFolderEntries(rootKey);
    let prefixOrphan = 0;
    let prefixKept = 0;
    const orphanRuns = [];
    const keptRuns = [];

    for (const run of runFolders) {
      if (run.metadata) continue;
      const runKey = `${rootKey}/${run.name}`;
      const files = await collectFilesRecursive(runKey);
      if (files.length === 0) continue;

      if (knownRunIds.has(run.name)) {
        prefixKept += files.length;
        keptRuns.push({ run_id: run.name, files: files.length });
      } else {
        prefixOrphan += files.length;
        orphanRuns.push({ run_id: run.name, files: files.length });
        if (confirm) pathsToDelete.push(...files);
      }
    }

    orphanFiles += prefixOrphan;
    keptFiles += prefixKept;
    console.log(`${prefix}: ${prefixOrphan} orphan file(s), ${prefixKept} kept (active run)`);
    for (const r of orphanRuns.sort((a, b) => a.run_id.localeCompare(b.run_id))) {
      console.log(`  ORPHAN ${r.run_id}\t${r.files}`);
    }
    for (const r of keptRuns.sort((a, b) => a.run_id.localeCompare(b.run_id))) {
      console.log(`  keep   ${r.run_id}\t${r.files}`);
    }
  }

  console.log(`\nTotal: ${orphanFiles} orphan file(s) to remove, ${keptFiles} kept for existing runs.`);

  if (!confirm) {
    console.log("\nDry run only. Pass --delete to remove orphan objects from Supabase Storage.");
    process.exit(0);
  }

  if (pathsToDelete.length === 0) {
    console.log("\nNothing to delete.");
    process.exit(0);
  }

  const deleted = await deleteInChunks(pathsToDelete);
  console.log(`\nDeleted ${deleted} orphan object(s) from Supabase Storage.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
} finally {
  await db.end();
}
