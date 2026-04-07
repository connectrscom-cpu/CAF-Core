/**
 * Upsert canonical allowed_flow_types (Flow Engine names: Flow_Carousel_Copy + 3 video generators) for a project.
 * Default target is Demo SNS (slug SNS). Creates the project row if missing.
 *
 * Usage: DATABASE_URL=... npm run seed:canonical-flows
 *        PROJECT_SLUG=mybrand npm run seed:canonical-flows
 *
 * Merge-only (default): upserts carousel + Video_Scene_Generator + Video_Script_Generator + Video_Prompt_Generator.
 * Full replace: CAF_RESET_ALLOWED_FLOWS=1 deletes all allowed flows for the project, then seeds canonical 4.
 */
import pg from "pg";
import "dotenv/config";
import {
  deleteAllAllowedFlowTypesForProject,
  seedCanonicalAllowedFlowTypes,
} from "../repositories/project-config.js";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const slug = process.env.PROJECT_SLUG ?? process.env.SEED_PROJECT_SLUG ?? "SNS";
  const displayName =
    process.env.SEED_PROJECT_NAME ?? (slug.toUpperCase() === "SNS" ? "Demo SNS" : slug);
  const pool = new pg.Pool({ connectionString: url });
  try {
    let r = await pool.query(`SELECT id FROM caf_core.projects WHERE slug = $1`, [slug]);
    let projectId: string;
    if (r.rows[0]) {
      projectId = r.rows[0].id as string;
    } else {
      const ins = await pool.query(
        `INSERT INTO caf_core.projects (slug, display_name) VALUES ($1, $2) RETURNING id`,
        [slug, displayName]
      );
      projectId = ins.rows[0].id as string;
      console.log("Created project:", slug, "(" + displayName + ")");
    }
    const reset = String(process.env.CAF_RESET_ALLOWED_FLOWS ?? process.env.RESET_ALLOWED_FLOWS ?? "")
      .toLowerCase()
      .match(/^(1|true|yes)$/);
    if (reset) {
      await deleteAllAllowedFlowTypesForProject(pool, projectId);
      console.log("Cleared allowed_flow_types for", slug, "(CAF_RESET_ALLOWED_FLOWS)");
    }
    await seedCanonicalAllowedFlowTypes(pool, projectId);
    console.log(
      reset
        ? "Canonical allowed flows replaced for " + slug + " (" + displayName + ")"
        : "Canonical allowed flows upserted for " + slug + " (" + displayName + ")"
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
