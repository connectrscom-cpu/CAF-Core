import { describe, expect, it } from "vitest";
import { dryRunPublishPlacement } from "./dry-run.js";
import type { PublicationPlacementRow } from "../../repositories/publications.js";

describe("dryRunPublishPlacement", () => {
  it("produces deterministic platform_post_id and url", () => {
    const row: PublicationPlacementRow = {
      id: "11111111-2222-3333-4444-555555555555",
      project_id: "p",
      task_id: "SNS_2026W09__Instagram__FLOW_CAROUSEL__row0001__v1",
      content_format: "carousel",
      platform: "Instagram",
      status: "publishing",
      scheduled_at: null,
      published_at: null,
      caption_snapshot: "cap",
      title_snapshot: "t",
      media_urls_json: [],
      video_url_snapshot: null,
      platform_post_id: null,
      posted_url: null,
      publish_error: null,
      external_ref: null,
      result_json: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const r1 = dryRunPublishPlacement(row);
    const r2 = dryRunPublishPlacement(row);
    expect(r1.platform_post_id).toBe(r2.platform_post_id);
    expect(r1.posted_url).toBe(r2.posted_url);
    expect(r1.platform_post_id).toContain("dry_instagram_11111111222233334444555555555555_post");
    expect(r1.result_json.mode).toBe("dry_run");
    expect(r1.result_json.task_id).toBe(row.task_id);
  });
});

