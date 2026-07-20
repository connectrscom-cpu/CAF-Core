"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CarouselSlider } from "@/components/CarouselSlider";
import type { CarouselLivePreviewOptions, CarouselMediaItem } from "@/components/CarouselSlider";
import { createSyntheticSlides } from "@/lib/carousel-slides";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import type { ReviewQueueRow } from "@/lib/types";
import { isImageUrl, isVideoUrl, taskAssetsToPreviewRows, carouselMediaItemsFromPreviewRows, type TaskAssetPreview } from "@/lib/media-url";
import { isHeyGenReviewFlow } from "@/lib/heygen-review-flow";
import { isImageFlow, isVideoFlow } from "@/lib/flow-kind";

function getVal(row: ReviewQueueRow, key: string): string {
  return (row[key] ?? "").trim();
}

function VideoWithBrandOverlays({
  src,
  logoUrl,
  logoPosition = "br",
  frameUrl,
  className,
  style,
  onError,
}: {
  src: string;
  logoUrl?: string;
  logoPosition?: string;
  frameUrl?: string;
  className?: string;
  style?: React.CSSProperties;
  onError?: () => void;
}) {
  const showFrame = Boolean(frameUrl?.trim());
  const showLogo = Boolean(logoUrl?.trim());
  const pos = ["tl", "tr", "bl", "br"].includes(String(logoPosition ?? "").trim())
    ? String(logoPosition).trim()
    : "br";
  return (
    <div className={`video-brand-overlay-wrap${className ? ` ${className}` : ""}`} style={style}>
      <video
        src={src}
        controls
        playsInline
        className="video-brand-overlay-wrap__video"
        onError={onError}
      />
      {showFrame ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={frameUrl} alt="" className="video-brand-overlay-wrap__frame" aria-hidden />
      ) : null}
      {showLogo ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt=""
          className={`video-brand-overlay-wrap__logo video-brand-overlay-wrap__logo--${pos}`}
          aria-hidden
        />
      ) : null}
    </div>
  );
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
  /** Re-render current slide in review (font scale + copy) when template name is known. */
  carouselLivePreview?: CarouselLivePreviewOptions | null;
  /** e.g. debug-bundle copy — shown beside preview open links. */
  previewToolbar?: ReactNode;
  /** Carousel viewer navigation (1-based slide index). */
  onCarouselSlideChange?: (slideIndex1Based: number) => void;
  /** Right panel beside slide copy fields (mimic text layout editor). */
  carouselCopySidePanel?: ReactNode;
  /** Panel beside the slide preview (e.g. caption editor) to fill dead space. */
  carouselPreviewSidePanel?: ReactNode;
  /** Sync carousel slide when side panel changes slide (1-based). */
  carouselActiveSlideIndex?: number;
  /** Mimic: original reference frame URL for current slide. */
  referenceSlideUrl?: string;
  /** Mimic video: archived top-performer source video for side-by-side review. */
  referenceVideoUrl?: string;
  /** Live CSS preview of brand logo/frame on generated video (before ffmpeg apply). */
  videoBrandOverlay?: { logoUrl?: string; logoPosition?: string; frameUrl?: string };
  projectHandle?: string;
  caption?: string;
  onCaptionChange?: (value: string) => void;
  hashtags?: string;
  onHashtagsChange?: (value: string) => void;
  activeTextBlockIndex?: number | null;
  onActiveTextBlockIndexChange?: (blockIndex: number | null) => void;
  onDeleteSlide?: (slideIndex1Based: number) => void;
  onRegenerateSlide?: (slideIndex1Based: number) => void;
  onRegenerateAllSlides?: () => void;
  regenerateSlideBusy?: boolean;
  /** Mimic slide image regen — optional prompt note (shared with layout editor). */
  mimicRegenerationNote?: string;
  onMimicRegenerationNoteChange?: (value: string) => void;
  mimicTemplateBg?: boolean;
  mimicFullBleed?: boolean;
  onMimicLayoutTextBlockChange?: (blockIndex: number, text: string) => void;
  layoutSlideBadges?: Record<number, import("@/lib/mimic-layout-qc").MimicLayoutSlideBadge[]>;
  slideRenderStatuses?: import("@/lib/slide-render-status").SlideRenderState[];
  /** Bumped when task assets refetch after reprint/regen — forces preview image remount. */
  assetRefreshKey?: number;
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
  carouselLivePreview = null,
  previewToolbar,
  onCarouselSlideChange,
  carouselCopySidePanel,
  carouselPreviewSidePanel,
  carouselActiveSlideIndex,
  referenceSlideUrl,
  referenceVideoUrl,
  videoBrandOverlay,
  projectHandle,
  caption,
  onCaptionChange,
  hashtags,
  onHashtagsChange,
  activeTextBlockIndex,
  onActiveTextBlockIndexChange,
  onDeleteSlide,
  onRegenerateSlide,
  onRegenerateAllSlides,
  regenerateSlideBusy,
  mimicRegenerationNote,
  onMimicRegenerationNoteChange,
  mimicTemplateBg,
  mimicFullBleed,
  onMimicLayoutTextBlockChange,
  layoutSlideBadges,
  slideRenderStatuses,
  assetRefreshKey = 0,
}: TaskViewerProps) {
  const previewUrl = getVal(data, "preview_url");
  const flowType = getVal(data, "flow_type");
  const heyGenVideoMode = isHeyGenReviewFlow(flowType);
  const isImageFormat = isImageFlow(flowType);
  // Image flows are classified first — `isVideoFlow` would not match FLOW_IMG_* anyway, but this guard
  // future-proofs any overlap between image-flow naming and video substring heuristics.
  const isVideoFormat = !isImageFormat && isVideoFlow(flowType);
  const scriptFromRow = (
    getVal(data, "final_spoken_script_override") || getVal(data, "generated_spoken_script")
  ).trim();
  const effectiveSpokenScript = spokenScriptProp !== undefined ? spokenScriptProp : scriptFromRow;
  const rowVideoUrl =
    getVal(data, "video_url") ||
    getVal(data, "final_video_url") ||
    getVal(data, "merged_video_url") ||
    // For video flows, `preview_url` is often the only available signed MP4 URL (especially when Core detail lookup fails).
    (previewUrl && (isVideoUrl(previewUrl) || isVideoFormat) ? previewUrl : "") ||
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
    () =>
      carouselMediaItemsFromPreviewRows(mediaRows).map(
        (item) => item ?? { url: "", kind: "image" as const }
      ),
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

  const sliderSlides = isVideoFormat || isImageFormat
    ? []
    : editedSlides && editedSlides.length > 0
      ? editedSlides
      : mediaRows.length > 1
        ? createSyntheticSlides(mediaRows.length)
        : [];

  const singleAssetVideo = mediaRows.length === 1 && mediaRows[0]!.kind === "video" ? mediaRows[0]!.public_url : "";
  const singleAssetImage = mediaRows.length === 1 && mediaRows[0]!.kind === "image" ? mediaRows[0]!.public_url : "";
  const fallbackIfImage = fallbackPreviewUrl && isImageUrl(fallbackPreviewUrl) ? fallbackPreviewUrl : "";
  // For video flows we trust the URL even without a `.mp4` extension (Supabase signed URLs, HeyGen, etc.)
  // so the publish preview never falls back to a stale carousel JSON for HeyGen / Reel / Scene tasks.
  const rowVideo =
    rowVideoUrl && (isVideoUrl(rowVideoUrl) || isVideoFormat)
      ? rowVideoUrl
      : fallbackPreviewUrl && (isVideoUrl(fallbackPreviewUrl) || isVideoFormat)
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
        {(previewUrl || previewToolbar) && (
          <div className="preview-action-row">
            {previewUrl ? (
              <a href={previewUrl} target="_blank" rel="noopener noreferrer">
                Open link in new tab
              </a>
            ) : null}
            {previewToolbar}
          </div>
        )}
        <CarouselSlider
          slides={sliderSlides}
          mediaItems={mediaItems}
          imageUrls={imageUrlsLegacy}
          livePreview={carouselLivePreview}
          onSlidesChange={readOnly ? undefined : onSlidesChange}
          readOnly={readOnly}
          heyGenVideoMode={heyGenVideoMode}
          spokenScript={effectiveSpokenScript}
          onSpokenScriptChange={heyGenVideoMode && !readOnly ? onSpokenScriptChange : undefined}
          onCurrentSlideChange={onCarouselSlideChange}
          copySidePanel={carouselCopySidePanel}
          previewSidePanel={carouselPreviewSidePanel}
          mimicCopyEditor={Boolean(carouselCopySidePanel)}
          activeSlideIndex={carouselActiveSlideIndex}
          referenceSlideUrl={referenceSlideUrl}
          projectHandle={projectHandle}
          caption={caption}
          onCaptionChange={onCaptionChange}
          activeTextBlockIndex={activeTextBlockIndex}
          onActiveTextBlockIndexChange={onActiveTextBlockIndexChange}
          onDeleteSlide={onDeleteSlide ? () => onDeleteSlide(carouselActiveSlideIndex ?? 1) : undefined}
          onRegenerateSlide={onRegenerateSlide ? () => onRegenerateSlide(carouselActiveSlideIndex ?? 1) : undefined}
          onRegenerateAllSlides={onRegenerateAllSlides}
          regenerateSlideBusy={regenerateSlideBusy}
          mimicRegenerationNote={mimicRegenerationNote}
          onMimicRegenerationNoteChange={onMimicRegenerationNoteChange}
          mimicTemplateBg={mimicTemplateBg}
          mimicFullBleed={mimicFullBleed}
          onMimicLayoutTextBlockChange={onMimicLayoutTextBlockChange}
          layoutSlideBadges={layoutSlideBadges}
          slideRenderStatuses={slideRenderStatuses}
          assetRefreshKey={assetRefreshKey}
        />
      </div>
    );
  }

  if (showFullVideo) {
    const refVideo = referenceVideoUrl?.trim() ?? "";
    const refSlide = referenceSlideUrl?.trim() ?? "";
    const showMimicCompare = Boolean(refVideo || refSlide);
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: carouselPreviewSidePanel ? "minmax(0, 1fr) minmax(260px, 340px)" : "1fr",
          gap: 16,
          alignItems: "start",
        }}
      >
        <div className="card">
        {showMimicCompare ? (
          <p className="filter-label mimic-compare-row__heading" style={{ marginBottom: 8 }}>
            Original vs generated
          </p>
        ) : (
          <p style={{ fontSize: 13, fontWeight: 500, marginBottom: 8 }}>Video preview</p>
        )}
        {refVideo ? (
          <div
            className="mimic-compare-frame"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 0.42fr) minmax(0, 0.58fr)",
              gap: 1,
              background: "var(--border)",
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid var(--border)",
            }}
          >
            <div className="mimic-compare-pane mimic-compare-pane--original">
              <span className="mimic-compare-pane__label">Original</span>
              <video
                src={refVideo}
                controls
                playsInline
                style={{ width: "100%", maxHeight: "70vh", objectFit: "contain", background: "#000" }}
              />
            </div>
            <div className="mimic-compare-pane mimic-compare-pane--generated">
              <span className="mimic-compare-pane__label">Generated</span>
              <VideoWithBrandOverlays
                src={fullBleedVideoUrl}
                logoUrl={videoBrandOverlay?.logoUrl}
                logoPosition={videoBrandOverlay?.logoPosition}
                frameUrl={videoBrandOverlay?.frameUrl}
                style={{ width: "100%", maxHeight: "70vh" }}
                onError={() => setVideoLoadFailed(true)}
              />
            </div>
          </div>
        ) : refSlide ? (
          <div
            className="mimic-compare-frame"
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0, 0.42fr) minmax(0, 0.58fr)",
              gap: 1,
              background: "var(--border)",
              borderRadius: 8,
              overflow: "hidden",
              border: "1px solid var(--border)",
            }}
          >
            <div className="mimic-compare-pane mimic-compare-pane--original">
              <span className="mimic-compare-pane__label">Reference</span>
              <img
                src={refSlide}
                alt="Top-performer reference"
                style={{ width: "100%", maxHeight: "70vh", objectFit: "contain", background: "#111" }}
              />
            </div>
            <div className="mimic-compare-pane mimic-compare-pane--generated">
              <span className="mimic-compare-pane__label">Generated</span>
              <VideoWithBrandOverlays
                src={fullBleedVideoUrl}
                logoUrl={videoBrandOverlay?.logoUrl}
                logoPosition={videoBrandOverlay?.logoPosition}
                frameUrl={videoBrandOverlay?.frameUrl}
                style={{ width: "100%", maxHeight: "70vh" }}
                onError={() => setVideoLoadFailed(true)}
              />
            </div>
          </div>
        ) : (
          <VideoWithBrandOverlays
            src={fullBleedVideoUrl}
            logoUrl={videoBrandOverlay?.logoUrl}
            logoPosition={videoBrandOverlay?.logoPosition}
            frameUrl={videoBrandOverlay?.frameUrl}
            style={{ maxHeight: "70vh", width: "100%", borderRadius: 8 }}
            onError={() => setVideoLoadFailed(true)}
          />
        )}
        <div className="preview-action-row mt-3">
          <a href={fullBleedVideoUrl} target="_blank" rel="noopener noreferrer">
            Open video in new tab
          </a>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fg-secondary)" }}>
              Open content link
            </a>
          )}
          {previewToolbar}
        </div>
        {onCaptionChange != null || onHashtagsChange != null ? (
          <div
            style={{
              marginTop: 16,
              padding: 16,
              background: "var(--card)",
              border: "1px solid var(--border)",
              borderRadius: 8,
            }}
          >
            <p style={{ fontSize: 13, fontWeight: 600, margin: "0 0 10px" }}>Post copy</p>
            {onCaptionChange != null ? (
              <div style={{ marginBottom: 12 }}>
                <label className="filter-label">Caption</label>
                <textarea
                  value={caption ?? ""}
                  onChange={(e) => onCaptionChange(e.target.value)}
                  rows={5}
                  readOnly={readOnly}
                  placeholder="Post caption for publish"
                  style={{ width: "100%", minHeight: 100, marginTop: 6, lineHeight: 1.45 }}
                />
              </div>
            ) : null}
            {onHashtagsChange != null ? (
              <div>
                <label className="filter-label">Hashtags</label>
                <textarea
                  value={hashtags ?? ""}
                  onChange={(e) => onHashtagsChange(e.target.value)}
                  rows={2}
                  readOnly={readOnly}
                  placeholder="#hashtags"
                  style={{ width: "100%", minHeight: 64, marginTop: 6 }}
                />
              </div>
            ) : null}
          </div>
        ) : null}
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
        {carouselPreviewSidePanel ? <div>{carouselPreviewSidePanel}</div> : null}
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
        <div className="preview-action-row mt-3">
          <a href={singleImageSrc} target="_blank" rel="noopener noreferrer">
            Open image in new tab
          </a>
          {previewUrl && (
            <a href={previewUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--fg-secondary)" }}>
              Open content link
            </a>
          )}
          {previewToolbar}
        </div>
      </div>
    );
  }

  // Skip the legacy carousel-JSON dump for video AND image flows: HeyGen / video-script jobs — and
  // FLOW_IMG_* product ads — sometimes carry a single placeholder cover slide in
  // `generated_slides_json`, which would otherwise hide the real media URL behind an empty-looking
  // carousel preview on the Publish page.
  if (slides && slides.length > 0 && !isVideoFormat && !isImageFormat) {
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
  if (!fullBleedVideoUrl && mediaRows.length === 0) {
    reasons.push(
      isImageFormat
        ? "no image URL on this job yet — FLOW_IMG_* generation is not wired yet"
        : isVideoFormat
          ? "no video URL on this job yet"
          : "no video or image URL from task or assets"
    );
  } else if (videoLoadFailed) {
    reasons.push("video URL did not load (signed URL may have expired or asset is missing)");
  }
  if (!isVideoFormat && !isImageFormat && !slidesJson) reasons.push("no generated_slides_json");

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
