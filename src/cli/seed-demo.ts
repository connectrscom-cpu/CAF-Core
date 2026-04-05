/**
 * Seed a demo project (SNS), constraints, and one active prompt version.
 * DATABASE_URL required. Run after migrate: npm run seed:demo
 */
import pg from "pg";
import "dotenv/config";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const slug = process.env.SEED_PROJECT_SLUG ?? "SNS";
    const name = process.env.SEED_PROJECT_NAME ?? "Demo SNS";

    const p = await client.query(
      `INSERT INTO caf_core.projects (slug, display_name) VALUES ($1, $2)
       ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name
       RETURNING id`,
      [slug, name]
    );
    const projectId = p.rows[0].id as string;

    await client.query(
      `INSERT INTO caf_core.project_system_constraints
        (project_id, max_daily_jobs, min_score_to_generate, max_active_prompt_versions, default_variation_cap, auto_validation_pass_threshold)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (project_id) DO UPDATE SET
         max_daily_jobs = EXCLUDED.max_daily_jobs,
         min_score_to_generate = EXCLUDED.min_score_to_generate,
         max_active_prompt_versions = EXCLUDED.max_active_prompt_versions,
         default_variation_cap = EXCLUDED.default_variation_cap,
         auto_validation_pass_threshold = EXCLUDED.auto_validation_pass_threshold,
         updated_at = now()`,
      [projectId, 200, 0.35, 5, 2, 0.72]
    );

    await client.query(
      `INSERT INTO caf_core.prompt_versions
        (project_id, flow_type, prompt_id, version, status, temperature, max_tokens, metadata_json)
       VALUES ($1, 'FLOW_CAROUSEL', 'carousel_seed', '1.0.0', 'active', 0.7, 2000, '{}')
       ON CONFLICT (project_id, flow_type, prompt_id, version) DO UPDATE SET status = 'active'`,
      [projectId]
    );

    console.log("Seed OK — project:", slug, "id:", projectId);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
