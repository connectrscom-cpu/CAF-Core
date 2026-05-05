"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import { isVideoUrl } from "@/lib/media-url";

const SWIPE_THRESHOLD = 50;

export interface CarouselMediaItem {
  url: string;
  kind: "image" | "video";
}

export interface CarouselSliderProps {
  slides: NormalizedSlide[];
  /** @deprecated Prefer `mediaItems` for mixed image/video decks. */
  imageUrls?: string[];
  /** Per-slide media aligned by index; falls back to `imageUrls[i]` when missing. */
  mediaItems?: (CarouselMediaItem | null | undefined)[];
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
}

export function CarouselSlider({
  slides: initialSlides,
  imageUrls = [],
  mediaItems,
  onSlidesChange,
  className,
  readOnly = false,
  heyGenVideoMode = false,
  spokenScript = "",
  onSpokenScriptChange,
}: CarouselSliderProps) {
  const [slides, setSlides] = useState<NormalizedSlide[]>(initialSlides);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const touchStartX = useRef<number | null>(null);

  useEffect(() => {
    setSlides(initialSlides);
    setCurrentIndex((i) => Math.min(i, Math.max(0, initialSlides.length - 1)));
    setSavedAt(null);
  }, [initialSlides]);

  const updateSlide = useCallback(
    (
      index: number,
      patch: Partial<Pick<NormalizedSlide, "headline" | "body" | "handle" | "extras">>
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
  const fromMedia = mediaItems?.[currentIndex];
  const fallbackUrl = imageUrls[currentIndex]?.trim();
  const mediaUrl = (fromMedia?.url ?? fallbackUrl ?? "").trim();
  const mediaKind: "image" | "video" =
    fromMedia?.kind ?? (mediaUrl && isVideoUrl(mediaUrl) ? "video" : "image");
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
    <div className={`card ${className ?? ""}`}>
      <div className="flex items-center justify-between mb-3">
        <h3 style={{ fontSize: 13, fontWeight: 600 }}>{heyGenVideoMode ? "Video preview" : "Carousel slides"}</h3>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Slide {currentIndex + 1} of {total}</span>
      </div>

      <div className="flex items-center gap-2" style={{ marginBottom: 12 }}>
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
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 200,
            overflow: "hidden",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "#0a0a0c",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {mediaUrl ? (
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
                style={{ width: "100%", maxHeight: "50vh", objectFit: "contain", userSelect: "none" }}
                draggable={false}
                referrerPolicy="no-referrer"
              />
            )
          ) : (
            <span style={{ fontSize: 13, color: "var(--muted)", padding: 24 }}>No rendered asset for this slide</span>
          )}
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

      {!readOnly && !heyGenVideoMode && (
        <div style={{ padding: 16, background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, marginBottom: 12 }}>
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
                  style={{ minHeight: slide.type === "cover" ? 60 : 80 }}
                />
              </div>

              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <div className="filter-label" style={{ marginBottom: 8 }}>Template microcopy (optional)</div>
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
                    <label className="filter-label">Eyebrow</label>
                    <input
                      type="text"
                      value={slide.extras?.eyebrow ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "eyebrow", e.target.value)}
                      placeholder="Upper small label"
                    />
                  </div>
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label className="filter-label">Site bar</label>
                    <input
                      type="text"
                      value={slide.extras?.site_bar ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "site_bar", e.target.value)}
                      placeholder="Bottom bar text"
                    />
                  </div>
                  {slide.type === "cover" && (
                    <div style={{ gridColumn: "1 / -1" }}>
                      <label className="filter-label">CTA site bar (fallback)</label>
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
                <label className="filter-label">CTA text</label>
                <input type="text" value={slide.body} onChange={(e) => updateSlide(currentIndex, { body: e.target.value })} placeholder="Call to action text" />
              </div>
              <div style={{ marginBottom: 10 }}>
                <label className="filter-label">Handle / Link</label>
                <input type="text" value={slide.handle} onChange={(e) => updateSlide(currentIndex, { handle: e.target.value })} placeholder="e.g. @handle or link" />
              </div>

              <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border)" }}>
                <div className="filter-label" style={{ marginBottom: 8 }}>Template microcopy (optional)</div>
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
                  <div style={{ gridColumn: "1 / -1" }}>
                    <label className="filter-label">Site bar</label>
                    <input
                      type="text"
                      value={slide.extras?.site_bar ?? ""}
                      onChange={(e) => updateExtraField(currentIndex, "site_bar", e.target.value)}
                      placeholder="Bottom bar text"
                    />
                  </div>
                </div>
              </div>
            </>
          )}
          <button type="button" className="btn-primary" onClick={handleSaveSlide} disabled={savedAt === currentIndex} style={{ fontSize: 12, padding: "6px 14px" }}>
            {savedAt === currentIndex ? "Saved" : "Save slide"}
          </button>
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
