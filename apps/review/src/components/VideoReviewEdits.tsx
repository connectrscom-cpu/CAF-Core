"use client";

import { useCallback, useMemo, useState } from "react";

export interface VideoReviewEditsProps {
  /** Prompt actually sent to the AI-video provider (HeyGen / Veo / etc.) reconstructed from generation_payload. */
  videoPrompt: string;
  /** Short label for the provider (e.g. "HeyGen", "Video") — just used in the panel header. */
  provider?: string;
  /**
   * Exact HeyGen request body submitted for this task, read from `api_call_audit` on the server.
   * When present, we show THIS as the primary "Exact prompt sent" panel (and collapse `videoPrompt`
   * as a fallback) because it includes all rubric / brand / product / per-flow blocks the job
   * pipeline appended after the LLM call — i.e. exactly what HeyGen's agent saw. `null` means the
   * task hasn't been submitted yet; we fall back to the LLM-side `videoPrompt` in that case.
   */
  submittedHeygenPrompt?: {
    prompt: string | null;
    script_text: string | null;
    post_path: string | null;
    avatar_id: string | null;
    voice_id: string | null;
    video_id: string | null;
    created_at: string;
    ok: boolean;
    error_message: string | null;
  } | null;
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
  /**
   * When true, the reviewer is asking the rework pipeline to keep the existing rendered video and
   * only re-run the caption/hashtag LLM step (saves HeyGen/Sora credits). Mapped to
   * `overrides_json.skip_video_regeneration` on submit.
   */
  skipVideoRegeneration?: boolean;
  onSkipVideoRegenerationChange?: (v: boolean) => void;
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
  submittedHeygenPrompt,
  promptAnalysis,
  onPromptAnalysisChange,
  caption,
  onCaptionChange,
  hashtags,
  onHashtagsChange,
  hook,
  onHookChange,
  skipVideoRegeneration = false,
  onSkipVideoRegenerationChange,
}: VideoReviewEditsProps) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showLlmSide, setShowLlmSide] = useState(false);

  // Prefer the real submitted body: /v3/video-agents uses body.prompt; /v3/videos uses script_text.
  const submittedText = useMemo(() => {
    const s = submittedHeygenPrompt;
    if (!s) return "";
    return s.prompt?.trim() || s.script_text?.trim() || "";
  }, [submittedHeygenPrompt]);
  const submittedKind: "agent_prompt" | "script_text" | null = useMemo(() => {
    const s = submittedHeygenPrompt;
    if (!s) return null;
    if (s.prompt && s.prompt.trim()) return "agent_prompt";
    if (s.script_text && s.script_text.trim()) return "script_text";
    return null;
  }, [submittedHeygenPrompt]);

  const trimmedLlmPrompt = useMemo(() => videoPrompt.trim(), [videoPrompt]);
  const displayText = submittedText || trimmedLlmPrompt;
  const displaySource: "submitted" | "llm" | "none" =
    submittedText ? "submitted" : trimmedLlmPrompt ? "llm" : "none";

  const promptStats = useMemo(() => {
    const chars = displayText.length;
    const words = displayText ? displayText.split(/\s+/).length : 0;
    return { chars, words };
  }, [displayText]);

  const copyPrompt = useCallback(async () => {
    if (!displayText) return;
    try {
      await navigator.clipboard.writeText(displayText);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy prompt:", displayText);
    }
  }, [displayText]);

  return (
    <>
      <div className="card">
        <div className="card-header">{provider} prompt — analyze</div>
        <p style={{ fontSize: 12, color: "var(--fg-secondary)", marginBottom: 10, lineHeight: 1.45 }}>
          {displaySource === "submitted" ? (
            <>
              Exact body POSTed to <strong>{provider}</strong>
              {submittedHeygenPrompt?.post_path ? (
                <> via <span className="font-mono">{submittedHeygenPrompt.post_path}</span></>
              ) : null}
              {submittedKind === "script_text" ? (
                <> — verbatim avatar TTS (<span className="font-mono">video_inputs[0].script_text</span>); the avatar reads this word-for-word.</>
              ) : (
                <> — agent prompt (<span className="font-mono">body.prompt</span>); HeyGen&rsquo;s agent authors the VO from this brief.</>
              )}
              . Your analysis below is merged into the reviewer notes and feeds the editorial learning loop.
            </>
          ) : displaySource === "llm" ? (
            <>
              <strong>LLM draft</strong> — this task has no {provider} submission yet, so this is the upstream
              {" "}<span className="font-mono">generation_payload.video_prompt</span>. The final body can differ
              (rubric / brand / product blocks are appended at submit time).
            </>
          ) : (
            <>No prompt available yet.</>
          )}
        </p>
        {displayText ? (
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
              {displayText}
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
                flexWrap: "wrap",
              }}
            >
              <span>
                {promptStats.words} words · {promptStats.chars} chars
                {submittedHeygenPrompt?.video_id ? (
                  <> · video_id <span className="font-mono">{submittedHeygenPrompt.video_id}</span></>
                ) : null}
                {submittedHeygenPrompt && !submittedHeygenPrompt.ok ? (
                  <> · <span style={{ color: "var(--red)" }}>submission failed</span></>
                ) : null}
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
            {displaySource === "submitted" && trimmedLlmPrompt && trimmedLlmPrompt !== submittedText && (
              <div style={{ marginTop: 12 }}>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => setShowLlmSide((v) => !v)}
                  style={{ fontSize: 11 }}
                >
                  {showLlmSide ? "Hide" : "Show"} LLM-side draft ({trimmedLlmPrompt.length} chars)
                </button>
                {showLlmSide && (
                  <pre
                    style={{
                      margin: "8px 0 0",
                      padding: 10,
                      background: "var(--bg-secondary)",
                      border: "1px dashed var(--border-subtle)",
                      borderRadius: 8,
                      fontFamily: "var(--font-mono, 'SF Mono', 'Fira Code', monospace)",
                      fontSize: 11,
                      lineHeight: 1.5,
                      color: "var(--fg-secondary)",
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      maxHeight: 220,
                      overflow: "auto",
                    }}
                  >
                    {trimmedLlmPrompt}
                  </pre>
                )}
              </div>
            )}
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

        {onSkipVideoRegenerationChange && (
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
                checked={skipVideoRegeneration}
                onChange={(e) => onSkipVideoRegenerationChange(e.target.checked)}
                style={{ marginTop: 3 }}
              />
              <span>
                <strong>Keep existing video</strong> — on rework, re-run only the caption + hashtag LLM step
                (grounded in the signal pack) and skip the {provider} render. Saves credits when the video
                itself is fine but the copy needs work.
              </span>
            </label>
          </div>
        )}

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
