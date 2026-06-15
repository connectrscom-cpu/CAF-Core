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
  resolveMimicTemplateBgEditorFields,
  type MimicTemplateBgEditorField,
} from "@/lib/mimic-template-bg";
import { isVideoUrl } from "@/lib/media-url";

const SWIPE_THRESHOLD = 50;

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
  regenerateSlideBusy?: boolean;
  /** template_bg listicle — headline/body fields instead of OCR clusters. */
  mimicTemplateBg?: boolean;
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
  regenerateSlideBusy = false,
  mimicTemplateBg = false,
}: CarouselSliderProps) {
  const [slides, setSlides] = useState<NormalizedSlide[]>(initialSlides);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [liveBusy, setLiveBusy] = useState(false);
  const [liveErr, setLiveErr] = useState<string | null>(null);
  const touchStartX = useRef<number | null>(null);
  const syncingSlideFromParentRef = useRef(false);
  const onCurrentSlideChangeRef = useRef(onCurrentSlideChange);
  onCurrentSlideChangeRef.current = onCurrentSlideChange;

  const slidesKey = useMemo(() => JSON.stringify(slides), [slides]);

  useEffect(() => {
    setSlides(initialSlides);
    setCurrentIndex((i) => Math.min(i, Math.max(0, initialSlides.length - 1)));
    setSavedAt(null);
  }, [initialSlides]);

  useEffect(() => {
    if (syncingSlideFromParentRef.current) {
      syncingSlideFromParentRef.current = false;
      return;
    }
    onCurrentSlideChangeRef.current?.(currentIndex + 1);
  }, [currentIndex]);

  useEffect(() => {
    if (activeSlideIndex == null || slides.length === 0) return;
    const idx = Math.max(0, Math.min(slides.length - 1, activeSlideIndex - 1));
    setCurrentIndex((cur) => {
      if (cur === idx) return cur;
      syncingSlideFromParentRef.current = true;
      return idx;
    });
  }, [activeSlideIndex, slides.length]);

  useEffect(() => {
    if (heyGenVideoMode || readOnly || !livePreview?.template) {
      setLiveUrl((u) => {
        if (u) URL.revokeObjectURL(u);
        return null;
      });
      setLiveErr(null);
      setLiveBusy(false);
      return;
    }

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
          const res = await fetch("/api/renderer/preview-live-slide", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              template: livePreview.template,
              slide_index: currentIndex + 1,
              task_id: livePreview.taskId,
              run_id: livePreview.runId,
              instagram_handle: livePreview.instagramHandle ?? "",
              background_image_url: livePreview.getBackgroundUrl?.(currentIndex + 1) ?? "",
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
          setLiveUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return url;
          });
        } catch (e) {
          if (!cancelled) setLiveErr(e instanceof Error ? e.message : "Live preview failed");
        } finally {
          if (!cancelled) setLiveBusy(false);
        }
      })();
    }, 380);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [heyGenVideoMode, readOnly, livePreview, livePreview?.fontScale, currentIndex, slidesKey]);

  const updateSlide = useCallback(
    (
      index: number,
      patch: Partial<Pick<NormalizedSlide, "headline" | "body" | "handle" | "extras" | "on_slide_lines" | "text_blocks">>
    ) => {
      setSavedAt(null);
      setSlides((prev) => {
        const next = prev.map((s, i) => (i === index ? { ...s, ...patch } : s));
        onSlidesChange?.(next);
        return next;
      });
    },
    [onSlidesChange]
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
        onSlidesChange?.(next);
        return next;
      });
    },
    [onSlidesChange]
  );

  const updateMimicTextBlock = useCallback(
    (slideIndex: number, blockIndex: number, text: string) => {
      setSavedAt(null);
      setSlides((prev) => {
        const next = prev.map((s, i) => {
          if (i !== slideIndex) return s;
          const blocks = resolveMimicTextBlocksForSlide(s).map((b, bi) =>
            bi === blockIndex ? { ...b, text } : b
          );
          const fields = mimicSlideFieldsFromTextBlocks(blocks);
          return {
            ...s,
            text_blocks: blocks,
            on_slide_lines: fields.on_slide_lines,
            headline: fields.headline,
            body: fields.body,
          };
        });
        onSlidesChange?.(next);
        return next;
      });
    },
    [onSlidesChange]
  );

  const updateMimicTemplateBgField = useCallback(
    (slideIndex: number, field: MimicTemplateBgEditorField, text: string) => {
      setSavedAt(null);
      setSlides((prev) => {
        const next = prev.map((s, i) =>
          i === slideIndex
            ? applyMimicTemplateBgFieldEdit(s, slideIndex + 1, prev.length, field.key, text)
            : s
        );
        onSlidesChange?.(next);
        return next;
      });
    },
    [onSlidesChange]
  );

  const handleSaveSlide = useCallback(() => {
    onSlidesChange?.(slides);
    setSavedAt(currentIndex);
  }, [currentIndex, onSlidesChange, slides]);

  const goPrev = useCallback(() => setCurrentIndex((i) => Math.max(0, i - 1)), []);
  const goNext = useCallback(() => setCurrentIndex((i) => Math.min(initialSlides.length - 1, i + 1)), [initialSlides.length]);

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
        ? resolveMimicTemplateBgEditorFields(slide, currentIndex + 1, slides.length)
        : [],
    [mimicCopyEditor, mimicTemplateBg, slide, currentIndex, slides.length]
  );
  const mimicTextBlocks = useMemo(
    () => (mimicCopyEditor && !mimicTemplateBg ? resolveMimicTextBlocksForSlide(slide) : []),
    [mimicCopyEditor, mimicTemplateBg, slide]
  );
  const fromMedia = mediaItems?.[currentIndex];
  const fallbackUrl = imageUrls[currentIndex]?.trim();
  const mediaUrl = (fromMedia?.url ?? fallbackUrl ?? "").trim();
  const mediaKind: "image" | "video" =
    fromMedia?.kind ?? (mediaUrl && isVideoUrl(mediaUrl) ? "video" : "image");
  const livePngUrl =
    !heyGenVideoMode && livePreview?.template && liveUrl && mediaKind === "image" ? liveUrl : null;
  const total = slides.length;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex < total - 1;

  if (slides.length === 0) {
    return (
      <div className={`card ${className ?? ""}`}>
        <p style={{ fontSize: 13, color: "var(--fg-secondary)" }}>No slides in this carousel.</p>
      </div>
    );
  }

  return (
    <div className={`card ${className ?? ""}${mimicCopyEditor ? " mimic-carousel-review" : ""}`}>
      {mimicCopyEditor ? (
        <div className="mimic-caption-bar">
          <label className="filter-label">Post caption</label>
          <textarea
            value={caption}
            onChange={(e) => onCaptionChange?.(e.target.value)}
            placeholder="No caption on this job yet"
            rows={2}
            readOnly={!onCaptionChange}
            className="mimic-caption-bar__input"
          />
        </div>
      ) : null}

      <div className="flex items-center justify-between mb-3 mimic-carousel-review__header">
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>{heyGenVideoMode ? "Video preview" : "Carousel slides"}</h3>
        <div className="flex items-center gap-2" style={{ flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>Slide {currentIndex + 1} of {total}</span>
          {mimicCopyEditor && onRegenerateSlide ? (
            <button
              type="button"
              className="btn-secondary btn-sm"
              disabled={regenerateSlideBusy}
              onClick={onRegenerateSlide}
            >
              {regenerateSlideBusy ? "Regenerating…" : "Regenerate"}
            </button>
          ) : null}
          {mimicCopyEditor && onDeleteSlide && total > 1 ? (
            <button type="button" className="btn-danger-ghost btn-sm" onClick={onDeleteSlide}>
              Delete slide
            </button>
          ) : null}
        </div>
      </div>

      <div className={`flex items-center gap-2${mimicCopyEditor ? " mimic-compare-row" : ""}`} style={{ marginBottom: 12 }}>
        <button
          type="button"
          aria-label="Previous slide"
          onClick={goPrev}
          disabled={!canPrev}
          style={{
            width: 40, height: 40, borderRadius: "50%", background: "rgba(0,0,0,0.7)",
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0, opacity: canPrev ? 1 : 0.4,
          }}
        >
          &#8249;
        </button>
        <div
          className={mimicCopyEditor ? "mimic-compare-frame" : undefined}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: mimicCopyEditor ? 140 : 200,
            overflow: "hidden",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "#0a0a0c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            ...(mimicCopyEditor && referenceSlideUrl?.trim()
              ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1, background: "var(--border)" }
              : {}),
          }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {mimicCopyEditor && referenceSlideUrl?.trim() ? (
            <div className="mimic-compare-pane">
              <span className="mimic-compare-pane__label">Original</span>
              <img
                src={referenceSlideUrl}
                alt={`Original slide ${currentIndex + 1}`}
                className="mimic-compare-pane__img"
                draggable={false}
                referrerPolicy="no-referrer"
              />
            </div>
          ) : null}
          <div className={mimicCopyEditor && referenceSlideUrl?.trim() ? "mimic-compare-pane" : undefined} style={mimicCopyEditor && referenceSlideUrl?.trim() ? { display: "flex", flexDirection: "column", minHeight: 0 } : undefined}>
            {mimicCopyEditor && referenceSlideUrl?.trim() ? (
              <span className="mimic-compare-pane__label">Generated</span>
            ) : null}
          {livePngUrl ? (
            <img
              key={livePngUrl}
              src={livePngUrl}
              alt={`Slide ${currentIndex + 1} live preview`}
              style={{ width: "100%", maxHeight: "50vh", objectFit: "contain", userSelect: "none" }}
              draggable={false}
            />
          ) : mediaUrl ? (
            mediaKind === "video" ? (
              <video
                key={mediaUrl}
                src={mediaUrl}
                controls
                playsInline
                style={{ width: "100%", maxHeight: "50vh", objectFit: "contain" }}
              />
            ) : (
              <img
                src={mediaUrl}
                alt={`Slide ${currentIndex + 1}`}
                style={{
                  width: "100%",
                  maxHeight: mimicCopyEditor ? "28vh" : "50vh",
                  objectFit: "contain",
                  userSelect: "none",
                  flex: 1,
                }}
                draggable={false}
                referrerPolicy="no-referrer"
              />
            )
          ) : (
            <span style={{ fontSize: 13, color: "var(--muted)", padding: 24 }}>No rendered asset for this slide</span>
          )}
          </div>
        </div>
        <button
          type="button"
          aria-label="Next slide"
          onClick={goNext}
          disabled={!canNext}
          style={{
            width: 40, height: 40, borderRadius: "50%", background: "rgba(0,0,0,0.7)",
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20, flexShrink: 0, opacity: canNext ? 1 : 0.4,
          }}
        >
          &#8250;
        </button>
      </div>
      {!heyGenVideoMode && livePreview?.template && (
        <p style={{ fontSize: 11, color: "var(--muted)", margin: "0 0 12px", lineHeight: 1.4 }}>
          {liveBusy
            ? "Rendering live preview…"
            : liveErr
              ? `Live preview unavailable (${liveErr}). Showing stored asset if available.`
              : livePngUrl
                ? "Live preview: font scale + slide copy (matches template). Stored thumbnails are from the last pipeline render."
                : "Starting live preview…"}
        </p>
      )}

      {!readOnly && !heyGenVideoMode && (
        <div className={copySidePanel ? "carousel-edit-split" : undefined} style={{ marginBottom: 12 }}>
          <div
            className="carousel-edit-copy"
            style={{ padding: 16, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }}
          >
          {mimicCopyEditor && mimicTemplateBg ? (
            <div className="mimic-text-blocks mimic-text-blocks--compact">
              <label className="filter-label">Slide copy</label>
              <p className="mimic-text-blocks__hint">
                Listicle format — headline and body per slide (cover uses subtitle; last slide uses CTA + handle).
              </p>
              <div className="mimic-text-blocks__list">
                {mimicTemplateBgFields.map((field, bi) => {
                  const isHandle = field.role === "handle";
                  const displayText =
                    isHandle && projectHandle.trim()
                      ? projectHandle.trim().startsWith("@")
                        ? projectHandle.trim()
                        : `@${projectHandle.trim().replace(/^@+/, "")}`
                      : field.text;
                  const linked = activeTextBlockIndex === bi;
                  return (
                    <div
                      key={field.key}
                      className={`mimic-text-block-field${linked ? " mimic-text-block-field--linked" : ""}`}
                      onClick={() => onActiveTextBlockIndexChange?.(bi)}
                    >
                      <label className="filter-label mimic-text-block-field__label">
                        <span>{field.label}</span>
                        <span className="mimic-text-block-field__meta">Box {bi + 1}</span>
                      </label>
                      <textarea
                        value={isHandle && projectHandle.trim() ? displayText : field.text}
                        readOnly={isHandle && Boolean(projectHandle.trim())}
                        onChange={(e) => {
                          if (isHandle && projectHandle.trim()) return;
                          updateMimicTemplateBgField(currentIndex, field, e.target.value);
                        }}
                        rows={Math.min(5, Math.max(2, displayText.split("\n").length))}
                        placeholder={`${field.label}…`}
                        className="mimic-text-block-field__input"
                        onFocus={() => onActiveTextBlockIndexChange?.(bi)}
                      />
                      {isHandle ? (
                        <p className="mimic-text-block-field__note">Always prints project handle on reprint</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : mimicCopyEditor ? (
            <div className="mimic-text-blocks mimic-text-blocks--compact">
              <label className="filter-label">Text blocks ({mimicTextBlocks.length})</label>
              <p className="mimic-text-blocks__hint">
                One field per OCR copy cluster — synced to layout boxes below.
              </p>
              <div className="mimic-text-blocks__list">
                {mimicTextBlocks.map((block, bi) => {
                  const isHandle = isMimicHandleTextBlock(block);
                  const displayText = mimicTextBlockDisplayText(block, projectHandle);
                  const linked = activeTextBlockIndex === bi;
                  return (
                  <div
                    key={bi}
                    className={`mimic-text-block-field${linked ? " mimic-text-block-field--linked" : ""}`}
                    onClick={() => onActiveTextBlockIndexChange?.(bi)}
                  >
                    <label className="filter-label mimic-text-block-field__label">
                      <span>{mimicTextBlockEditorLabel(block, bi, mimicTextBlocks.length)}</span>
                      <span className="mimic-text-block-field__meta">
                        Box {bi + 1}
                        {block.role && block.role !== "body" ? ` · ${block.role}` : ""}
                      </span>
                    </label>
                    <textarea
                      value={isHandle ? displayText : block.text}
                      readOnly={isHandle && Boolean(projectHandle.trim())}
                      onChange={(e) => {
                        if (isHandle && projectHandle.trim()) return;
                        updateMimicTextBlock(currentIndex, bi, e.target.value);
                      }}
                      rows={Math.min(4, Math.max(2, (isHandle ? displayText : block.text).split("\n").length))}
                      placeholder="On-slide copy for this box"
                      className="mimic-text-block-field__input"
                      onFocus={() => onActiveTextBlockIndexChange?.(bi)}
                    />
                    {isHandle ? (
                      <p className="mimic-text-block-field__note">
                        Always prints project handle on reprint
                      </p>
                    ) : null}
                  </div>
                );
                })}
              </div>
            </div>
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
          {copySidePanel ? <div className="carousel-edit-side-panel">{copySidePanel}</div> : null}
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
              onClick={() => setCurrentIndex(i)}
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
