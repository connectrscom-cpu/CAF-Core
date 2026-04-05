"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { NormalizedSlide } from "@/lib/carousel-slides";

const SWIPE_THRESHOLD = 50;

export interface CarouselSliderProps {
  slides: NormalizedSlide[];
  imageUrls?: string[];
  onSlidesChange?: (slides: NormalizedSlide[]) => void;
  className?: string;
  readOnly?: boolean;
}

export function CarouselSlider({
  slides: initialSlides,
  imageUrls = [],
  onSlidesChange,
  className,
  readOnly = false,
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
    (index: number, patch: Partial<Pick<NormalizedSlide, "headline" | "body" | "handle">>) => {
      setSavedAt(null);
      setSlides((prev) => {
        const next = prev.map((s, i) => (i === index ? { ...s, ...patch } : s));
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
  const imageUrl = imageUrls[currentIndex];
  const total = slides.length;
  const canPrev = currentIndex > 0;
  const canNext = currentIndex < total - 1;

  if (slides.length === 0) {
    return (
      <div className={cn("rounded-lg border bg-muted/30 p-4", className)}>
        <p className="text-sm text-muted-foreground">No slides in this carousel.</p>
      </div>
    );
  }

  return (
    <div className={cn("space-y-4 rounded-lg border bg-muted/30 p-3 sm:p-4", className)}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Carousel slides</h3>
        <span className="text-xs text-muted-foreground">Slide {currentIndex + 1} of {total}</span>
      </div>

      {imageUrl && (
        <div className="flex items-center gap-1 sm:gap-2">
          <button
            type="button"
            aria-label="Previous slide"
            onClick={goPrev}
            disabled={!canPrev}
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full bg-black text-white shadow-md disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-black/90 sm:h-10 sm:w-10"
          >
            <span className="text-xl leading-none">&#8249;</span>
          </button>
          <div
            className="min-w-0 flex-1 overflow-hidden rounded-lg border bg-card touch-pan-y"
            onTouchStart={onTouchStart}
            onTouchEnd={onTouchEnd}
          >
            <img
              src={imageUrl}
              alt={`Slide ${currentIndex + 1}`}
              className="h-auto max-h-[50vh] w-full max-w-full object-contain select-none"
              draggable={false}
            />
          </div>
          <button
            type="button"
            aria-label="Next slide"
            onClick={goNext}
            disabled={!canNext}
            className="flex h-11 w-11 shrink-0 touch-manipulation items-center justify-center rounded-full bg-black text-white shadow-md disabled:cursor-not-allowed disabled:opacity-40 hover:enabled:bg-black/90 sm:h-10 sm:w-10"
          >
            <span className="text-xl leading-none">&#8250;</span>
          </button>
        </div>
      )}

      {!readOnly && (
        <div className="space-y-3 rounded border bg-card p-4">
          {slide.type === "cover" && (
            <>
              <div className="grid gap-2">
                <Label className="text-xs">Headline / Title</Label>
                <Input value={slide.headline} onChange={(e) => updateSlide(currentIndex, { headline: e.target.value })} placeholder="Cover headline" className="font-medium" />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Subtitle / Body</Label>
                <textarea value={slide.body} onChange={(e) => updateSlide(currentIndex, { body: e.target.value })} placeholder="Cover subtitle" className="min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={2} />
              </div>
            </>
          )}
          {slide.type === "body" && (
            <>
              <div className="grid gap-2">
                <Label className="text-xs">Headline</Label>
                <Input value={slide.headline} onChange={(e) => updateSlide(currentIndex, { headline: e.target.value })} placeholder="Slide headline" className="font-medium" />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Body</Label>
                <textarea value={slide.body} onChange={(e) => updateSlide(currentIndex, { body: e.target.value })} placeholder="Slide body text" className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm" rows={3} />
              </div>
            </>
          )}
          {slide.type === "cta" && (
            <>
              <div className="grid gap-2">
                <Label className="text-xs">CTA text</Label>
                <Input value={slide.body} onChange={(e) => updateSlide(currentIndex, { body: e.target.value })} placeholder="Call to action text" />
              </div>
              <div className="grid gap-2">
                <Label className="text-xs">Handle / Link</Label>
                <Input value={slide.handle} onChange={(e) => updateSlide(currentIndex, { handle: e.target.value })} placeholder="e.g. @handle or link" />
              </div>
            </>
          )}
          <div className="pt-2">
            <Button type="button" size="sm" onClick={handleSaveSlide} disabled={savedAt === currentIndex}>
              {savedAt === currentIndex ? "Saved" : "Save slide"}
            </Button>
          </div>
        </div>
      )}

      {readOnly && (slide.headline || slide.body || slide.handle) && (
        <div className="rounded border bg-card p-4 text-sm">
          {slide.headline && <p className="font-medium">{slide.headline}</p>}
          {slide.body && <p className="mt-1 text-muted-foreground">{slide.body}</p>}
          {slide.handle && <p className="mt-1 text-muted-foreground">{slide.handle}</p>}
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={goPrev} disabled={!canPrev}>← Previous</Button>
          <Button type="button" variant="outline" size="sm" onClick={goNext} disabled={!canNext}>Next →</Button>
        </div>
        <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
          {slides.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => setCurrentIndex(i)}
              className={cn(
                "h-2 w-2 rounded-full transition-colors touch-manipulation",
                i === currentIndex ? "bg-primary ring-2 ring-primary/30 ring-offset-2" : "bg-muted-foreground/40 hover:bg-muted-foreground/60"
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
