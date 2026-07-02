"use client";

import { useState } from "react";

/** Post caption + hashtags for top-performer mimic carousel review. */
export interface MimicCarouselEditsProps {
  hook?: string;
  onHookChange?: (value: string) => void;
  caption: string;
  onCaptionChange: (value: string) => void;
  hashtags?: string;
  onHashtagsChange?: (value: string) => void;
  /** Sidebar card beside preview, or compact block below preview. */
  variant?: "sidebar" | "below-preview";
  /** Only used when `variant` is `below-preview`. */
  defaultOpen?: boolean;
}

function postCopySnippet(text: string, max = 80): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "No copy yet";
  return t.length <= max ? t : `${t.slice(0, max)}…`;
}

export function MimicCarouselEdits({
  hook = "",
  onHookChange,
  caption,
  onCaptionChange,
  hashtags = "",
  onHashtagsChange,
  variant = "sidebar",
  defaultOpen = false,
}: MimicCarouselEditsProps) {
  const [open, setOpen] = useState(variant === "sidebar" ? true : defaultOpen);

  if (variant === "below-preview") {
    const snippet = postCopySnippet(caption || hook || hashtags);
    return (
      <div className="mimic-post-copy-below" data-agent-id="sticky-post-copy">
        <button
          type="button"
          className={`mimic-post-copy-below__toggle${open ? " mimic-post-copy-below__toggle--open" : ""}`}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <span className="mimic-post-copy-below__chevron" aria-hidden>
            {open ? "▾" : "▸"}
          </span>
          <span className="mimic-post-copy-below__title">Post copy</span>
          {!open ? <span className="mimic-post-copy-below__snippet">{snippet}</span> : null}
        </button>
        {open ? (
          <div className="mimic-post-copy-below__body">
            {onHookChange ? (
              <div className="mimic-post-copy-field">
                <label className="mimic-post-copy-field__label">Hook</label>
                <textarea
                  value={hook}
                  onChange={(e) => onHookChange(e.target.value)}
                  placeholder="Cover hook"
                  rows={1}
                  className="mimic-post-copy-field__input"
                />
              </div>
            ) : null}
            <div className="mimic-post-copy-field">
              <label className="mimic-post-copy-field__label">Hashtags</label>
              <textarea
                value={hashtags}
                onChange={(e) => onHashtagsChange?.(e.target.value)}
                placeholder="#tags"
                rows={1}
                readOnly={!onHashtagsChange}
                className="mimic-post-copy-field__input"
              />
            </div>
            <div className="mimic-post-copy-field mimic-post-copy-field--full">
              <label className="mimic-post-copy-field__label">Caption</label>
              <textarea
                value={caption}
                onChange={(e) => onCaptionChange(e.target.value)}
                placeholder="Post caption"
                rows={2}
                className="mimic-post-copy-field__input"
              />
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="card surface-orange mimic-review-sidebar-panel">
      <div className="card-header">Post copy</div>
      {onHookChange ? (
        <div className="mimic-review-sidebar-panel__field">
          <label className="filter-label">Hook</label>
          <textarea
            value={hook}
            onChange={(e) => onHookChange(e.target.value)}
            placeholder="Cover hook or title line"
            rows={2}
            className="mimic-review-sidebar-panel__textarea mimic-review-sidebar-panel__textarea--compact"
          />
        </div>
      ) : null}
      <label className="filter-label">Caption</label>
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
