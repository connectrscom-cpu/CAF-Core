"use client";

import { useEffect, useMemo, useState } from "react";
import { CarouselSlider } from "@/components/CarouselSlider";
import { createSyntheticSlides } from "@/lib/carousel-slides";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import type { ReviewQueueRow } from "@/lib/types";

function getVal(row: ReviewQueueRow, key: string): string {
  return (row[key] ?? "").trim();
}

function isImageUrl(url: string): boolean {
  return /\.(png|jpg|jpeg|gif|webp|avif)(\?|#|$)/i.test(url);
}

function isVideoUrl(url: string): boolean {
  return /\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(url);
}

export interface TaskViewerProps {
  data: ReviewQueueRow;
  assetUrls?: string[];
  editedSlides?: NormalizedSlide[];
  onSlidesChange?: (slides: NormalizedSlide[]) => void;
  fallbackPreviewUrl?: string;
  readOnly?: boolean;
}

export function TaskViewer({
  data,
  assetUrls,
  editedSlides,
  onSlidesChange,
  fallbackPreviewUrl,
  readOnly = false,
}: TaskViewerProps) {
  const previewUrl = getVal(data, "preview_url");
  const flowType = getVal(data, "flow_type");
  const videoUrl =
    getVal(data, "video_url") ||
    getVal(data, "final_video_url") ||
    getVal(data, "merged_video_url") ||
    fallbackPreviewUrl ||
    "";
  const slidesJson = getVal(data, "generated_slides_json");

  const slides = useMemo(() => {
    if (!slidesJson) return null;
    try {
      const parsed = JSON.parse(slidesJson);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return null;
    }
  }, [slidesJson]);

  const urls = (assetUrls ?? []).map((u) => u?.trim()).filter(Boolean);
  const imageUrls = urls.filter((u) => isImageUrl(u));
  const videoUrls = urls.filter((u) => isVideoUrl(u));
  const effectiveVideoUrl = (videoUrls[0] ?? "").trim() || (isVideoUrl(videoUrl) ? videoUrl : "");
  const rowImageFromVideoField = videoUrl && isImageUrl(videoUrl) ? videoUrl : "";

  const [videoLoadFailed, setVideoLoadFailed] = useState(false);
  useEffect(() => { setVideoLoadFailed(false); }, [effectiveVideoUrl]);

  const sliderSlides =
    editedSlides && editedSlides.length > 0
      ? editedSlides
      : imageUrls.length > 1
        ? createSyntheticSlides(imageUrls.length)
        : [];

  const showVideo = !!effectiveVideoUrl && !videoLoadFailed;
  const showCarouselPreferred = !showVideo && imageUrls.length > 1 && sliderSlides.length > 0;
  const singleImageSrc =
    imageUrls.length === 1 ? imageUrls[0] : imageUrls.length === 0 && rowImageFromVideoField ? rowImageFromVideoField : "";
  const showSingleImage = !showVideo && !showCarouselPreferred && !!singleImageSrc;

  if (showCarouselPreferred) {
    return (
      <div>
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13, display: "inline-block", marginBottom: 12 }}>
            Open link in new tab
          </a>
        )}
        <CarouselSlider
          slides={sliderSlides}
          imageUrls={imageUrls}
          onSlidesChange={readOnly ? undefined : onSlidesChange}
          readOnly={readOnly}
        />
      </div>
    );
  }

  if (showVideo) {
    return (
      <div className="card">
        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Preview</p>
        <video
          src={effectiveVideoUrl}
          controls
          playsInline
          style={{ maxHeight: "70vh", width: "100%", borderRadius: 8, background: "#000" }}
          onError={() => setVideoLoadFailed(true)}
        />
        <div className="flex gap-2 mt-3" style={{ fontSize: 13 }}>
          <a href={effectiveVideoUrl} target="_blank" rel="noopener noreferrer">Open video in new tab</a>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fg-secondary)" }}>Open content link</a>
          )}
        </div>
      </div>
    );
  }

  if (showSingleImage) {
    return (
      <div className="card">
        <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Preview</p>
        <img
          src={singleImageSrc}
          alt={flowType ? `${flowType} preview` : "Preview"}
          style={{ maxHeight: "70vh", width: "100%", borderRadius: 8, objectFit: "contain" }}
        />
        <div className="flex gap-2 mt-3" style={{ fontSize: 13 }}>
          <a href={singleImageSrc} target="_blank" rel="noopener noreferrer">Open image in new tab</a>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fg-secondary)" }}>Open content link</a>
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
  if (!effectiveVideoUrl) reasons.push("no video or image URL from task or assets");
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
