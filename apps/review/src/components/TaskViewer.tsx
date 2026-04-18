"use client";

import { useEffect, useMemo, useState } from "react";
import { CarouselSlider } from "@/components/CarouselSlider";
import type { CarouselMediaItem } from "@/components/CarouselSlider";
import { createSyntheticSlides } from "@/lib/carousel-slides";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import type { ReviewQueueRow } from "@/lib/types";
import { isImageUrl, isVideoUrl, taskAssetsToPreviewRows, type TaskAssetPreview } from "@/lib/media-url";
import { isHeyGenReviewFlow } from "@/lib/heygen-review-flow";

function getVal(row: ReviewQueueRow, key: string): string {
  return (row[key] ?? "").trim();
}

export interface TaskViewerProps {
  data: ReviewQueueRow;
  assetUrls?: string[];
  /** Full asset rows (position, url, type) — preferred for mixed image/video carousels. */
  taskAssets?: TaskAssetPreview[];
  editedSlides?: NormalizedSlide[];
  onSlidesChange?: (slides: NormalizedSlide[]) => void;
  fallbackPreviewUrl?: string;
  readOnly?: boolean;
  /** HeyGen workbench: controlled spoken script under the preview. Omit to use task row script (read-only views). */
  spokenScript?: string;
  onSpokenScriptChange?: (v: string) => void;
}

export function TaskViewer({
  data,
  assetUrls,
  taskAssets,
  editedSlides,
  onSlidesChange,
  fallbackPreviewUrl,
  readOnly = false,
  spokenScript: spokenScriptProp,
  onSpokenScriptChange,
}: TaskViewerProps) {
  const previewUrl = getVal(data, "preview_url");
  const flowType = getVal(data, "flow_type");
  const heyGenVideoMode = isHeyGenReviewFlow(flowType);
  const scriptFromRow = (
    getVal(data, "final_spoken_script_override") || getVal(data, "generated_spoken_script")
  ).trim();
  const effectiveSpokenScript = spokenScriptProp !== undefined ? spokenScriptProp : scriptFromRow;
  const rowVideoUrl =
    getVal(data, "video_url") ||
    getVal(data, "final_video_url") ||
    getVal(data, "merged_video_url") ||
    // For video flows, `preview_url` is often the only available signed MP4 URL (especially when Core detail lookup fails).
    (previewUrl && isVideoUrl(previewUrl) ? previewUrl : "") ||
    "";
  const slidesJson = getVal(data, "generated_slides_json");

  const mediaRows = useMemo(() => {
    if (taskAssets && taskAssets.length > 0) return taskAssets;
    const flowHint = getVal(data, "flow_type");
    return taskAssetsToPreviewRows(
      (assetUrls ?? []).map((public_url, i) => ({
        position: i,
        public_url,
        asset_type: null as string | null,
      })),
      { flowTypeHint: flowHint }
    );
  }, [taskAssets, assetUrls, data]);

  const mediaItems: CarouselMediaItem[] = useMemo(
    () => mediaRows.map((r) => ({ url: r.public_url, kind: r.kind === "video" ? "video" : "image" })),
    [mediaRows]
  );

  const imageUrlsLegacy = useMemo(
    () => mediaRows.filter((r) => r.kind === "image").map((r) => r.public_url),
    [mediaRows]
  );

  const slides = useMemo(() => {
    if (!slidesJson) return null;
    try {
      const parsed = JSON.parse(slidesJson);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return null;
    }
  }, [slidesJson]);

  const [videoLoadFailed, setVideoLoadFailed] = useState(false);
  useEffect(() => {
    setVideoLoadFailed(false);
  }, [rowVideoUrl, mediaRows]);

  const sliderSlides =
    editedSlides && editedSlides.length > 0
      ? editedSlides
      : mediaRows.length > 1
        ? createSyntheticSlides(mediaRows.length)
        : [];

  const singleAssetVideo = mediaRows.length === 1 && mediaRows[0]!.kind === "video" ? mediaRows[0]!.public_url : "";
  const singleAssetImage = mediaRows.length === 1 && mediaRows[0]!.kind === "image" ? mediaRows[0]!.public_url : "";
  const fallbackIfImage = fallbackPreviewUrl && isImageUrl(fallbackPreviewUrl) ? fallbackPreviewUrl : "";
  const rowVideo =
    rowVideoUrl && isVideoUrl(rowVideoUrl)
      ? rowVideoUrl
      : fallbackPreviewUrl && isVideoUrl(fallbackPreviewUrl)
        ? fallbackPreviewUrl
        : "";

  const fullBleedVideoUrl = singleAssetVideo || rowVideo;
  const showCarouselBlock = sliderSlides.length > 0;

  const showFullVideo =
    !showCarouselBlock && !!fullBleedVideoUrl && !videoLoadFailed;

  const singleImageSrc =
    singleAssetImage ||
    (imageUrlsLegacy.length === 1 ? imageUrlsLegacy[0]! : "") ||
    (mediaRows.length <= 1 ? fallbackIfImage : "");

  const showSingleImage = !showCarouselBlock && !showFullVideo && !!singleImageSrc;

  if (showCarouselBlock) {
    return (
      <div>
        {previewUrl && (
          <a
            href={previewUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{ fontSize: 13, display: "inline-block", marginBottom: 12 }}
          >
            Open link in new tab
          </a>
        )}
        <CarouselSlider
          slides={sliderSlides}
          mediaItems={mediaItems}
          imageUrls={imageUrlsLegacy}
          onSlidesChange={readOnly ? undefined : onSlidesChange}
          readOnly={readOnly}
          heyGenVideoMode={heyGenVideoMode}
          spokenScript={effectiveSpokenScript}
          onSpokenScriptChange={heyGenVideoMode && !readOnly ? onSpokenScriptChange : undefined}
        />
      </div>
    );
  }

  if (showFullVideo) {
    return (
      <div className="card">
        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Preview</p>
        <video
          src={fullBleedVideoUrl}
          controls
          playsInline
          style={{ maxHeight: "70vh", width: "100%", borderRadius: 8, background: "#000" }}
          onError={() => setVideoLoadFailed(true)}
        />
        <div className="flex gap-2 mt-3" style={{ fontSize: 13 }}>
          <a href={fullBleedVideoUrl} target="_blank" rel="noopener noreferrer">
            Open video in new tab
          </a>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fg-secondary)" }}>
              Open content link
            </a>
          )}
        </div>
        {heyGenVideoMode && (
          <div style={{ marginTop: 16, padding: 16, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}>
            <label className="filter-label">Spoken script</label>
            {readOnly || !onSpokenScriptChange ? (
              <pre
                style={{
                  margin: "8px 0 0",
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontFamily: "var(--font-mono, ui-monospace, monospace)",
                  fontSize: 13,
                  lineHeight: 1.45,
                  color: "var(--fg-secondary)",
                }}
              >
                {effectiveSpokenScript.trim() ? effectiveSpokenScript : "—"}
              </pre>
            ) : (
              <textarea
                value={effectiveSpokenScript}
                onChange={(e) => onSpokenScriptChange(e.target.value)}
                rows={12}
                placeholder="Voiceover / narration script…"
                style={{
                  width: "100%",
                  minHeight: 200,
                  marginTop: 8,
                  fontFamily: "var(--font-mono, ui-monospace, monospace)",
                  fontSize: 13,
                }}
              />
            )}
          </div>
        )}
      </div>
    );
  }

  if (showSingleImage && singleImageSrc) {
    return (
      <div className="card">
        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Preview</p>
        <img
          src={singleImageSrc}
          alt={flowType ? `${flowType} preview` : "Preview"}
          style={{ maxHeight: "70vh", width: "100%", borderRadius: 8, objectFit: "contain" }}
          referrerPolicy="no-referrer"
        />
        <div className="flex gap-2 mt-3" style={{ fontSize: 13 }}>
          <a href={singleImageSrc} target="_blank" rel="noopener noreferrer">
            Open image in new tab
          </a>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fg-secondary)" }}>
              Open content link
            </a>
          )}
        </div>
      </div>
    );
  }

  if (slides && slides.length > 0) {
    return (
      <div>
        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Carousel (generated_slides_json)</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {slides.map((slide: Record<string, unknown>, i: number) => (
            <div key={i} className="card">
              {typeof slide === "object" && slide !== null && (
                <pre className="slides-json">{JSON.stringify(slide, null, 2)}</pre>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  const reasons: string[] = [];
  if (!fullBleedVideoUrl && mediaRows.length === 0) reasons.push("no video or image URL from task or assets");
  else if (videoLoadFailed) reasons.push("video URL did not load");
  if (!slidesJson) reasons.push("no generated_slides_json");

  return (
    <div className="card">
      <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>No inline preview</p>
      <p style={{ fontSize: 13, color: "var(--fg-secondary)" }}>
        {reasons.length ? reasons.join(" · ") : "Nothing to render."}
        {flowType ? ` Flow: ${flowType}.` : ""}
      </p>
      {previewUrl && (
        <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ display: "inline-block", marginTop: 8, fontSize: 13 }}>
          Open content page
        </a>
      )}
      <details style={{ marginTop: 12, fontSize: 13 }}>
        <summary style={{ cursor: "pointer", color: "var(--fg-secondary)" }}>Raw task data</summary>
        <pre className="slides-json" style={{ marginTop: 8 }}>
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
