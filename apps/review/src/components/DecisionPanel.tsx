"use client";

import { useCallback, useEffect, useState } from "react";
import type { DecisionValue } from "@/lib/types";

const REVIEW_ISSUE_TAGS = [
  "tone_off", "brand_off", "wrong_angle", "too_generic", "quality_low",
  "too_controversial", "unsafe_claim", "bad_structure", "weak_narrative",
  "audience_mismatch", "format_mismatch", "hook_strategy_wrong",
  "content_direction_wrong", "typo", "cta_weak", "visual_tweak_needed",
  "script_line_needs_edit", "camera_notes_needed", "audio_voiceover_issue",
  "subtitles_issue", "b_roll_weak", "pacing_off", "scene_order_issue",
  "render_settings_change",
];

export interface DecisionPanelProps {
  taskId: string;
  /** Required when the workbench aggregates multiple CAF projects (sent to Core as `project_slug`). */
  projectSlug?: string;
  onSuccess?: () => void;
  existingDecision?: string;
  existingNotes?: string;
  finalTitleOverride?: string;
  finalHookOverride?: string;
  finalCaptionOverride?: string;
  finalHashtagsOverride?: string;
  finalSlidesJsonOverride?: string;
  hasEdits?: boolean;
  editsSummary?: string[];
  /** When false, rework prefers patching copy in place (no LLM) when slide/caption overrides exist. Default true. */
  existingRewriteCopy?: boolean;
}

export function DecisionPanel({
  taskId,
  projectSlug,
  onSuccess,
  existingDecision,
  existingNotes = "",
  finalTitleOverride,
  finalHookOverride,
  finalCaptionOverride,
  finalHashtagsOverride,
  finalSlidesJsonOverride,
  hasEdits = false,
  editsSummary = [],
  existingRewriteCopy = true,
}: DecisionPanelProps) {
  const [decision, setDecision] = useState<DecisionValue | "">((existingDecision as DecisionValue) || "");
  const [notes, setNotes] = useState(existingNotes);
  const [tags, setTags] = useState<string[]>([]);
  const [validator, setValidator] = useState("");
  const [rewriteCopy, setRewriteCopy] = useState(existingRewriteCopy !== false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);

  useEffect(() => {
    setRewriteCopy(existingRewriteCopy !== false);
  }, [existingRewriteCopy, taskId]);

  const submit = useCallback(async () => {
    if (!decision || !["APPROVED", "NEEDS_EDIT", "REJECTED"].includes(decision)) {
      setError("Select a decision: Approve, Needs Edit, or Reject");
      return;
    }
    setSubmitting(true);
    setError(null);
    const effectiveDecision = decision === "APPROVED" && hasEdits ? "NEEDS_EDIT" : decision;
    try {
      const res = await fetch("/api/task/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          decision: effectiveDecision,
          ...(projectSlug ? { project_slug: projectSlug } : {}),
          notes: notes.trim() || undefined,
          rejection_tags: tags,
          validator: validator.trim() || undefined,
          ...(finalTitleOverride !== undefined && { final_title_override: finalTitleOverride }),
          ...(finalHookOverride !== undefined && { final_hook_override: finalHookOverride }),
          ...(finalCaptionOverride !== undefined && { final_caption_override: finalCaptionOverride }),
          ...(finalHashtagsOverride !== undefined && { final_hashtags_override: finalHashtagsOverride }),
          ...(finalSlidesJsonOverride !== undefined && { final_slides_json_override: finalSlidesJsonOverride }),
          ...(effectiveDecision === "NEEDS_EDIT" ? { rewrite_copy: rewriteCopy } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setSubmittedMessage(effectiveDecision === "APPROVED" ? "Approved" : "Decision submitted");
      setTimeout(() => onSuccess?.(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }, [
    decision,
    notes,
    tags,
    validator,
    taskId,
    projectSlug,
    onSuccess,
    finalTitleOverride,
    finalHookOverride,
    finalCaptionOverride,
    finalHashtagsOverride,
    finalSlidesJsonOverride,
    hasEdits,
    rewriteCopy,
  ]);

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  return (
    <div className="card">
      <div className="card-header">Decision</div>

      <div className="decision-buttons">
        <button
          type="button"
          data-decision="APPROVED"
          className={`decision-btn decision-btn-approve ${decision === "APPROVED" ? "selected" : ""}`}
          onClick={() => setDecision("APPROVED")}
          title={hasEdits ? "Not available when edits are made" : "Shortcut: A"}
          disabled={hasEdits}
        >
          Approve
        </button>
        <button
          type="button"
          data-decision="NEEDS_EDIT"
          className={`decision-btn decision-btn-edit ${decision === "NEEDS_EDIT" ? "selected" : ""}`}
          onClick={() => setDecision("NEEDS_EDIT")}
          title="Shortcut: E"
        >
          Needs Edit
        </button>
        <button
          type="button"
          data-decision="REJECTED"
          className={`decision-btn decision-btn-reject ${decision === "REJECTED" ? "selected" : ""}`}
          onClick={() => setDecision("REJECTED")}
          title="Shortcut: R"
        >
          Reject
        </button>
      </div>

      {hasEdits && (
        <div style={{ marginBottom: 14 }}>
          <p style={{ fontSize: 12, color: "var(--fg-secondary)" }}>
            Approve is only for no edits. Use <strong>Needs Edit</strong> when you changed:
          </p>
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--yellow)", marginTop: 4 }}>
            {editsSummary.length > 0 ? editsSummary.join(" · ") : "—"}
          </p>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label className="filter-label">Notes</label>
        <textarea
          placeholder="Optional notes for downstream"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          style={{ minHeight: 80 }}
        />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label className="filter-label">Issue tags (what went wrong — for the next generation)</label>
        <div style={{ padding: 12, background: "var(--bg-secondary)", borderRadius: 8, marginTop: 6, border: "1px solid var(--border-subtle)" }}>
          <p style={{ fontSize: 12, color: "var(--fg-secondary)", marginBottom: 8 }}>
            Use hook, caption, hashtags, and slides in <strong style={{ color: "var(--fg)" }}>Edits for rework</strong> — they are stored on the NEEDS_EDIT row and fed into the next rework pass.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {REVIEW_ISSUE_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                style={{
                  padding: "4px 10px",
                  borderRadius: 6,
                  fontSize: 12,
                  border: `1px solid ${tags.includes(tag) ? "var(--accent)" : "var(--border)"}`,
                  background: tags.includes(tag) ? "var(--accent)" : "var(--card)",
                  color: tags.includes(tag) ? "#fff" : "var(--fg-secondary)",
                  cursor: "pointer",
                  transition: "all 0.15s",
                }}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
      </div>

      {(decision === "NEEDS_EDIT" || hasEdits) && (
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={rewriteCopy}
              onChange={(e) => setRewriteCopy(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>Rewrite copy</strong> on the next rework run. Uncheck if you only want your edited slide/caption
              text patched in (no new LLM copy) when the pipeline can apply overrides — otherwise the model still runs
              but is instructed to keep your text verbatim.
            </span>
          </label>
        </div>
      )}

      <div style={{ marginBottom: 14 }}>
        <label className="filter-label">Validator</label>
        <input
          type="text"
          placeholder="Your name or ID"
          value={validator}
          onChange={(e) => setValidator(e.target.value)}
        />
      </div>

      {submittedMessage && (
        <p style={{ fontSize: 13, fontWeight: 500, color: "var(--green)", marginBottom: 12 }}>
          {submittedMessage}. Taking you back to queue…
        </p>
      )}
      {error && <p style={{ fontSize: 13, color: "var(--red)", marginBottom: 12 }}>{error}</p>}

      <button
        type="button"
        className="btn-primary"
        onClick={submit}
        disabled={submitting || !!submittedMessage}
        style={{ width: "100%" }}
      >
        {submitting ? "Submitting…" : submittedMessage ? "Submitted" : "Submit decision"}
      </button>

      <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10 }}>
        Shortcuts: A (Approve), E (Needs Edit), R (Reject)
      </p>
    </div>
  );
}
