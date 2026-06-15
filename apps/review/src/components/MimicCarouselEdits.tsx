"use client";

/** Trimmed “Edits for rework” panel for top-performer mimic carousels. */
export interface MimicCarouselEditsProps {
  fontScale: string;
  onFontScaleChange: (value: string) => void;
  hashtags?: string;
  onHashtagsChange?: (value: string) => void;
}

export function MimicCarouselEdits({
  fontScale,
  onFontScaleChange,
  hashtags = "",
  onHashtagsChange,
}: MimicCarouselEditsProps) {
  return (
    <div className="card surface-orange mimic-review-edits">
      <div className="card-header">Edits for rework</div>
      <p className="mimic-review-edits__hint">
        Slide copy and caption live in the carousel panel. Use <strong>Reprint text</strong> for overlay-only
        fixes, or <strong>Regenerate</strong> to run Flux/Qwen again for one slide.
      </p>

      <div className="mimic-review-edits__field">
        <label className="filter-label">Hashtags (for next generation)</label>
        <textarea
          value={hashtags}
          onChange={(e) => onHashtagsChange?.(e.target.value)}
          placeholder="#example #hashtags"
          rows={2}
          readOnly={!onHashtagsChange}
          style={{ minHeight: 56, width: "100%", boxSizing: "border-box" }}
        />
      </div>

      <div className="mimic-review-edits__field" style={{ marginTop: 12 }}>
        <label className="filter-label">Font scale (renderer) — {Number(fontScale || 1).toFixed(2)}×</label>
        <input
          type="range"
          min="0.75"
          max="1.25"
          step="0.01"
          value={fontScale || "1"}
          onChange={(e) => onFontScaleChange(e.target.value)}
        />
        <input
          type="text"
          value={fontScale}
          onChange={(e) => onFontScaleChange(e.target.value)}
          placeholder="1.00"
          style={{ marginTop: 6 }}
        />
      </div>
    </div>
  );
}
