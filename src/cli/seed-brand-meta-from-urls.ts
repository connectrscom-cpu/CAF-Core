/**
 * Create/update a CAF **project** (tenant in Core) and attach **META_FB** + **META_IG** integrations
 * from public profile URLs.
 *
 * `minhaterra.online` / Connecrts Lda are **accounts you post to** (integration targets), not the
 * CAF project slug. By default this seeds a tenant `connecrts` (Connecrts Lda) with FB + IG rows.
 *
 * **Multi-project, one Meta destination:** you can run the same defaults for `SNS`, `connecrts`, etc.
 * (`--project SNS --name "…"`) so every placement uses the same **fb_page_id** / **ig_user_id** while
 * all live posts go to Connectrs + Minha Terra until you split brands in Business Manager.
 *
 * Stores Graph-resolved **fb_page_id** + **ig_user_id** when set (defaults match Connectrs / Minha Terra from Graph).
 * Does not store API tokens — add `credentials_json.access_token` later (Page token from `/me/accounts` or OAuth).
 *
 * Usage (from repo root, DATABASE_URL in .env):
 *   npm run seed:meta-links
 *   npm run seed:meta-links -- --project connecrts --name "Connecrts Lda"
 *   npm run seed:meta-links -- --project SNS --name "Demo SNS"
 *   (omit `--fb-page-id` / `--ig-user-id` to keep Connectrs + Minha Terra defaults for every project slug)
 *   (`--slug` is an alias for `--project`.)
 */
import pg from "pg";
import { config as loadDotenv } from "dotenv";
import { upsertProjectIntegration } from "../repositories/project-integrations.js";

loadDotenv({ override: true });

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  if (i === -1 || i + 1 >= process.argv.length) return undefined;
  return process.argv[i + 1];
}

function parseFacebookNumericId(url: string): string | null {
  try {
    const u = new URL(url.trim());
    const id = u.searchParams.get("id");
    if (id && /^\d+$/.test(id)) return id;
  } catch {
    /* ignore */
  }
  return null;
}

function parseInstagramUsername(url: string): string | null {
  try {
    const u = new URL(url.trim().replace(/\/+$/, ""));
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length >= 1 && /^[a-zA-Z0-9._]+$/.test(parts[0]!)) return parts[0]!;
  } catch {
    /* ignore */
  }
  return null;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const slug = (
    argValue("--project") ??
    argValue("--slug") ??
    process.env.SEED_PUBLISH_PROJECT_SLUG ??
    process.env.SEED_META_PROJECT_SLUG ??
    "connecrts"
  ).trim();
  const displayName = (
    argValue("--name") ??
    process.env.SEED_PUBLISH_PROJECT_NAME ??
    process.env.SEED_META_PROJECT_NAME ??
    "Connecrts Lda"
  ).trim();
  const fbUrl =
    argValue("--fb") ??
    process.env.SEED_META_FACEBOOK_URL ??
    "https://www.facebook.com/673711675834588";
  const igUrl =
    argValue("--ig") ??
    process.env.SEED_META_INSTAGRAM_URL ??
    "https://www.instagram.com/minhaterra.online/";

  /** From Graph: GET /{page-id}?fields=connected_instagram_account — not the old profile.php?id= URL. */
  const fbPageId =
    (argValue("--fb-page-id") ?? process.env.SEED_META_FB_PAGE_ID ?? "673711675834588").trim();
  const igUserId =
    (argValue("--ig-user-id") ?? process.env.SEED_META_IG_USER_ID ?? "17841469638131849").trim();

  const fbId = parseFacebookNumericId(fbUrl);
  const igUser = parseInstagramUsername(igUrl);

  const pool = new pg.Pool({ connectionString: url });
  const client = await pool.connect();
  try {
    const p = await client.query(
      `INSERT INTO caf_core.projects (slug, display_name, active)
       VALUES ($1, $2, true)
       ON CONFLICT (slug) DO UPDATE SET display_name = EXCLUDED.display_name, updated_at = now()
       RETURNING id`,
      [slug, displayName]
    );
    const projectId = p.rows[0].id as string;

    const graphHint = {
      next_steps: [
        "Put a long-lived Page Access Token in credentials_json.access_token (from GET /me/accounts when non-empty, or OAuth).",
        "If /me/accounts stays empty, fix Business Manager: App → Connected assets → add this Page; then regenerate user token.",
      ],
    };

    const fbRow = await upsertProjectIntegration(pool, {
      project_id: projectId,
      platform: "META_FB",
      display_name: `${displayName} — Facebook`,
      is_enabled: true,
      account_ids_json: {
        marketing_label: "Connecrts Lda (Facebook)",
        fb_page_id: fbPageId,
        source_url: fbUrl.trim(),
        facebook_numeric_id_from_url: fbId,
        note: "Use fb_page_id for Graph (Business Manager Page id). profile.php?id= may differ.",
      },
      credentials_json: {},
      config_json: { graph_api: graphHint },
    });

    const igRow = await upsertProjectIntegration(pool, {
      project_id: projectId,
      platform: "META_IG",
      display_name: igUser ? `${displayName} — Instagram (@${igUser})` : `${displayName} — Instagram`,
      is_enabled: true,
      account_ids_json: {
        marketing_label: "Minha Terra (Instagram test account)",
        ig_user_id: igUserId,
        source_url: igUrl.trim(),
        instagram_username: igUser,
        linked_fb_page_id: fbPageId,
        note: "ig_user_id from GET /{fb_page_id}?fields=connected_instagram_account",
      },
      credentials_json: {},
      config_json: { graph_api: graphHint },
    });

    console.log("OK — project slug:", slug, "project_id:", projectId);
    console.log("META_FB integration:", fbRow?.id, "| fb_page_id:", fbPageId);
    console.log("META_IG integration:", igRow?.id, "| ig_user_id:", igUserId);
    if (!fbId) console.warn("Could not parse Facebook id= from --fb URL");
    if (!igUser) console.warn("Could not parse Instagram username from --ig URL");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
