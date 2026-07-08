"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import {
  mimicSlideFieldsFromTextBlocks,
  mimicTextBlockEditorLabel,
  mimicTextBlockDisplayText,
  isMimicHandleTextBlock,
  resolveMimicTextBlocksForSlide,
} from "@/lib/carousel-slides";
import {
  applyMimicTemplateBgFieldEdit,
  resolveMimicTemplateBgEditorFieldsForSlide,
  type MimicTemplateBgEditorField,
} from "@/lib/mimic-template-bg";
import { isVideoUrl } from "@/lib/media-url";
import {
  layoutBadgeEmoji,
  layoutBadgeLabel,
  type MimicLayoutSlideBadge,
} from "@/lib/mimic-layout-qc";
import { slideRenderStatusClass, slideRenderStatusLabel, type SlideRenderState } from "@/lib/slide-render-status";

const SWIPE_THRESHOLD = 50;

/** Initial textarea rows from copy length; user can drag the corner to grow further. */
function mimicCopyTextareaRows(text: string, opts?: { min?: number; max?: number }): number {
  const min = opts?.min ?? 3;
  const max = opts?.max ?? 24;
  const lines = text.split("\n").length;
  const chars = text.trim().length;
  const byChars = chars > 0 ? Math.ceil(chars / 72) : min;
  return Math.min(max, Math.max(min, lines, byChars));
}

function stopTextareaBubble(e: React.MouseEvent | React.FocusEvent) {
  e.stopPropagation();
}

export interface CarouselMediaItem {
  url: string;
  kind: "image" | "video";
}

/** Live re-render via review API + remote template (reflects font_scale and edited copy). */
export interface CarouselLivePreviewOptions {
  template: string;
  taskId: string;
  runId: string;
  fontScale: string;
  instagramHandle?: string;
  getPayload: () => Record<string, unknown>;
  /** Per-slide Qwen background plate for live preview (1-based slide index). */
  getBackgroundUrl?: (slideIndex1Based: number) => string | undefined;
  /** Saved DocAI layer overrides for the slide (template_bg layout editor). */
  getDocAiLayerPositions?: (slideIndex1Based: number) => Record<string, unknown>[] | undefined;
  /** Bumped when layout positions change so compare preview re-renders. */
  layoutRevisionKey?: number;
}

export interface CarouselSliderProps {
  slides: NormalizedSlide[];
  /** @deprecated Prefer `mediaItems` for mixed image/video decks. */
  imageUrls?: string[];
  /** Per-slide media aligned by index; falls back to `imageUrls[i]` when missing. */
  mediaItems?: (CarouselMediaItem | null | undefined)[];
  /** When set (carousel + template known), fetches a fresh PNG for the current slide so font scale and copy edits are visible. */
  livePreview?: CarouselLivePreviewOptions | null;
  onSlidesChange?: (slides: NormalizedSlide[]) => void;
  className?: string;
  readOnly?: boolean;
  /**
   * HeyGen single-take video flows: hide per-slide headline/body/save and show one spoken script under the player.
   * Carousel (non-HeyGen) flows keep the default slide copy editing.
   */
  heyGenVideoMode?: boolean;
  spokenScript?: string;
  onSpokenScriptChange?: (v: string) => void;
  /** Fires when the user navigates to another slide (1-based index). */
  onCurrentSlideChange?: (slideIndex1Based: number) => void;
  /** Optional panel rendered beside the carousel (e.g. mimic layer editor). */
  copySidePanel?: ReactNode;
  /** Optional panel rendered beside the slide preview (e.g. caption editor) to fill dead space. */
  previewSidePanel?: ReactNode;
  /** When true, show expanded copy fields for mimic carousel editing. */
  mimicCopyEditor?: boolean;
  /** When set, carousel navigation follows this 1-based slide index (e.g. from layout editor). */
  activeSlideIndex?: number;
  /** Original reference frame for side-by-side compare (mimic flows). */
  referenceSlideUrl?: string;
  /** Project Instagram handle — shown on handle text blocks. */
  projectHandle?: string;
  /** Generated post caption — always visible in mimic review. */
  caption?: string;
  onCaptionChange?: (value: string) => void;
  /** Active text block index (0-based) — syncs with layout editor boxes. */
  activeTextBlockIndex?: number | null;
  onActiveTextBlockIndexChange?: (blockIndex: number | null) => void;
  onDeleteSlide?: () => void;
  onRegenerateSlide?: () => void;
  onRegenerateAllSlides?: () => void;
  regenerateSlideBusy?: boolean;
  /** Optional note appended to the mimic image prompt on slide regenerate. */
  mimicRegenerationNote?: string;
  onMimicRegenerationNoteChange?: (value: string) => void;
  /** template_bg listicle — headline/body fields instead of OCR clusters. */
  mimicTemplateBg?: boolean;
  /** Full-bleed mimic: layout editor highlights boxes; copy fields are per phrase (copy slot). */
  mimicFullBleed?: boolean;
  onMimicLayoutTextBlockChange?: (blockIndex: number, text: string) => void;
  /** Per-slide layout QA badges from `generation_payload.layout_qc` (0-based index). */
  layoutSlideBadges?: Record<number, MimicLayoutSlideBadge[]>;
  /** Per-slide render pipeline status (0-based index via slideIndex - 1). */
  slideRenderStatuses?: SlideRenderState[];
  /** Bumped after asset refetch — remounts generated preview images. */
  assetRefreshKey?: number;
}

export function CarouselSlider({
  slides: initialSlides,
  imageUrls = [],
  mediaItems,
  livePreview = null,
  onSlidesChange,
  className,
  readOnly = false,
  heyGenVideoMode = false,
  spokenScript = "",
  onSpokenScriptChange,
  onCurrentSlideChange,
  copySidePanel,
  previewSidePanel,
  mimicCopyEditor = false,
  activeSlideIndex,
  referenceSlideUrl,
  projectHandle = "",
  caption = "",
  onCaptionChange,
  activeTextBlockIndex = null,
  onActiveTextBlockIndexChange,
  onDeleteSlide,
  onRegenerateSlide,
  onRegenerateAllSlides,
  regenerateSlideBusy = false,
  mimicRegenerationNote = "",
  onMimicRegenerationNoteChange,
  mimicTemplateBg = false,
  mimicFullBleed = false,
  onMimicLayoutTextBlockChange,
  layoutSlideBadges,
  slideRenderStatuses,
  assetRefreshKey = 0,
}: CarouselSliderProps) {
  const [slides, setSlides] = useState<NormalizedSlide[]>(initialSlides);
  // Slide index is controlled by the parent (single source of truth) whenever
  // `activeSlideIndex` is supplied. Internal state is only the uncontrolled fallback.
  const isSlideControlled = activeSlideIndex != null;
  const [internalIndex, setInternalIndex] = useState(0);
  const currentIndex = isSlideControlled
    ? Math.max(0, Math.min(Math.max(0, slides.length - 1), (activeSlideIndex as number) - 1))
    : Math.min(internalIndex, Math.max(0, slides.length - 1));
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  /** 1-based slide index that `liveUrl` was rendered for — prevents showing a prior slide's PNG after navigation. */
  const [livePreviewSlide, setLivePreviewSlide] = useState<number | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const livePreviewCacheRef = useRef<Map<string, string>>(new Map());
  const touchStartX = useRef<number | null>(null);
  const onCurrentSlideChangeRef = useRef(onCurrentSlideChange);
  onCurrentSlideChangeRef.current = onCurrentSlideChange;

  // Single owner of the upward `onSlidesChange` emit. We stash the serialized payload
  // so the sync effect below can recognise the parent echoing our own edit back as
  // `initialSlides` and NOT clobber local state (which caused cursor jumps and lost
  // trailing characters while typing).
  const onSlidesChangeRef = useRef(onSlidesChange);
  onSlidesChangeRef.current = onSlidesChange;
  const lastEmittedSlidesKeyRef = useRef<string>("");
  const emitSlides = useCallback((next: NormalizedSlide[]) => {
    lastEmittedSlidesKeyRef.current = JSON.stringify(next);
    onSlidesChangeRef.current?.(next);
  }, []);

  const slidesKey = useMemo(() => JSON.stringify(slides), [slides]);

  // Navigate: when controlled, only request the change upward; the new value flows
  // back through `activeSlideIndex`. This one-directional flow removes the ping-pong.
  const goToIndex = useCallback(
    (i: number) => {
      const clamped = Math.max(0, Math.min(Math.max(0, slides.length - 1), i));
      if (!isSlideControlled) setInternalIndex(clamped);
      onCurrentSlideChangeRef.current?.(clamped + 1);
    },
    [isSlideControlled, slides.length]
  );

  useEffect(() => {
    // If `initialSlides` is just the parent echoing back the edit we emitted, keep our
    // local state (and caret / "Saved" badge) intact. Only adopt genuine external changes.
    if (JSON.stringify(initialSlides) === lastEmittedSlidesKeyRef.current) return;
    setSlides(initialSlides);
    setInternalIndex((i) => Math.min(i, Math.max(0, initialSlides.length - 1)));
    setSavedAt(null);
  }, [initialSlides]);

  useEffect(() => {
    if (heyGenVideoMode || readOnly || !livePreview?.template) {
      setLiveUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setLivePreviewSlide(null);
      setLiveErr(null);
      setLiveBusy(false);
      livePreviewCacheRef.current.clear();
      return;
    }

    const slideIndex1Based = currentIndex + 1;
    const cacheKey = `${slideIndex1Based}:${livePreview?.layoutRevisionKey ?? ""}:${livePreview?.fontScale ?? "1"}`;
    const cachedUrl = livePreviewCacheRef.current.get(cacheKey);
    if (cachedUrl) {
      setLiveUrl((prev) => {
        if (prev && prev !== cachedUrl) URL.revokeObjectURL(prev);
        return cachedUrl;
      });
      setLivePreviewSlide(slideIndex1Based);
      setLiveBusy(false);
      setLiveErr(null);
      return;
    }

    // Keep the last stored asset visible while the renderer works — do not blank the pane.
    setLivePreviewSlide(null);

    let cancelled = false;
    const handle = window.setTimeout(() => {
      void (async () => {
        setLiveBusy(true);
        setLiveErr(null);
        try {
          const payload = livePreview.getPayload();
          const fs = Number(livePreview.fontScale);
          if (Number.isFinite(fs) && fs > 0) {
            (payload as Record<string, unknown>).font_scale = fs;
          }
          const docai_layer_positions = livePreview.getDocAiLayerPositions?.(slideIndex1Based);
          const res = await fetch("/api/renderer/preview-live-slide", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              template: livePreview.template,
              slide_index: slideIndex1Based,
              task_id: livePreview.taskId,
              run_id: livePreview.runId,
              instagram_handle: livePreview.instagramHandle ?? "",
              background_image_url: livePreview.getBackgroundUrl?.(slideIndex1Based) ?? "",
              ...(docai_layer_positions?.length ? { docai_layer_positions } : {}),
              payload,
            }),
          });
          if (!res.ok) {
            const t = await res.text();
            throw new Error(t.slice(0, 200) || res.statusText);
          }
          const blob = await res.blob();
          if (cancelled) return;
          const url = URL.createObjectURL(blob);
          livePreviewCacheRef.current.set(cacheKey, url);
          if (livePreviewCacheRef.current.size > 16) {
            const firstKey = livePreviewCacheRef.current.keys().next().value as string | undefined;
            if (firstKey) {
              const old = livePreviewCacheRef.current.get(firstKey);
              livePreviewCacheRef.current.delete(firstKey);
              if (old) URL.revokeObjectURL(old);
            }
          }
          setLiveUrl((prev) => {
            if (prev && prev !== url) URL.revokeObjectURL(prev);
            return url;
          });
          setLivePreviewSlide(slideIndex1Based);
        } catch (e) {
          if (!cancelled) setLiveErr(e instanceof Error ? e.message : "Live preview failed");
        } finally {
          if (!cancelled) setLiveBusy(false);
        }
      })();
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [
    heyGenVideoMode,
    readOnly,
    livePreview,
    livePreview?.fontScale,
    livePreview?.layoutRevisionKey,
    currentIndex,
    slidesKey,
    assetRefreshKey,
  ]);

  const updateSlide = useCallback(
    (
      index: number,
      patch: Partial<Pick<NormalizedSlide, "headline" | "body" | "handle" | "extras" | "on_slide_lines" | "text_blocks">>
    ) => {
      setSavedAt(null);
      setSlides((prev) => {
        const next = prev.map((s, i) => (i === index ? { ...s, ...patch } : s));
        emitSlides(next);
        return next;
      });
    },
    [emitSlides]
  );

  const updateExtraField = useCallback(
    (index: number, key: string, value: string) => {
      setSavedAt(null);
      setSlides((prev) => {
        const next = prev.map((s, i) => {
          if (i !== index) return s;
          const extras = { ...(s.extras ?? {}) };
          const t = value.trim();
          if (t) extras[key] = t;
          else delete extras[key];
          return { ...s, extras: Object.keys(extras).length ? extras : undefined };
        });
        emitSlides(next);
        return next;
      });
    },
    [emitSlides]
  );

  const updateMimicTemplateBgField = useCallback(
    (slideIndex: number, field: MimicTemplateBgEditorField, text: string, blockIndex?: number) => {
      setSavedAt(null);
      setSlides((prev) => {
        const next = prev.map((s, i) =>
          i === slideIndex
            ? applyMimicTemplateBgFieldEdit(s, slideIndex + 1, prev.length, field.key, text)
            : s
        );
        emitSlides(next);
        return next;
      });
      if (onMimicLayoutTextBlockChange) {
        const idx =
          blockIndex ??
          resolveMimicTemplateBgEditorFieldsForSlide(
            slides[slideIndex] ?? { index: slideIndex, type: "body", headline: "", body: "", handle: "" },
            slideIndex + 1,
            slides.length,
            projectHandle
          ).findIndex((f) => f.key === field.key);
        if (idx >= 0) onMimicLayoutTextBlockChange(idx, text);
      }
    },
    [emitSlides, onMimicLayoutTextBlockChange, slides, projectHandle]
  );

  const updateMimicTextBlock = useCallback(
    (slideIndex: number, blockIndex: number, text: string) => {
      if (mimicTemplateBg) {
        const slideAt = slides[slideIndex];
        if (!slideAt) return;
        const fields = resolveMimicTemplateBgEditorFieldsForSlide(
          slideAt,
          slideIndex + 1,
          slides.length,
          projectHandle
        );
        const field = fields[blockIndex];
        if (!field) return;
        updateMimicTemplateBgField(slideIndex, field, text, blockIndex);
        return;
      }
      if (mimicFullBleed && onMimicLayoutTextBlockChange) {
        onMimicLayoutTextBlockChange(blockIndex, text);
      }
      setSavedAt(null);
      setSlides((prev) => {
        const next = prev.map((s, i) => {
          if (i !== slideIndex) return s;
          const blocks = resolveMimicTextBlocksForSlide(s);
          while (blocks.length <= blockIndex) blocks.push({ role: "body", text: "" });
          const nextBlocks = blocks.map((b, bi) => (bi === blockIndex ? { ...b, text } : b));
          const fields = mimicSlideFieldsFromTextBlocks(nextBlocks);
          return {
            ...s,
            text_blocks: nextBlocks,
            on_slide_lines: fields.on_slide_lines,
            headline: fields.headline,
            body: fields.body,
          };
        });
        emitSlides(next);
        return next;
      });
    },
    [mimicFullBleed, mimicTemplateBg, onMimicLayoutTextBlockChange, emitSlides, slides, updateMimicTemplateBgField, projectHandle]
  );

  const handleSaveSlide = useCallback(() => {
    emitSlides(slides);
    setSavedAt(currentIndex);
  }, [currentIndex, emitSlides, slides]);

  const goPrev = useCallback(() => goToIndex(currentIndex - 1), [goToIndex, currentIndex]);
  const goNext = useCallback(() => goToIndex(currentIndex + 1), [goToIndex, currentIndex]);

  const onTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.targetTouches[0].clientX;
  }, []);
  const onTouchEnd = useCallback(
    (e: React.TouchEvent) => {
      if (touchStartX.current == null) return;
      const delta = touchStartX.current - e.changedTouches[0].clientX;
      touchStartX.current = null;
      if (delta > SWIPE_THRESHOLD) goNext();
      else if (delta < -SWIPE_THRESHOLD) goPrev();
    },
    [goNext, goPrev]
  );

  const slide = slides[currentIndex];
  const mimicTemplateBgFields = useMemo(
    () =>
      mimicCopyEditor && mimicTemplateBg
        ? resolveMimicTemplateBgEditorFieldsForSlide(
            slide,
            currentIndex + 1,
            slides.length,
            projectHandle
          )
        : [],
    [mimicCopyEditor, mimicTemplateBg, slide, currentIndex, slides.length, projectHandle]
  );
  const mimicTextBlocks = useMemo(() => {
    if (!mimicCopyEditor) return [];
    if (mimicTemplateBg) {
      return resolveMimicTemplateBgEditorFieldsForSlide(
        slide,
        currentIndex + 1,
        slides.length,
        projectHandle
      ).map((f) => ({
        role: f.role,
        text: f.text,
      }));
    }
    return resolveMimicTextBlocksForSlide(slide);
  }, [mimicCopyEditor, mimicTemplateBg, slide, currentIndex, slides.length, projectHandle]);
  const fromMedia = mediaItems?.[currentIndex];
  const fallbackUrl = imageUrls[currentIndex]?.trim();
  const mediaUrl = (fromMedia?.url ?? fallbackUrl ?? "").trim();
  const mediaKind: "image" | "video" =
    fromMedia?.kind ?? (mediaUrl && isVideoUrl(mediaUrl) ? "video" : "image");
  const livePngUrl =
    !heyGenVideoMode &&
    livePreview?.template &&
    liveUrl &&
    livePreviewSlide === currentIndex + 1 &&
    mediaKind === "image"
      ? liveUrl
      : null;
  const total = slides.length;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex < total - 1;
  const currentRenderState = slideRenderStatuses?.find((s) => s.slideIndex === currentIndex + 1);
  const generatedPreviewPending = currentRenderState?.status === "pending";
  const generatedPreviewFailed = currentRenderState?.status === "failed";
  const storedSlideImageUrl =
    !heyGenVideoMode && mediaKind === "image" && mediaUrl.trim() ? mediaUrl : "";

  const renderGeneratedPreviewImage = (imgKey: string, className: string) => (
    <div className={`mimic-compare-pane__img-stack${liveBusy && livePreview?.template ? " mimic-compare-pane__img-stack--pending" : ""}`}>
      <img
        key={imgKey}
        src={livePngUrl ?? storedSlideImageUrl}
        alt={`Slide ${currentIndex + 1} preview`}
        className={className}
        draggable={false}
        {...(storedSlideImageUrl && !livePngUrl ? { referrerPolicy: "no-referrer" as const } : {})}
      />
      {liveBusy && livePreview?.template && !heyGenVideoMode ? (
        <span className="mimic-compare-pane__live-badge">Updating live preview…</span>
      ) : null}
    </div>
  );

  const renderMimicCompareRow = (placement: "above" | "below") => {
    if (!mimicCopyEditor) return null;
    if (placement !== "above") return null;
    const vertical = Boolean(copySidePanel);
    const hasReference = Boolean(referenceSlideUrl?.trim());
    return (
      <div className={previewSidePanel && !copySidePanel ? "mimic-preview-row" : undefined}>
        {vertical ? (
          <p className="filter-label mimic-compare-row__heading">Original vs generated</p>
        ) : null}
        <div
          className={`flex items-center gap-2 mimic-compare-row${vertical ? " mimic-compare-row--vertical" : ""}`}
          style={{ marginBottom: vertical ? 12 : 12, marginTop: vertical ? 0 : undefined }}
        >
          <button
            type="button"
            aria-label="Previous slide"
            onClick={goPrev}
            disabled={!canPrev}
            className="mimic-compare-row__nav"
          >
            &#8249;
          </button>
          <div
            className={
              vertical
                ? `mimic-compare-frame mimic-compare-frame--vertical${hasReference ? "" : " mimic-compare-frame--generated-only"}`
                : "mimic-compare-frame"
            }
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            {hasReference ? (
              <div className="mimic-compare-pane mimic-compare-pane--original">
                <span className="mimic-compare-pane__label">Original</span>
                <img
                  key={`ref-${currentIndex}`}
                  src={referenceSlideUrl}
                  alt={`Original slide ${currentIndex + 1}`}
                  className="mimic-compare-pane__img"
                  draggable={false}
                  referrerPolicy="no-referrer"
                />
              </div>
            ) : null}
            <div
              className={
                hasReference ? "mimic-compare-pane mimic-compare-pane--generated" : "mimic-compare-pane mimic-compare-pane--generated mimic-compare-pane--solo"
              }
            >
              {hasReference ? <span className="mimic-compare-pane__label">Generated</span> : null}
              {livePngUrl || storedSlideImageUrl ? (
                renderGeneratedPreviewImage(
                  `gen-${currentIndex}-${assetRefreshKey}-${livePngUrl ? "live" : storedSlideImageUrl}`,
                  "mimic-compare-pane__img"
                )
              ) : liveBusy && livePreview?.template && !heyGenVideoMode ? (
                <span className="mimic-compare-pane__empty">Starting live preview…</span>
              ) : generatedPreviewPending ? (
                <span className="mimic-compare-pane__empty">Regenerating image…</span>
              ) : generatedPreviewFailed ? (
                <span className="mimic-compare-pane__empty">
                  {currentRenderState?.error ?? "Image regenerate failed on this slide."}
                </span>
              ) : mediaUrl ? (
                mediaKind === "video" ? (
                  <video
                    key={`vid-${currentIndex}-${assetRefreshKey}`}
                    src={mediaUrl}
                    controls
                    playsInline
                    className="mimic-compare-pane__media"
                  />
                ) : (
                  <img
                    key={`gen-${currentIndex}-${assetRefreshKey}-${mediaUrl}`}
                    src={mediaUrl}
                    alt={`Slide ${currentIndex + 1}`}
                    loading="lazy"
                    className="mimic-compare-pane__img"
                    draggable={false}
                    referrerPolicy="no-referrer"
                  />
                )
              ) : (
                <span className="mimic-compare-pane__empty">No rendered asset for this slide</span>
              )}
            </div>
          </div>
          <button
            type="button"
            aria-label="Next slide"
            onClick={goNext}
            disabled={!canNext}
            className="mimic-compare-row__nav"
          >
            &#8250;
          </button>
        </div>
        {previewSidePanel && !copySidePanel ? <div className="mimic-preview-side">{previewSidePanel}</div> : null}
      </div>
    );
  };

  if (slides.length === 0) {
    return (
      <div className={`card ${className ?? ""}`}>
        <p style={{ fontSize: 13, color: "var(--fg-secondary)" }}>No slides in this carousel.</p>
      </div>
    );
  }

  return (
    <div className={`card ${className ?? ""}${mimicCopyEditor ? " mimic-carousel-review" : ""}`}>
      <div className="flex items-center justify-between mimic-carousel-review__header">
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>{heyGenVideoMode ? "Video preview" : "Carousel slides"}</h3>
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Slide {currentIndex + 1} of {total}</span>
          {mimicCopyEditor && onRegenerateSlide ? (
            <>
              <input
                type="text"
                className="mimic-regen-route__note-input"
                value={mimicRegenerationNote}
                onChange={(e) =>
                  onMimicRegenerationNoteChange?.(e.target.value.slice(0, 400))
                }
                placeholder="Regen note (optional)"
                maxLength={400}
                disabled={regenerateSlideBusy || !onMimicRegenerationNoteChange}
                title="Short instruction appended to the image prompt for this regenerate"
              />
              <button
                type="button"
                className="btn-secondary btn-sm"
                disabled={regenerateSlideBusy}
                onClick={onRegenerateSlide}
              >
                {regenerateSlideBusy ? "Regenerating…" : "Regenerate"}
              </button>
              {total > 1 && onRegenerateAllSlides ? (
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  disabled={regenerateSlideBusy}
                  onClick={onRegenerateAllSlides}
                  title={`Regenerate all ${total} slides (billed)`}
                >
                  All slides
                </button>
              ) : null}
            </>
          ) : null}
          {mimicCopyEditor && onDeleteSlide && total > 1 ? (
            <button type="button" className="btn-danger-ghost btn-sm" onClick={onDeleteSlide}>
              Delete slide
            </button>
          ) : null}
        </div>
      </div>

      {total > 1 && !heyGenVideoMode ? (
        <div className="carousel-thumb-strip" role="tablist" aria-label="Slide thumbnails">
          {slides.map((_, i) => {
            const fromM = mediaItems?.[i];
            const url = (fromM?.url ?? imageUrls[i] ?? "").trim();
            const kind: "image" | "video" =
              fromM?.kind ?? (url && isVideoUrl(url) ? "video" : "image");
            const badges = layoutSlideBadges?.[i] ?? [];
            const primaryBadge = badges.find((b) => b !== "pass") ?? badges[0];
            const renderState = slideRenderStatuses?.find((s) => s.slideIndex === i + 1);
            const renderStatus = renderState?.status;
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={i === currentIndex}
                aria-label={
                  renderStatus && renderStatus !== "ready"
                    ? `Slide ${i + 1} — ${slideRenderStatusLabel(renderStatus)}`
                    : primaryBadge && primaryBadge !== "pass"
                      ? `Slide ${i + 1} — ${layoutBadgeLabel(primaryBadge)}`
                      : `Slide ${i + 1}`
                }
                className={`carousel-thumb-strip__btn${i === currentIndex ? " carousel-thumb-strip__btn--active" : ""}${renderStatus && renderStatus !== "ready" ? ` carousel-thumb-strip__btn--${renderStatus}` : ""}`}
                onClick={() => goToIndex(i)}
                style={{ position: "relative" }}
                title={renderState?.error ?? undefined}
              >
                {renderStatus && renderStatus !== "ready" ? (
                  <span className={slideRenderStatusClass(renderStatus)} aria-hidden>
                    {slideRenderStatusLabel(renderStatus)}
                  </span>
                ) : primaryBadge ? (
                  <span
                    className={`carousel-thumb-strip__badge${
                      primaryBadge === "pass" ? " carousel-thumb-strip__badge--pass" : " carousel-thumb-strip__badge--warn"
                    }`}
                    title={badges.map(layoutBadgeLabel).join(", ")}
                    aria-hidden
                  >
                    {layoutBadgeEmoji(primaryBadge)}
                  </span>
                ) : null}
                {url ? (
                  kind === "video" ? (
                    <video src={url} muted playsInline preload="metadata" />
                  ) : (
                    <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  )
                ) : (
                  <span style={{ fontSize: 11, color: "var(--muted)", padding: 4 }}>{i + 1}</span>
                )}
              </button>
            );
          })}
        </div>
      ) : null}

      {renderMimicCompareRow("above")}

      {!copySidePanel && !heyGenVideoMode && livePreview?.template && (
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.4 }}>
          {liveBusy
            ? storedSlideImageUrl
              ? "Showing last reprint while live preview renders…"
              : "Rendering live preview…"
            : liveErr
              ? `Live preview unavailable (${liveErr}). Showing stored asset if available.`
              : livePngUrl
                ? mimicTemplateBg
                  ? "Generated pane shows live layout + copy (matches the editor). Thumbnails stay on last reprint until you reprint."
                  : "Live preview: font scale + slide copy (matches template). Stored thumbnails are from the last pipeline render."
                : storedSlideImageUrl
                  ? "Stored slide shown — live preview will replace it when ready."
                  : "Starting live preview…"}
        </p>
      )}

      {!readOnly && !heyGenVideoMode && (
        <div
          className={copySidePanel ? "carousel-edit-three-col" : undefined}
          style={{ marginBottom: 8 }}
        >
          <div className="carousel-edit-copy">
          {mimicCopyEditor && mimicTemplateBg ? (
            <div className="mimic-text-blocks mimic-text-blocks--compact">
              <label className="filter-label">Slide copy</label>
              <p className="mimic-text-blocks__hint">
                Listicle format — title and body per slide (cover uses subtitle; last slide uses CTA + handle).
              </p>
              <div className="mimic-text-blocks__list">
                {mimicTemplateBgFields.map((field, bi) => {
                  const isHandle = field.role === "handle";
                  const linked = activeTextBlockIndex === bi;
                  return (
                    <div
                      key={field.key}
                      className={`mimic-text-block-field${linked ? " mimic-text-block-field--linked" : ""}`}
                      onClick={() => onActiveTextBlockIndexChange?.(bi)}
                    >
                      <label className="filter-label mimic-text-block-field__label">
                        <span>{field.label}</span>
                      </label>
                      <textarea
                        value={field.text}
                        onChange={(e) => {
                          updateMimicTemplateBgField(currentIndex, field, e.target.value, bi);
                        }}
                        rows={mimicCopyTextareaRows(field.text, { min: isHandle ? 1 : 3, max: isHandle ? 3 : 24 })}
                        placeholder={`${field.label}…`}
                        className="mimic-text-block-field__input mimic-text-block-field__input--grow"
                        onFocus={(e) => {
                          stopTextareaBubble(e);
                          onActiveTextBlockIndexChange?.(bi);
                        }}
                        onClick={stopTextareaBubble}
                        onMouseDown={stopTextareaBubble}
                      />
                      {isHandle ? (
                        <p className="mimic-text-block-field__note">
                          {projectHandle.trim()
                            ? "Defaults to project handle — edit to override this slide."
                            : "Shown on the handle box at the bottom of the CTA slide."}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : mimicCopyEditor && (mimicFullBleed || mimicTextBlocks.length > 0) ? (
            <div className="mimic-text-blocks mimic-text-blocks--compact">
              <label className="filter-label">Text phrases ({mimicTextBlocks.length})</label>
              {mimicFullBleed ? (
                <p className="mimic-text-blocks__hint mimic-text-blocks__hint--inline">
                  Edits update the layout preview. <strong>Reprint text</strong> bakes copy into images.
                </p>
              ) : null}
              <div className="mimic-text-blocks__list">
                {mimicTextBlocks.map((block, bi) => {
                  const isHandle = isMimicHandleTextBlock(block);
                  const displayText = mimicTextBlockDisplayText(block, projectHandle);
                  const linked = activeTextBlockIndex === bi;
                  const useNeutralLabels = mimicFullBleed;
                  return (
                  <div
                    key={bi}
                    className={`mimic-text-block-field${linked ? " mimic-text-block-field--linked" : ""}`}
                    onClick={() => onActiveTextBlockIndexChange?.(bi)}
                  >
                    <label className="filter-label mimic-text-block-field__label">
                      <span>{mimicTextBlockEditorLabel(block, bi, mimicTextBlocks.length, { fullBleed: useNeutralLabels })}</span>
                    </label>
                    <textarea
                      value={isHandle && projectHandle.trim() && !mimicTemplateBg ? displayText : block.text}
                      readOnly={isHandle && Boolean(projectHandle.trim()) && !mimicTemplateBg}
                      onChange={(e) => {
                        if (isHandle && projectHandle.trim() && !mimicTemplateBg) return;
                        updateMimicTextBlock(currentIndex, bi, e.target.value);
                      }}
                      rows={mimicCopyTextareaRows(isHandle ? displayText : block.text, { min: 2, max: 16 })}
                      placeholder="On-slide copy for this box"
                      className="mimic-text-block-field__input mimic-text-block-field__input--grow"
                      onFocus={(e) => {
                        stopTextareaBubble(e);
                        onActiveTextBlockIndexChange?.(bi);
                      }}
                      onClick={stopTextareaBubble}
                      onMouseDown={stopTextareaBubble}
                    />
                    {isHandle && projectHandle.trim() && !mimicTemplateBg ? (
                      <p className="mimic-text-block-field__note">
                        Always prints project handle on reprint
                      </p>
                    ) : null}
                  </div>
                );
                })}
              </div>
            </div>
          ) : mimicCopyEditor ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Loading text boxes…</p>
          ) : (
            <>
          {(slide.type === "cover" || slide.type === "body") && (
            <>
              <div style={{ marginBottom: 10 }}>
                <label className="filter-label">{slide.type === "cover" ? "Headline / Title" : "Headline"}</label>
                <input
                  type="text"
                  value={slide.headline}
                  onChange={(e) => updateSlide(currentIndex, { headline: e.target.value })}
                  placeholder={slide.type === "cover" ? "Cover headline" : "Slide headline"}
                  style={{ fontWeight: 500 }}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="filter-label">{slide.type === "cover" ? "Subtitle / Body" : "Body"}</label>
                <textarea
                  value={slide.body}
                  onChange={(e) => updateSlide(currentIndex, { body: e.target.value })}
                  placeholder={slide.type === "cover" ? "Cover subtitle" : "Slide body text"}
                  rows={slide.type === "cover" ? 2 : 3}
                  style={{
                    minHeight: slide.type === "cover" ? 60 : 80,
                    lineHeight: 1.45,
                  }}
                />
              </div>

              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <div className="filter-label" style={{ marginBottom: 8 }}>Template microcopy</div>
                  <div className="grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  {slide.type === "cover" && (
                    <div>
                      <label className="filter-label">Brand word</label>
                      <input
                        type="text"
                        value={slide.extras?.brand_word ?? ""}
                        onChange={(e) => updateExtraField(currentIndex, "brand_word", e.target.value)}
                        placeholder="e.g. SNS"
                      />
                    </div>
                  )}
                  <div>
                    <label className="filter-label">Kicker</label>
                    <input
                      type="text"
                      value={slide.extras?.kicker ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "kicker", e.target.value)}
                      placeholder="e.g. Slide 01 / Topic"
                    />
                  </div>
                  <div>
                    <label className="filter-label">Tag</label>
                    <input
                      type="text"
                      value={slide.extras?.tag ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "tag", e.target.value)}
                      placeholder="e.g. Quick note"
                    />
                  </div>
                  <div>
                    <label className="filter-label">Note</label>
                    <input
                      type="text"
                      value={slide.extras?.note ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "note", e.target.value)}
                      placeholder="Short footer line"
                    />
                  </div>
                  <div>
                    <label className="filter-label">Panel title</label>
                    <input
                      type="text"
                      value={slide.extras?.panel_title ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "panel_title", e.target.value)}
                      placeholder={slide.type === "cover" ? "e.g. Why this matters" : "e.g. Micro-action"}
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label className="filter-label">Panel body</label>
                    <input
                      type="text"
                      value={slide.extras?.panel_body ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "panel_body", e.target.value)}
                      placeholder="Small bottom callout text"
                    />
                  </div>
                  <div>
                    <label className="filter-label">Eyebrow</label>
                    <input
                      type="text"
                      value={slide.extras?.eyebrow ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "eyebrow", e.target.value)}
                      placeholder="Upper small label"
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label className="filter-label">Bottom bar text</label>
                    <input
                      type="text"
                      value={slide.extras?.site_bar ?? slide.extras?.bottom_bar_text ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "site_bar", e.target.value)}
                      placeholder="Bottom bar text"
                    />
                  </div>
                  {slide.type === "cover" && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label className="filter-label">CTA bottom bar (fallback)</label>
                      <input
                        type="text"
                        value={slide.extras?.site_bar_cta ?? ""}
                        onChange={(e) => updateExtraField(currentIndex, "site_bar_cta", e.target.value)}
                        placeholder="Used on CTA slide if CTA Site bar is empty"
                      />
                    </div>
                  )}
                  </div>
                </div>
            </>
          )}
          {slide.type === "cta" && (
            <>
              <div style={{ marginBottom: 10 }}>
                <label className="filter-label">CTA headline</label>
                <input
                  type="text"
                  value={slide.headline}
                  onChange={(e) => updateSlide(currentIndex, { headline: e.target.value })}
                  placeholder="Large headline on the CTA slide (e.g. Continue the Journey…)"
                  style={{ fontWeight: 500 }}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="filter-label">CTA body</label>
                <textarea
                  value={slide.body}
                  onChange={(e) => updateSlide(currentIndex, { body: e.target.value })}
                  rows={5}
                  placeholder="Supporting paragraph. Add @yourbrand at the end if you want it on the slide (Core also merges project Instagram when empty)."
                  style={{ minHeight: 100 }}
                />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="filter-label">Handle / Link</label>
                <input type="text" value={slide.handle} onChange={(e) => updateSlide(currentIndex, { handle: e.target.value })} placeholder="e.g. @handle or link" />
              </div>

              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                  <div className="filter-label" style={{ marginBottom: 8 }}>Template microcopy</div>
                  <div className="grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label className="filter-label">Kicker</label>
                    <input
                      type="text"
                      value={slide.extras?.kicker ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "kicker", e.target.value)}
                      placeholder="e.g. Final / CTA"
                    />
                  </div>
                  <div>
                    <label className="filter-label">Follow line</label>
                    <input
                      type="text"
                      value={slide.extras?.follow_line ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "follow_line", e.target.value)}
                      placeholder="e.g. Follow us for more."
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label className="filter-label">Note</label>
                    <input
                      type="text"
                      value={slide.extras?.note ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "note", e.target.value)}
                      placeholder="Optional small CTA footer text"
                    />
                  </div>
                  <div>
                    <label className="filter-label">Panel title</label>
                    <input
                      type="text"
                      value={slide.extras?.panel_title ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "panel_title", e.target.value)}
                      placeholder="e.g. Engage"
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label className="filter-label">Panel body</label>
                    <input
                      type="text"
                      value={slide.extras?.panel_body ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "panel_body", e.target.value)}
                      placeholder="Small bottom callout text"
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label className="filter-label">Bottom bar text</label>
                    <input
                      type="text"
                      value={slide.extras?.site_bar ?? slide.extras?.bottom_bar_text ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "site_bar", e.target.value)}
                      placeholder="Bottom bar text"
                    />
                  </div>
                  </div>
                </div>
            </>
          )}
            </>
          )}
          <button type="button" className="btn-primary" onClick={handleSaveSlide} disabled={savedAt === currentIndex} style={{ fontSize: 12, padding: "6px 14px" }}>
            {savedAt === currentIndex ? "Saved" : "Save slide"}
          </button>
          </div>
          {copySidePanel ?? null}
        </div>
      )}

      {heyGenVideoMode && (
        <div style={{ padding: 16, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 12 }}>
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
              {spokenScript.trim() ? spokenScript : "—"}
            </pre>
          ) : (
            <textarea
              value={spokenScript}
              onChange={(e) => onSpokenScriptChange(e.target.value)}
              rows={12}
              placeholder="Voiceover / narration script…"
              style={{ width: "100%", minHeight: 200, marginTop: 8, fontFamily: "var(--font-mono, ui-monospace, monospace)", fontSize: 13 }}
            />
          )}
        </div>
      )}

      {readOnly && !heyGenVideoMode && (slide.headline || slide.body || slide.handle) && (
        <div style={{ padding: 16, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
          {slide.headline && <p style={{ fontWeight: 500 }}>{slide.headline}</p>}
          {slide.body && <p style={{ marginTop: 4, color: "var(--fg-secondary)" }}>{slide.body}</p>}
          {slide.handle && <p style={{ marginTop: 4, color: "var(--fg-secondary)" }}>{slide.handle}</p>}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex gap-2">
          <button type="button" className="btn-ghost" onClick={goPrev} disabled={!canPrev}>← Previous</button>
          <button type="button" className="btn-ghost" onClick={goNext} disabled={!canNext}>Next →</button>
        </div>
        <div className="flex gap-2" style={{ alignItems: "center" }}>
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => goToIndex(i)}
              style={{
                width: 8, height: 8, borderRadius: "50%", padding: 0, border: "none",
                background: i === currentIndex ? "var(--accent)" : "rgba(255,255,255,0.3)",
                transition: "background 0.15s",
                boxShadow: i === currentIndex ? "0 0 0 3px rgba(59,130,246,0.3)" : "none",
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
