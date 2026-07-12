/**
 * Seed / refresh Cuisina product profile on an existing project.
 *
 * Usage:
 *   DATABASE_URL=... npm run seed:cuisina-product
 *   DATABASE_URL=... npm run seed:cuisina-product -- --dry-run
 *   DATABASE_URL=... npm run seed:cuisina-product -- --project CUISINA
 */
import pg from "pg";
import { config as loadDotenv } from "dotenv";
import { CUISINA_PRODUCT, CUISINA_PROJECT_SLUG } from "../data/cuisina-product-canonical.js";
import { getProductProfile, upsertProductProfile } from "../repositories/project-config.js";

loadDotenv({ override: true });

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }
  const dryRun = hasFlag("--dry-run");
  const slug =
    (process.argv.includes("--project") ? process.argv[process.argv.indexOf("--project") + 1] : CUISINA_PROJECT_SLUG)?.trim() ||
    CUISINA_PROJECT_SLUG;

  const pool = new pg.Pool({ connectionString: url });
  try {
    const proj = await pool.query(`SELECT id::text, slug, display_name FROM caf_core.projects WHERE slug = $1`, [slug]);
    const projectId = proj.rows[0]?.id as string | undefined;
    if (!projectId) {
      console.error(`Project not found: ${slug}`);
      process.exit(1);
    }

    const existing = await getProductProfile(pool, projectId);
    const existingMeta =
      existing?.metadata_json && typeof existing.metadata_json === "object" && !Array.isArray(existing.metadata_json)
        ? (existing.metadata_json as Record<string, unknown>)
        : {};

    const payload = {
      ...CUISINA_PRODUCT,
      metadata_json: {
        ...existingMeta,
        ...CUISINA_PRODUCT.metadata_json,
      },
    };

    if (dryRun) {
      console.log("[dry-run] Would upsert product profile for", slug);
      console.log(JSON.stringify(payload, null, 2));
      return;
    }

    const row = await upsertProductProfile(pool, projectId, payload);
    console.log(`Seeded product profile for ${slug} (${row.id})`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
