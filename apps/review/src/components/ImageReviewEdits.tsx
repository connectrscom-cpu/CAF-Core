"use client";

import { useCallback, useMemo, useState } from "react";

export interface ImageReviewEditsProps {
  /** Prompt sent to the image generator (or synthesized from the production-plan JSON). */
  imagePrompt: string;
  /** Short label for the image generator — appears in the panel header only. */
  provider?: string;
  /** Free-text analysis of the prompt. Appended to the reviewer `notes` on decision submit. */
  promptAnalysis: string;
  onPromptAnalysisChange: (v: string) => void;
  /** Caption override edited by the reviewer (same semantic as `final_caption_override`). */
  caption: string;
  onCaptionChange: (v: string) => void;
  /** Hashtag override — same semantic as `final_hashtags_override`. */
  hashtags: string;
  onHashtagsChange: (v: string) => void;
  /** On-image hook / headline — what the reviewer wants the next render to actually say on the frame. */
  hook: string;
  onHookChange: (v: string) => void;
  /** Title override — image posts sometimes carry a separate title in the signal pack / strategy doc. */
  title: string;
  onTitleChange: (v: string) => void;
  /**
   * When true, the reviewer keeps the rendered image and only re-runs the caption / hashtag LLM step on
   * rework (saves image-gen credits). Mapped to `overrides_json.skip_image_regeneration` on submit.
   */
  skipImageRegeneration?: boolean;
  onSkipImageRegenerationChange?: (v: boolean) => void;
}

/**
 * Review-side edits for **image** flows (FLOW_IMG_* and future single-frame product ads).
 *
 * Image posts are single-frame, so this panel intentionally drops:
 *   - `final_slides_json_override` (no slide grid)
 *
 * It keeps a `final_title_override` because image ads still carry a separate title metadata
 * (used for platform post title / alt text on IG / LinkedIn / Pinterest).
 *
 * Mirrors `VideoReviewEdits` in structure so reviewers have the same mental model across kinds;
 * the prompt-analysis textarea is forwarded into the reviewer note so the editorial learning loop
 * can mint a GENERATION_GUIDANCE rule from it (tagged `[image · <flow_type>]`).
 */
export function ImageReviewEdits({
  imagePrompt,
  provider = "Image",
  promptAnalysis,
  onPromptAnalysisChange,
  caption,
  onCaptionChange,
  hashtags,
  onHashtagsChange,
  hook,
  onHookChange,
  title,
  onTitleChange,
  skipImageRegeneration = false,
  onSkipImageRegenerationChange,
}: ImageReviewEditsProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const trimmedPrompt = useMemo(() => imagePrompt.trim(), [imagePrompt]);
  const promptStats = useMemo(() => {
    const chars = trimmedPrompt.length;
    const words = trimmedPrompt ? trimmedPrompt.split(/\s+/).length : 0;
    return { chars, words };
  }, [trimmedPrompt]);

  const copyPrompt = useCallback(async () => {
    if (!trimmedPrompt) return;
    try {
      await navigator.clipboard.writeText(trimmedPrompt);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy prompt:", trimmedPrompt);
    }
  }, [trimmedPrompt]);

  return (
    <>
      <div className="card">
        <div className="card-header">{provider} prompt — analyze</div>
        <p style={{ fontSize: 12, color: "var(--fg-secondary)", marginBottom: 10, lineHeight: 1.45 }}>
          Exact prompt sent to the <strong>{provider}</strong> generator. Your analysis below is merged
          into the reviewer notes and feeds the editorial learning loop.
        </p>
        {trimmedPrompt ? (
          <>
            <pre
              aria-label={`${provider} prompt sent`}
              style={{
                margin: 0,
                padding: 12,
                background: "var(--bg)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                fontFamily: "var(--font-mono, 'SF Mono', 'Fira Code', monospace)",
                fontSize: 12,
                lineHeight: 1.55,
                color: "var(--fg)",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: expanded ? "none" : 420,
                overflow: "auto",
              }}
            >
              {trimmedPrompt}
            </pre>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginTop: 8,
                fontSize: 11,
                color: "var(--muted)",
                gap: 8,
              }}
            >
              <span>
                {promptStats.words} words · {promptStats.chars} chars
              </span>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setExpanded((v) => !v)}
                  style={{ fontSize: 11 }}
                >
                  {expanded ? "Collapse" : "Expand full"}
                </button>
                <button type="button" className="btn-ghost" onClick={copyPrompt} style={{ fontSize: 11 }}>
                  {copied ? "Copied" : "Copy prompt"}
                </button>
              </div>
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>
            No image prompt was persisted on <span className="font-mono">generation_payload</span>. Image
            product flows (FLOW_IMG_*) are not wired to an image tool yet — the review surface is in place
            so reviewers can start drafting edits once generation is enabled.
          </p>
        )}
        <label className="filter-label" style={{ marginTop: 16 }}>
          Prompt analysis (added to reviewer notes)
        </label>
        <textarea
          value={promptAnalysis}
          onChange={(e) => onPromptAnalysisChange(e.target.value)}
          placeholder={
            "What in the prompt caused this result? e.g. `visual_direction.scene_style missed the brand`, " +
            "`on_screen_text repeats the caption verbatim`, `subject framing crops the product logo`…"
          }
          rows={4}
          style={{ width: "100%", marginTop: 6, minHeight: 90 }}
        />
      </div>

      <div className="card">
        <div className="card-header">Edits for rework</div>

        {onSkipImageRegenerationChange && (
          <div
            style={{
              marginBottom: 14,
              padding: 10,
              background: "var(--bg-secondary)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 8,
            }}
          >
            <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
              <input
                type="checkbox"
                checked={skipImageRegeneration}
                onChange={(e) => onSkipImageRegenerationChange(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>Keep existing image</strong> — on rework, re-run only the caption + hashtag LLM
                step (grounded in the signal pack) and skip the {provider} render. Saves credits when the
                frame is fine but the copy needs work.
              </span>
            </label>
          </div>
        )}

        <div style={{ marginBottom: 12 }}>
          <label className="filter-label">Final title override</label>
          <input
            type="text"
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            placeholder="Override title (saved with decision)"
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label className="filter-label">Hook / on-image headline (override for next generation)</label>
          <input
            type="text"
            value={hook}
            onChange={(e) => onHookChange(e.target.value)}
            placeholder="On-image hook or headline copy"
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <label className="filter-label">Caption suggestion (for next generation)</label>
          <textarea
            value={caption}
            onChange={(e) => onCaptionChange(e.target.value)}
            placeholder="Full post caption you want the next run to aim for"
            rows={3}
            style={{ minHeight: 80 }}
          />
        </div>

        <div>
          <label className="filter-label">Hashtags (for next generation)</label>
          <textarea
            value={hashtags}
            onChange={(e) => onHashtagsChange(e.target.value)}
            placeholder="#example #hashtags or space-separated — saved with decision"
            rows={2}
            style={{ minHeight: 64 }}
          />
        </div>
      </div>
    </>
  );
}
