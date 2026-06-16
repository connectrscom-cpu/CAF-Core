"use client";

/** Right-sidebar fields for top-performer mimic carousel review. */
export interface MimicCarouselEditsProps {
  caption: string;
  onCaptionChange: (value: string) => void;
  hashtags?: string;
  onHashtagsChange?: (value: string) => void;
}

export function MimicCarouselEdits({
  caption,
  onCaptionChange,
  hashtags = "",
  onHashtagsChange,
}: MimicCarouselEditsProps) {
  return (
    <div className="card surface-orange mimic-review-sidebar-panel">
      <div className="card-header">Post caption</div>
      <textarea
        value={caption}
        onChange={(e) => onCaptionChange(e.target.value)}
        placeholder="No caption on this job yet"
        rows={4}
        className="mimic-review-sidebar-panel__textarea"
      />

      <div className="mimic-review-sidebar-panel__field">
        <label className="filter-label">Hashtags (next generation)</label>
        <textarea
          value={hashtags}
          onChange={(e) => onHashtagsChange?.(e.target.value)}
          placeholder="#example #hashtags"
          rows={2}
          readOnly={!onHashtagsChange}
          className="mimic-review-sidebar-panel__textarea mimic-review-sidebar-panel__textarea--compact"
        />
      </div>
    </div>
  );
}
