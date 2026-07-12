/**
 * Seed / refresh Cuisina product bible on an existing project.
 *
 * Usage:
 *   DATABASE_URL=... npm run seed:cuisina-product-bible
 *   DATABASE_URL=... npm run seed:cuisina-product-bible -- --dry-run
 *   DATABASE_URL=... npm run seed:cuisina-product-bible -- --project CUISINA
 */
import pg from "pg";
import { config as loadDotenv } from "dotenv";
import { CUISINA_PRODUCT_BIBLE, CUISINA_PROJECT_SLUG } from "../data/cuisina-product-bible-canonical.js";
import { parseProductBible } from "../domain/product-bible.js";
import { getActiveProductBible, insertProductBibleVersion } from "../repositories/product-bibles.js";

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

  const parsed = parseProductBible(CUISINA_PRODUCT_BIBLE);
  if (!parsed) {
    console.error("Canonical product bible failed validation");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url });
  try {
    const proj = await pool.query(`SELECT id::text, slug, display_name FROM caf_core.projects WHERE slug = $1`, [slug]);
    const projectId = proj.rows[0]?.id as string | undefined;
    if (!projectId) {
      console.error(`Project not found: ${slug}`);
      process.exit(1);
    }

    const existing = await getActiveProductBible(pool, projectId);

    if (dryRun) {
      console.log("[dry-run] Would insert product bible for", slug);
      console.log(JSON.stringify(CUISINA_PRODUCT_BIBLE, null, 2));
      if (existing) console.log(`Existing active version: v${existing.version}`);
      return;
    }

    const inserted = await insertProductBibleVersion(
      pool,
      projectId,
      CUISINA_PRODUCT_BIBLE as unknown as Record<string, unknown>,
      existing ? "Cuisina canonical refresh" : "Cuisina canonical seed"
    );
    console.log(`Seeded product bible for ${slug} (version ${inserted.version})`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
