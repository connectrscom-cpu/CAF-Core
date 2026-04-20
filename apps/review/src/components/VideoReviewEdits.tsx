"use client";

import { useCallback, useMemo, useState } from "react";

export interface VideoReviewEditsProps {
  /** Prompt actually sent to the AI-video provider (HeyGen / Veo / etc.) reconstructed from generation_payload. */
  videoPrompt: string;
  /** Short label for the provider (e.g. "HeyGen", "Video") — just used in the panel header. */
  provider?: string;
  /** Free-text analysis notes about the prompt. Appended to the reviewer `notes` on decision submit. */
  promptAnalysis: string;
  onPromptAnalysisChange: (v: string) => void;
  /** Caption override edited by the reviewer (same semantic as `final_caption_override`). */
  caption: string;
  onCaptionChange: (v: string) => void;
  /** Hashtag override — same semantic as `final_hashtags_override`. */
  hashtags: string;
  onHashtagsChange: (v: string) => void;
  /** Optional hook / opening line — some video flows care about this for captions / on-screen text. */
  hook: string;
  onHookChange: (v: string) => void;
}

/**
 * Review-side edits for **video** flows (HeyGen, Reel, scene-assembly, …).
 *
 * Video posts never have carousel slides, so this panel intentionally drops:
 *   - `final_slides_json_override` (no slide grid)
 *   - `final_title_override` (video cards don't ship with a separate title — the hook_line is the title)
 *
 * It ADDS a read-only view of the **prompt that was sent to the AI-video provider** so reviewers can
 * audit whether the visuals match the script, plus a free-text "prompt analysis" field whose contents
 * get merged into the reviewer `notes` on submit — the editorial learning loop later lifts those notes
 * into GENERATION_GUIDANCE rules (tagged via `[video · <flow_type>]`).
 */
export function VideoReviewEdits({
  videoPrompt,
  provider = "HeyGen",
  promptAnalysis,
  onPromptAnalysisChange,
  caption,
  onCaptionChange,
  hashtags,
  onHashtagsChange,
  hook,
  onHookChange,
}: VideoReviewEditsProps) {
  const [copied, setCopied] = useState(false);

  const trimmedPrompt = useMemo(() => videoPrompt.trim(), [videoPrompt]);
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
          Exact prompt the pipeline sent to <strong>{provider}</strong> for this job, reconstructed from{" "}
          <span className="font-mono">generation_payload</span>. Use it to audit whether the visuals match
          the spoken script. Your analysis below is appended to the reviewer <span className="font-mono">notes</span>
          {" "}on submit (tagged <span className="font-mono">[video · flow_type]</span> so the editorial learning
          loop can pick it up and mint a pending <strong>GENERATION_GUIDANCE</strong> rule).
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
                maxHeight: 280,
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
              }}
            >
              <span>
                {promptStats.words} words · {promptStats.chars} chars
              </span>
              <button type="button" className="btn-ghost" onClick={copyPrompt} style={{ fontSize: 11 }}>
                {copied ? "Copied" : "Copy prompt"}
              </button>
            </div>
          </>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: "var(--muted)", fontStyle: "italic" }}>
            No prompt was persisted on <span className="font-mono">generation_payload.video_prompt</span> (and no
            production plan to synthesize one from). Check the flow is writing <span className="font-mono">video_prompt</span>
            {" "}before the AI-video call.
          </p>
        )}
        <label className="filter-label" style={{ marginTop: 16 }}>
          Prompt analysis (added to reviewer notes)
        </label>
        <textarea
          value={promptAnalysis}
          onChange={(e) => onPromptAnalysisChange(e.target.value)}
          placeholder={
            "What in the prompt caused this result? e.g. `visual_direction.scene_style missed the SNS brand`, " +
            "`camera movement contradicts scene 2 narration`, `on_screen_text repeats the caption verbatim`…"
          }
          rows={4}
          style={{ width: "100%", marginTop: 6, minHeight: 90 }}
        />
      </div>

      <div className="card">
        <div className="card-header">Edits for rework</div>

        <div style={{ marginBottom: 12 }}>
          <label className="filter-label">Hook / opening line (override for next generation)</label>
          <input
            type="text"
            value={hook}
            onChange={(e) => onHookChange(e.target.value)}
            placeholder="Suggested opening or on-screen hook text"
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
