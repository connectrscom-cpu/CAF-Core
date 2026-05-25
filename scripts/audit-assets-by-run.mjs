import pg from "pg";
import { config as loadEnv } from "dotenv";

loadEnv();

const confirm = process.argv.includes("--delete");
const projectSlug = process.argv.find((a) => a.startsWith("--project="))?.slice("--project=".length);

const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  const summary = await db.query(
    `SELECT p.slug, COALESCE(cj.run_id, '(orphan)') AS run_id, COUNT(*)::int AS asset_count
     FROM caf_core.assets a
     JOIN caf_core.projects p ON p.id = a.project_id
     LEFT JOIN caf_core.content_jobs cj ON cj.project_id = a.project_id AND cj.task_id = a.task_id
     WHERE ($1::text IS NULL OR p.slug = $1)
     GROUP BY p.slug, COALESCE(cj.run_id, '(orphan)')
     ORDER BY p.slug, run_id`,
    [projectSlug ?? null]
  );

  console.log("Assets by project/run:");
  let total = 0;
  for (const r of summary.rows) {
    console.log(`  ${r.slug}\t${r.run_id}\t${r.asset_count}`);
    total += r.asset_count;
  }
  console.log(`\nTotal matching assets: ${total}`);

  if (!confirm) {
    console.log("\nDry run only. Pass --delete to remove these asset rows (jobs are kept).");
    process.exit(0);
  }

  const del = await db.query(
    `DELETE FROM caf_core.assets a
     WHERE ($1::text IS NULL OR a.project_id = (SELECT id FROM caf_core.projects WHERE slug = $1 LIMIT 1))`,
    [projectSlug ?? null]
  );
  console.log(`\nDeleted ${del.rowCount} asset row(s) from caf_core.assets.`);
} finally {
  await db.end();
}
