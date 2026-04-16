import type { PublicationPlacementRow } from "../../repositories/publications.js";

export interface DryRunPublishResult {
  ok: true;
  platform_post_id: string;
  posted_url: string;
  result_json: Record<string, unknown>;
}

/**
 * Deterministic “publisher” for local/dev.
 * Produces a stable platform_post_id and posted_url so downstream learning joins can be tested.
 */
export function dryRunPublishPlacement(row: PublicationPlacementRow): DryRunPublishResult {
  const base = `dry_${row.platform.toLowerCase().replace(/[^a-z0-9]+/g, "_")}_${row.id.replace(/-/g, "")}`;
  const platformPostId = `${base}_post`;
  return {
    ok: true,
    platform_post_id: platformPostId,
    posted_url: `https://example.invalid/${encodeURIComponent(row.platform)}/${encodeURIComponent(platformPostId)}`,
    result_json: {
      mode: "dry_run",
      platform: row.platform,
      placement_id: row.id,
      task_id: row.task_id,
      content_format: row.content_format,
      generated_at: new Date().toISOString(),
    },
  };
}

