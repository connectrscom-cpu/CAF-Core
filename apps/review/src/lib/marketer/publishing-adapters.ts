import type { PublicationPlacement } from "@/lib/caf-core-client";
import type { PublishStatus, ScheduledPost } from "./types";

function mapStatus(raw: string): PublishStatus {
  switch (raw) {
    case "scheduled":
      return "scheduled";
    case "publishing":
      return "publishing";
    case "published":
      return "published";
    case "failed":
      return "failed";
    default:
      return "ready";
  }
}

export function toScheduledPost(p: PublicationPlacement): ScheduledPost {
  return {
    id: p.id,
    taskId: p.task_id,
    contentTitle: (p.title_snapshot ?? "").trim() || p.task_id,
    platform: p.platform,
    scheduledAt: p.scheduled_at,
    publishedAt: p.published_at,
    postUrl: p.posted_url,
    status: mapStatus(p.status),
    format: p.content_format,
    error: p.publish_error,
  };
}

export function toScheduledPosts(placements: PublicationPlacement[]): ScheduledPost[] {
  return placements.map(toScheduledPost);
}
