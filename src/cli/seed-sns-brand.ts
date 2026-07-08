/**
 * Seed canonical Sign And Sound brand profile + Brand Visual System bible.
 *
 * Usage (DATABASE_URL in .env):
 *   npm run seed:sns-brand
 *   npm run seed:sns-brand -- --dry-run
 */
import pg from "pg";
import { config as loadDotenv } from "dotenv";
import {
  SNS_BRAND_BIBLE_V1,
  SNS_BRAND_CONSTRAINTS,
  SNS_BRAND_PROFILE_V1,
  SNS_DISPLAY_NAME,
  SNS_PRODUCT,
  SNS_PROJECT_SLUG,
  SNS_STRATEGY,
} from "../data/sns-brand-canonical.js";
import { insertBrandBibleVersion } from "../repositories/brand-bibles.js";
import { insertBrandProfileVersion } from "../repositories/brand-profiles.js";
import { upsertBrandConstraints, upsertProductProfile, upsertStrategyDefaults } from "../repositories/project-config.js";

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
  const slug = (process.argv.includes("--project") ? process.argv[process.argv.indexOf("--project") + 1] : SNS_PROJECT_SLUG)?.trim() || SNS_PROJECT_SLUG;

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const p = await client.query(
      `INSERT INTO caf_core.projects (slug, display_name, active)
       VALUES ($1, $2, true)
       ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
       RETURNING id::text, slug, display_name`,
      [slug, SNS_DISPLAY_NAME]
    );
    const projectId = p.rows[0]?.id as string;
    if (!projectId) throw new Error("Could not resolve project id");

    if (dryRun) {
      console.log("[dry-run] Would seed project:", slug, projectId);
      console.log(JSON.stringify({ strategy: SNS_STRATEGY, brand: SNS_BRAND_CONSTRAINTS, product: SNS_PRODUCT, profile: SNS_BRAND_PROFILE_V1, bible: SNS_BRAND_BIBLE_V1 }, null, 2));
      return;
    }

    await upsertStrategyDefaults(pool, projectId, {
      project_type: SNS_STRATEGY.project_type,
      core_offer: SNS_STRATEGY.core_offer,
      target_audience: SNS_STRATEGY.target_audience,
      audience_problem: SNS_STRATEGY.audience_problem,
      transformation_promise: SNS_STRATEGY.transformation_promise,
      positioning_statement: SNS_STRATEGY.positioning_statement,
      primary_business_goal: SNS_STRATEGY.primary_business_goal,
      primary_content_goal: SNS_STRATEGY.primary_content_goal,
      north_star_metric: null,
      monetization_model: null,
      traffic_destination: SNS_STRATEGY.traffic_destination,
      funnel_stage_focus: SNS_STRATEGY.funnel_stage_focus,
      brand_archetype: SNS_STRATEGY.brand_archetype,
      strategic_content_pillars: SNS_STRATEGY.strategic_content_pillars,
      authority_angle: null,
      differentiation_angle: SNS_STRATEGY.differentiation_angle,
      growth_strategy: SNS_STRATEGY.growth_strategy,
      publishing_intensity: SNS_STRATEGY.publishing_intensity,
      time_horizon: null,
      owner: null,
      notes: "Canonical SNS astrology brand — seeded by seed-sns-brand.ts",
      instagram_handle: SNS_STRATEGY.instagram_handle,
    });

    await upsertBrandConstraints(pool, projectId, {
      tone: SNS_BRAND_CONSTRAINTS.tone,
      voice_style: SNS_BRAND_CONSTRAINTS.voice_style,
      audience_level: SNS_BRAND_CONSTRAINTS.audience_level,
      emotional_intensity: SNS_BRAND_CONSTRAINTS.emotional_intensity,
      humor_level: SNS_BRAND_CONSTRAINTS.humor_level,
      emoji_policy: SNS_BRAND_CONSTRAINTS.emoji_policy,
      max_emojis_per_caption: SNS_BRAND_CONSTRAINTS.max_emojis_per_caption,
      banned_claims: SNS_BRAND_CONSTRAINTS.banned_claims,
      banned_words: SNS_BRAND_CONSTRAINTS.banned_words,
      mandatory_disclaimers: SNS_BRAND_CONSTRAINTS.mandatory_disclaimers,
      cta_style_rules: SNS_BRAND_CONSTRAINTS.cta_style_rules,
      storytelling_style: SNS_BRAND_CONSTRAINTS.storytelling_style,
      positioning_statement: SNS_BRAND_CONSTRAINTS.positioning_statement,
      differentiation_angle: SNS_BRAND_CONSTRAINTS.differentiation_angle,
      risk_level_default: SNS_BRAND_CONSTRAINTS.risk_level_default,
      manual_review_required: SNS_BRAND_CONSTRAINTS.manual_review_required,
      notes: "Canonical SNS brand constraints",
    });

    await upsertProductProfile(pool, projectId, {
      product_name: SNS_PRODUCT.product_name,
      product_category: SNS_PRODUCT.product_category,
      product_url: SNS_PRODUCT.product_url,
      one_liner: SNS_PRODUCT.one_liner,
      value_proposition: SNS_PRODUCT.value_proposition,
      elevator_pitch: null,
      primary_audience: SNS_PRODUCT.primary_audience,
      audience_pain_points: null,
      audience_desires: null,
      use_cases: SNS_PRODUCT.use_cases,
      anti_audience: null,
      key_features: null,
      key_benefits: SNS_PRODUCT.key_benefits,
      competitors: SNS_PRODUCT.competitors,
      proof_points: null,
      metadata_json: { instagram_handle: SNS_PRODUCT.instagram_handle, seeded_by: "seed-sns-brand.ts" },
    });

    const profileRow = await insertBrandProfileVersion(
      pool,
      projectId,
      { ...SNS_BRAND_PROFILE_V1 },
      "SNS canonical astrology brand profile"
    );

    const bibleRow = await insertBrandBibleVersion(
      pool,
      projectId,
      { ...SNS_BRAND_BIBLE_V1 },
      "SNS canonical Brand Visual System (astrology / cosmic)"
    );

    console.log("SNS brand seed OK");
    console.log("  project:", slug, projectId);
    console.log("  brand_profile v", profileRow.version);
    console.log("  brand_bible v", bibleRow.version);
    console.log("  palette:", SNS_BRAND_BIBLE_V1.palette.join(", "));
    console.log("  handle: @", SNS_STRATEGY.instagram_handle);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
