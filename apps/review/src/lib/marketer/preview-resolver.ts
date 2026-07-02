import type { ReviewJobDetail } from "@/lib/caf-core-client";
import { previewFieldsFromJob } from "@/lib/job-preview-fields";
import { isVideoUrl } from "@/lib/media-url";
import type { ReviewQueueRow } from "@/lib/types";
import {
  pickInspectionMediaPreviewUrl,
  pickRenderableThumb,
  type InspectionMedia,
} from "./inspection-media";

export type PreviewStatus = "ready" | "missing" | "pending" | "failed" | "expired";
export type PreviewKind = "thumbnail" | "video" | "carousel" | "reference" | "storyboard" | "unknown";

export interface ContentPreview {
  status: PreviewStatus;
  thumbnailUrl: string | null;
  previewUrl: string | null;
  kind: PreviewKind;
  slideCount: number | null;
  failedReason: string | null;
  lastRenderedAt: string | null;
}

const EMPTY_PREVIEW: ContentPreview = {
  status: "missing",
  thumbnailUrl: null,
  previewUrl: null,
  kind: "unknown",
  slideCount: null,
  failedReason: null,
  lastRenderedAt: null,
};

export function contentPreviewMissing(kind: PreviewKind = "unknown"): ContentPreview {
  return { ...EMPTY_PREVIEW, kind };
}

export function contentPreviewReady(
  url: string,
  opts?: Partial<Pick<ContentPreview, "kind" | "slideCount" | "lastRenderedAt">>
): ContentPreview {
  const u = url.trim();
  if (!u) return contentPreviewMissing(opts?.kind ?? "unknown");
  const kind = opts?.kind ?? (isVideoUrl(u) ? "video" : "thumbnail");
  return {
    status: "ready",
    thumbnailUrl: u,
    previewUrl: u,
    kind,
    slideCount: opts?.slideCount ?? null,
    failedReason: null,
    lastRenderedAt: opts?.lastRenderedAt ?? null,
  };
}

export type EvidencePreviewSource =
  | { kind: "inspection_media"; media: InspectionMedia | null; previewKind?: PreviewKind }
  | { kind: "urls"; urls: (string | null | undefined)[]; previewKind?: PreviewKind }
  | { kind: "insights_map"; insightsId: string; map: Map<string, string | null>; previewKind?: PreviewKind };

/** Canonical research/evidence preview resolver (ideas, top performers, intel cards). */
export function resolveEvidencePreview(source: EvidencePreviewSource): ContentPreview {
  const previewKind = source.previewKind ?? "reference";

  if (source.kind === "insights_map") {
    const url = pickRenderableThumb(source.map.get(source.insightsId));
    return url ? contentPreviewReady(url, { kind: previewKind }) : contentPreviewMissing(previewKind);
  }

  if (source.kind === "inspection_media") {
    const ranked = pickInspectionMediaPreviewUrl(source.media);
    if (ranked) return contentPreviewReady(ranked, { kind: previewKind });
    if (source.media?.items?.length) {
      for (const it of source.media.items) {
        const found = pickRenderableThumb(it.public_url, it.vision_fetch_url);
        if (found) return contentPreviewReady(found, { kind: previewKind });
      }
    }
    return contentPreviewMissing(previewKind);
  }

  const url = pickRenderableThumb(...source.urls);
  return url ? contentPreviewReady(url, { kind: previewKind }) : contentPreviewMissing(previewKind);
}

function ideaPreviewKind(format: string, targetFlowType?: string): PreviewKind {
  const f = format.toLowerCase();
  const flow = (targetFlowType ?? "").toLowerCase();
  if (f === "carousel" || flow.includes("carousel")) return "carousel";
  if (f === "video" || flow.includes("video")) return "video";
  if (flow.includes("visual_first")) return "storyboard";
  return "reference";
}

export function resolveIdeaPreview(
  idea: { format: string; targetFlowType?: string; evidenceBasis: string[] },
  thumbByInsightsId: Map<string, string | null>
): ContentPreview {
  const kind = ideaPreviewKind(idea.format, idea.targetFlowType);
  for (const id of idea.evidenceBasis) {
    const resolved = resolveEvidencePreview({
      kind: "insights_map",
      insightsId: id,
      map: thumbByInsightsId,
      previewKind: "reference",
    });
    if (resolved.status === "ready") return { ...resolved, kind };
  }
  return contentPreviewMissing(kind);
}

export function enrichIdeasWithPreviews<T extends { evidenceBasis: string[]; format: string; targetFlowType?: string }>(
  ideas: T[],
  thumbByInsightsId: Map<string, string | null>
): Array<T & { preview: ContentPreview }> {
  return ideas.map((idea) => ({
    ...idea,
    preview: resolveIdeaPreview(idea, thumbByInsightsId),
  }));
}

function str(row: ReviewQueueRow, key: string): string {
  return String(row[key] ?? "").trim();
}

/** Workbench list row — uses Core list fields when available. */
export function resolveQueueRowPreview(row: ReviewQueueRow): ContentPreview {
  const thumb = str(row, "preview_url");
  const video = str(row, "video_url");
  const url = thumb || video;
  const reviewStatus = str(row, "review_status").toUpperCase();
  const error = str(row, "text_overlay_reprint_error") || str(row, "carousel_regenerate_error") || null;

  const reprintFailed = str(row, "text_overlay_reprint_active") === "failed" || str(row, "text_overlay_reprint_status") === "failed";
  const regenFailed = str(row, "carousel_regenerate_active") === "failed" || str(row, "carousel_regenerate_status") === "failed";
  const reprintPending = str(row, "text_overlay_reprint_active") === "true" || str(row, "text_overlay_reprint_status") === "pending";
  const regenPending = str(row, "carousel_regenerate_active") === "true" || str(row, "carousel_regenerate_status") === "in_progress";
  const rendering = reviewStatus === "RENDERING";

  if (url) {
    const base = contentPreviewReady(url, { kind: isVideoUrl(url) ? "video" : "thumbnail" });
    if (reprintFailed || regenFailed) return { ...base, status: "failed", failedReason: error };
    if (reprintPending || regenPending || rendering) return { ...base, status: "pending" };
    return base;
  }

  if (reprintFailed || regenFailed) {
    return { ...contentPreviewMissing(), status: "failed", failedReason: error };
  }
  if (reprintPending || regenPending || rendering) {
    return { ...contentPreviewMissing(), status: "pending" };
  }
  return contentPreviewMissing();
}

export function previewStatusLabel(status: PreviewStatus): string {
  switch (status) {
    case "ready":
      return "Preview ready";
    case "missing":
      return "No preview";
    case "pending":
      return "Rendering";
    case "failed":
      return "Render failed";
    case "expired":
      return "Preview expired";
    default:
      return "Preview";
  }
}

export function previewStatusBadgeClass(status: PreviewStatus): string {
  switch (status) {
    case "ready":
      return "preview-badge preview-badge--ready";
    case "pending":
      return "preview-badge preview-badge--pending";
    case "failed":
      return "preview-badge preview-badge--failed";
    case "expired":
      return "preview-badge preview-badge--expired";
    default:
      return "preview-badge preview-badge--missing";
  }
}

/** Job detail — recomputes from assets when list thumb is empty. */
export function resolveJobPreview(job: ReviewJobDetail): ContentPreview {
  const { preview_url, video_url } = previewFieldsFromJob(job);
  const url = preview_url || video_url;
  const rs = job.render_state as Record<string, unknown> | null | undefined;
  const phase = String(rs?.phase ?? "");
  const rsStatus = String(rs?.status ?? "").toLowerCase();
  const error = typeof rs?.error === "string" ? rs.error : null;
  const failed = rsStatus === "failed";
  const pending = rsStatus === "pending" || job.status === "RENDERING";

  const slideAssets = (job.assets ?? []).filter(
    (a) => String(a.asset_type ?? "").toLowerCase().includes("carousel_slide")
  );
  const slideCount = slideAssets.length > 0 ? slideAssets.length : null;

  if (url) {
    const base = contentPreviewReady(url, {
      kind: isVideoUrl(url) ? "video" : slideCount && slideCount > 1 ? "carousel" : "thumbnail",
      slideCount,
      lastRenderedAt: typeof rs?.completed_at === "string" ? rs.completed_at : null,
    });
    if (failed) return { ...base, status: "failed", failedReason: error };
    if (pending) return { ...base, status: "pending" };
    return base;
  }

  if (failed) return { ...contentPreviewMissing("carousel"), status: "failed", failedReason: error, slideCount };
  if (pending) return { ...contentPreviewMissing("carousel"), status: "pending", slideCount };
  return { ...contentPreviewMissing(), slideCount };
}
