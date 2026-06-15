"use client";

/** Trimmed “Edits for rework” panel for top-performer mimic carousels. */
export interface MimicCarouselEditsProps {
  fontScale: string;
  onFontScaleChange: (value: string) => void;
}

export function MimicCarouselEdits({ fontScale, onFontScaleChange }: MimicCarouselEditsProps) {
  return (
    <div className="card surface-orange mimic-review-edits">
      <div className="card-header">Edits for rework</div>
      <p className="mimic-review-edits__hint">
        Slide copy lives in the carousel and text layout panels. Use <strong>Reprint text</strong> for overlay-only
        fixes, or <strong>Regenerate image</strong> to run Flux/Qwen again for one slide.
      </p>
      <div className="mimic-review-edits__field">
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
