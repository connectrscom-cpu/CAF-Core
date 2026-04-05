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
      <div className="space-y-4">
        {previewUrl && (
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-sm text-primary hover:underline">
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
      <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
        <p className="mb-2 text-sm font-medium">Preview</p>
        <video
          src={effectiveVideoUrl}
          controls
          playsInline
          className="max-h-[70vh] w-full max-w-full rounded bg-black"
          onError={() => setVideoLoadFailed(true)}
        />
        <div className="flex flex-wrap gap-3 text-sm">
          <a href={effectiveVideoUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Open video in new tab
          </a>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground hover:underline">
              Open content link
            </a>
          )}
        </div>
      </div>
    );
  }

  if (showSingleImage) {
    return (
      <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
        <p className="mb-2 text-sm font-medium">Preview</p>
        <img
          src={singleImageSrc}
          alt={flowType ? `${flowType} preview` : "Preview"}
          className="max-h-[70vh] w-full max-w-full rounded object-contain"
        />
        <div className="flex flex-wrap gap-3 text-sm">
          <a href={singleImageSrc} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
            Open image in new tab
          </a>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-foreground hover:underline">
              Open content link
            </a>
          )}
        </div>
      </div>
    );
  }

  if (slides && slides.length > 0) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium">Carousel (generated_slides_json)</p>
        <div className="flex flex-col gap-4 rounded-lg border bg-muted/30 p-4">
          {slides.map((slide: Record<string, unknown>, i: number) => (
            <div key={i} className="rounded border bg-card p-4 text-card-foreground shadow-sm">
              {typeof slide === "object" && slide !== null && (
                <pre className="whitespace-pre-wrap text-sm">{JSON.stringify(slide, null, 2)}</pre>
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
    <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
      <p className="text-sm font-medium">No inline preview</p>
      <p className="text-sm text-muted-foreground">
        {reasons.length ? reasons.join(" · ") : "Nothing to render."}
        {flowType ? ` Flow: ${flowType}.` : ""}
      </p>
      {previewUrl && (
        <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="inline-block text-sm text-primary hover:underline">
          Open content page
        </a>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Raw task data</summary>
        <pre className="mt-2 max-h-[50vh] overflow-auto whitespace-pre-wrap rounded bg-background p-4 text-xs">
          {JSON.stringify(data, null, 2)}
        </pre>
      </details>
    </div>
  );
}
