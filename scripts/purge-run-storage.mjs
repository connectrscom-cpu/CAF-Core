/**
 * List or delete rendered output under Supabase Storage run folders.
 *
 * Dry run:  node scripts/purge-run-storage.mjs
 * Delete:   node scripts/purge-run-storage.mjs --delete
 *
 * Keeps top_performer_inspection, evidence_media, brand-kit, mimic_backgrounds.
 */
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv();

const confirm = process.argv.includes("--delete");
const bucket = (process.env.SUPABASE_ASSETS_BUCKET || "assets").trim();
const url = process.env.SUPABASE_URL?.trim();
const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

/** Rendered job output — not reference/archive inputs. */
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

const client = createClient(url, key, { auth: { persistSession: false } });

function inBucketRoot(prefix) {
  return `${bucket}/${prefix.replace(/^\/+/, "")}`;
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

async function summarizePrefix(prefix) {
  const rootKey = inBucketRoot(prefix);
  const runFolders = await listFolderEntries(rootKey);
  let fileCount = 0;
  const runs = [];
  for (const run of runFolders) {
    if (run.metadata) continue;
    const runKey = `${rootKey}/${run.name}`;
    const files = await collectFilesRecursive(runKey);
    if (files.length > 0) {
      runs.push({ run_id: run.name, files: files.length });
      fileCount += files.length;
    }
  }
  return { prefix, rootKey, runs, fileCount };
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

try {
  let totalFiles = 0;
  const allPaths = [];

  console.log(`Bucket: ${bucket}`);
  console.log("Rendered prefixes:", RENDER_PREFIXES.join(", "));
  console.log("");

  for (const prefix of RENDER_PREFIXES) {
    const summary = await summarizePrefix(prefix);
    totalFiles += summary.fileCount;
    console.log(`${prefix}: ${summary.fileCount} file(s) across ${summary.runs.length} run folder(s)`);
    for (const r of summary.runs.sort((a, b) => a.run_id.localeCompare(b.run_id))) {
      console.log(`  ${r.run_id}\t${r.files}`);
    }
    if (confirm) {
      for (const run of summary.runs) {
        const runKey = `${summary.rootKey}/${run.run_id}`;
        allPaths.push(...(await collectFilesRecursive(runKey)));
      }
    }
  }

  console.log(`\nTotal rendered files: ${totalFiles}`);

  if (!confirm) {
    console.log("\nDry run only. Pass --delete to remove these objects from Supabase Storage.");
    process.exit(0);
  }

  if (allPaths.length === 0) {
    console.log("\nNothing to delete.");
    process.exit(0);
  }

  const deleted = await deleteInChunks(allPaths);
  console.log(`\nDeleted ${deleted} object(s) from Supabase Storage.`);
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
}
