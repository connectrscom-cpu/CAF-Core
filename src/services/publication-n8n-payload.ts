import type { PublicationPlacementRow } from "../repositories/publications.js";

/** Shape consumed by Publish_Carousel_IG_FB / Publish_Video_IG_FB (+ ids for callbacks). */
export function buildPublicationN8nPayload(row: PublicationPlacementRow, projectSlug: string): Record<string, unknown> {
  const urls = Array.isArray(row.media_urls_json)
    ? (row.media_urls_json as string[])
    : typeof row.media_urls_json === "string"
      ? []
      : [];

  const base: Record<string, unknown> = {
    placement_id: row.id,
    project_slug: projectSlug,
    task_id: row.task_id,
    publish_target: row.platform,
    publish_caption: row.caption_snapshot ?? "",
    caption: row.caption_snapshot ?? "",
    title: row.title_snapshot ?? "",
  };

  if (row.content_format === "video") {
    base.publish_video_url = row.video_url_snapshot ?? "";
    base.video_url = row.video_url_snapshot ?? "";
  } else {
    base.publish_media_urls = urls;
    base.publish_media_urls_json = JSON.stringify(urls);
  }

  return base;
}
