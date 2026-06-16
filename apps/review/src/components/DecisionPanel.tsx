"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CarouselSlideReworkPicker,
  slideIndicesFromEditsSummary,
} from "@/components/CarouselSlideReworkPicker";
import { formatDecisionHttpError } from "@/lib/format-decision-http-error";
import type { DecisionValue } from "@/lib/types";

const REVIEW_ISSUE_TAGS = [
  "tone_off", "brand_off", "wrong_angle", "too_generic", "quality_low",
  "too_controversial", "unsafe_claim", "bad_structure", "weak_narrative",
  "audience_mismatch", "format_mismatch", "hook_strategy_wrong",
  "content_direction_wrong", "typo", "cta_weak", "visual_tweak_needed",
  /** Carousel: next full rework picks a different `.hbs` (not the same layout). */
  "carousel_template_change",
  "script_line_needs_edit", "camera_notes_needed", "audio_voiceover_issue",
  "subtitles_issue", "b_roll_weak", "pacing_off", "scene_order_issue",
  "render_settings_change",
  "heygen_avatar_change", "heygen_voice_change", "heygen_full_regenerate",
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
  /** HeyGen single-take: reviewer script + optional ids (sent only when `includeHeyGenFields` is true). */
  finalSpokenScriptOverride?: string;
  heygenAvatarId?: string;
  heygenVoiceId?: string;
  heygenForceRerender?: boolean;
  includeHeyGenFields?: boolean;
  hasEdits?: boolean;
  editsSummary?: string[];
  /** When false, rework prefers patching copy in place (no LLM) when slide/caption overrides exist. Default true. */
  existingRewriteCopy?: boolean;
  /**
   * Free-text appended to the reviewer `notes` on submit, under a `--- <label> ---` separator.
   * Used by the video review panel to forward prompt-analysis into the note so the editorial learning
   * loop can mint a GENERATION_GUIDANCE rule from it (tagged `[video · <flow_type>]`).
   */
  notesAddendum?: string;
  notesAddendumLabel?: string;
  /**
   * Video flows only: reviewer asked to keep the existing rendered video and only re-run the
   * caption / hashtag LLM step on rework. Sent as `skip_video_regeneration: true` so the rework
   * orchestrator picks the PARTIAL_NO_VIDEO path (no HeyGen / Sora re-render billed).
   */
  skipVideoRegeneration?: boolean;
  /**
   * Image flows only: reviewer asked to keep the existing rendered image and only re-run the
   * caption / hashtag LLM step on rework. Sent as `skip_image_regeneration: true` so the rework
   * orchestrator skips the image-gen call (credit-safe captions-only pass).
   */
  skipImageRegeneration?: boolean;
  /**
   * Prefill from `latest_overrides_json.regenerate` when reopening a task; when omitted, default is
   * “regenerate assets” on (explicit reviewer choice still wins on submit).
   */
  existingRegenerate?: boolean;
  /** Carousel flows only: show layout template control for Needs Edit. */
  showCarouselTemplateControl?: boolean;
  /** From last NEEDS_EDIT: true = “different template”; false/undefined = keep current (default). */
  existingCarouselReworkChangeTemplate?: boolean;
  /** Carousel flows: number of slides in the deck (for partial rework picker). */
  carouselSlideCount?: number;
  /** Show per-slide re-render picker on Needs Edit. */
  showCarouselSlideRework?: boolean;
  /** Restored from last NEEDS_EDIT `slide_rework_indices`. */
  existingSlideReworkIndices?: number[];
  /** Mimic carousel: hide issue-tag cloud (copy/layout edited elsewhere). */
  hideIssueTags?: boolean;
  /** Mimic carousel: compact decision card styling and copy. */
  mimicReviewMode?: boolean;
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
  finalSpokenScriptOverride,
  heygenAvatarId,
  heygenVoiceId,
  heygenForceRerender,
  includeHeyGenFields = false,
  hasEdits = false,
  editsSummary = [],
  existingRewriteCopy = true,
  notesAddendum,
  notesAddendumLabel = "Prompt analysis",
  skipVideoRegeneration,
  skipImageRegeneration,
  existingRegenerate,
  showCarouselTemplateControl = false,
  existingCarouselReworkChangeTemplate,
  carouselSlideCount = 0,
  showCarouselSlideRework = false,
  existingSlideReworkIndices,
  hideIssueTags = false,
  mimicReviewMode = false,
}: DecisionPanelProps) {
  const [decision, setDecision] = useState<DecisionValue | "">((existingDecision as DecisionValue) || "");
  const [notes, setNotes] = useState(existingNotes);
  const [tags, setTags] = useState<string[]>([]);
  const [validator, setValidator] = useState("");
  const [rewriteCopy, setRewriteCopy] = useState(existingRewriteCopy !== false);
  const [carouselReworkChangeTemplate, setCarouselReworkChangeTemplate] = useState(
    () => existingCarouselReworkChangeTemplate === true
  );
  const [regenerateAssets, setRegenerateAssets] = useState(
    () => existingRegenerate !== undefined ? existingRegenerate : true
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);
  const [slideReworkPartial, setSlideReworkPartial] = useState(true);
  const [slideReworkIndices, setSlideReworkIndices] = useState<number[]>([]);

  const defaultEditedSlideIndices = slideIndicesFromEditsSummary(editsSummary);

  const handleSlideReworkChange = useCallback(
    (state: { partialRework: boolean; selectedIndices: number[] }) => {
      setSlideReworkPartial(state.partialRework);
      setSlideReworkIndices(state.selectedIndices);
    },
    []
  );

  useEffect(() => {
    setRewriteCopy(existingRewriteCopy !== false);
  }, [existingRewriteCopy, taskId]);

  useEffect(() => {
    setRegenerateAssets(existingRegenerate !== undefined ? existingRegenerate : true);
  }, [existingRegenerate, taskId]);

  useEffect(() => {
    setCarouselReworkChangeTemplate(existingCarouselReworkChangeTemplate === true);
  }, [existingCarouselReworkChangeTemplate, taskId]);

  const submit = useCallback(async () => {
    if (!decision || !["APPROVED", "NEEDS_EDIT", "REJECTED"].includes(decision)) {
      setError("Select a decision: Approve, Needs Edit, or Reject");
      return;
    }
    setSubmitting(true);
    setError(null);
    const effectiveDecision = decision === "APPROVED" && hasEdits ? "NEEDS_EDIT" : decision;
    const sendHeyGenFields = includeHeyGenFields && effectiveDecision === "NEEDS_EDIT";
    const trimmedAddendum = (notesAddendum ?? "").trim();
    const combinedNotes = trimmedAddendum
      ? `${notes.trim() ? `${notes.trim()}\n\n` : ""}--- ${notesAddendumLabel} ---\n${trimmedAddendum}`
      : notes.trim();
    let rejectionTagsSubmit = tags;
    if (showCarouselTemplateControl && effectiveDecision === "NEEDS_EDIT" && !carouselReworkChangeTemplate) {
      rejectionTagsSubmit = tags.filter((t) => {
        const s = String(t).toLowerCase().trim();
        return s !== "carousel_template_change" && s !== "change_template";
      });
    }
    if (
      effectiveDecision === "NEEDS_EDIT" &&
      showCarouselSlideRework &&
      slideReworkPartial &&
      slideReworkIndices.length === 0
    ) {
      setError("Select at least one slide to re-render, or turn off “Re-render selected slides only”.");
      setSubmitting(false);
      return;
    }
    try {
      const res = await fetch("/api/task/decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          decision: effectiveDecision,
          ...(projectSlug ? { project_slug: projectSlug } : {}),
          notes: combinedNotes || undefined,
          rejection_tags: rejectionTagsSubmit,
          validator: validator.trim() || undefined,
          ...(finalTitleOverride !== undefined && { final_title_override: finalTitleOverride }),
          ...(finalHookOverride !== undefined && { final_hook_override: finalHookOverride }),
          ...(finalCaptionOverride !== undefined && { final_caption_override: finalCaptionOverride }),
          ...(finalHashtagsOverride !== undefined && { final_hashtags_override: finalHashtagsOverride }),
          ...(finalSlidesJsonOverride !== undefined && { final_slides_json_override: finalSlidesJsonOverride }),
          ...(sendHeyGenFields && finalSpokenScriptOverride !== undefined && {
            final_spoken_script_override: finalSpokenScriptOverride,
          }),
          ...(sendHeyGenFields && heygenAvatarId !== undefined && heygenAvatarId.trim() !== "" && {
            heygen_avatar_id: heygenAvatarId.trim(),
          }),
          ...(sendHeyGenFields && heygenVoiceId !== undefined && heygenVoiceId.trim() !== "" && {
            heygen_voice_id: heygenVoiceId.trim(),
          }),
          ...(sendHeyGenFields && heygenForceRerender === true && { heygen_force_rerender: true }),
          ...(effectiveDecision === "NEEDS_EDIT" ? { rewrite_copy: rewriteCopy } : {}),
          ...(effectiveDecision === "NEEDS_EDIT" && skipVideoRegeneration === true
            ? { skip_video_regeneration: true }
            : {}),
          ...(effectiveDecision === "NEEDS_EDIT" && skipImageRegeneration === true
            ? { skip_image_regeneration: true }
            : {}),
          regenerate: regenerateAssets,
          ...(showCarouselTemplateControl && effectiveDecision === "NEEDS_EDIT"
            ? { carousel_rework_change_template: carouselReworkChangeTemplate }
            : {}),
          ...(effectiveDecision === "NEEDS_EDIT" &&
          showCarouselSlideRework &&
          slideReworkPartial &&
          slideReworkIndices.length > 0
            ? { slide_rework_indices: slideReworkIndices }
            : {}),
        }),
      });
      if (!res.ok) {
        setError(await formatDecisionHttpError(res));
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
    finalSpokenScriptOverride,
    heygenAvatarId,
    heygenVoiceId,
    heygenForceRerender,
    includeHeyGenFields,
    hasEdits,
    rewriteCopy,
    notesAddendum,
    notesAddendumLabel,
    skipVideoRegeneration,
    skipImageRegeneration,
    regenerateAssets,
    showCarouselTemplateControl,
    carouselReworkChangeTemplate,
    showCarouselSlideRework,
    slideReworkPartial,
    slideReworkIndices,
  ]);

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  return (
    <div className={`card surface-warn${mimicReviewMode ? " decision-panel--mimic" : ""}`}>
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

      {!mimicReviewMode ? (
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            background: "var(--bg-secondary)",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
          }}
        >
          <label style={{ display: "flex", alignItems: "flex-start", gap: 10, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={regenerateAssets}
              onChange={(e) => setRegenerateAssets(e.target.checked)}
              style={{ marginTop: 3 }}
            />
            <span>
              <strong>Regenerate rendered assets</strong> — run billed media outputs again when the pipeline would
              charge another render (HeyGen, video tools, etc.).
              <span style={{ display: "block", fontSize: 12, color: "var(--fg-secondary)", marginTop: 6 }}>
                This is <strong>not</strong> <strong>Rewrite copy (LLM)</strong>. Carousel: if you change{" "}
                <strong>font sizes or font scale</strong> in Edits for rework, slide PNGs are always regenerated so
                thumbnails match — that path does not use this checkbox. Uncheck here mainly to skip expensive
                non-carousel reruns when you only want text patched.
              </span>
            </span>
          </label>
        </div>
      ) : (
        <div className="decision-panel--mimic__regen-hint">
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
            <input
              type="checkbox"
              checked={regenerateAssets}
              onChange={(e) => setRegenerateAssets(e.target.checked)}
            />
            <span>
              <strong>Regenerate images on Needs Edit rework</strong> — full-deck Flux pass when you submit rework.
            </span>
          </label>
          <p className="decision-panel--mimic__regen-note">
            Per-slide regen is in the text layout panel.
          </p>
        </div>
      )}

      {hasEdits && (
        <div style={{ marginBottom: 14 }}>
          {!mimicReviewMode ? (
            <p style={{ fontSize: 12, color: "var(--fg-secondary)" }}>
              Approve is only for no edits. Use <strong>Needs Edit</strong> when you changed:
            </p>
          ) : null}
          <p style={{ fontSize: 12, fontWeight: 600, color: "var(--yellow)", marginTop: mimicReviewMode ? 0 : 4 }}>
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

      {!hideIssueTags ? (
        <div style={{ marginBottom: 14 }}>
          <label className="filter-label">Issue tags (what went wrong — for the next generation)</label>
          <div style={{ padding: 12, background: "var(--bg-secondary)", borderRadius: 8, marginTop: 6, border: "1px solid var(--border-subtle)" }}>
            <p style={{ fontSize: 12, color: "var(--fg-secondary)", marginBottom: 8 }}>
              {includeHeyGenFields ? (
                <>
                  Use <strong style={{ color: "var(--fg)" }}>HeyGen video — edits for rework</strong> for script / avatar /
                  voice, and hook, caption, hashtags, and slides in <strong style={{ color: "var(--fg)" }}>Edits for rework</strong>{" "}
                  when applicable — stored on the NEEDS_EDIT row for the next rework pass.
                </>
              ) : (
                <>
                  Use hook, caption, hashtags, and slides in <strong style={{ color: "var(--fg)" }}>Edits for rework</strong>{" "}
                  — they are stored on the NEEDS_EDIT row and fed into the next rework pass.
                </>
              )}
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
      ) : null}

      {showCarouselSlideRework &&
        carouselSlideCount > 0 &&
        (decision === "NEEDS_EDIT" || hasEdits) && (
          <CarouselSlideReworkPicker
            slideCount={carouselSlideCount}
            defaultSelectedIndices={defaultEditedSlideIndices}
            existingSelectedIndices={existingSlideReworkIndices}
            onChange={handleSlideReworkChange}
            disabled={submitting || !!submittedMessage}
          />
        )}

      {showCarouselTemplateControl && (decision === "NEEDS_EDIT" || hasEdits) && (
        <div
          style={{
            marginBottom: 14,
            padding: 12,
            background: "var(--bg-secondary)",
            borderRadius: 8,
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div className="filter-label" style={{ marginBottom: 8 }}>
            Carousel layout template (next rework)
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13, marginBottom: 8 }}>
            <input
              type="radio"
              name="carousel-rework-template"
              checked={!carouselReworkChangeTemplate}
              onChange={() => setCarouselReworkChangeTemplate(false)}
            />
            <span>
              <strong>Keep current template</strong> — same `.hbs` layout (default)
            </span>
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer", fontSize: 13 }}>
            <input
              type="radio"
              name="carousel-rework-template"
              checked={carouselReworkChangeTemplate}
              onChange={() => setCarouselReworkChangeTemplate(true)}
            />
            <span>
              <strong>Use a different template</strong> — next full generation may pick another carousel layout
            </span>
          </label>
          <p style={{ fontSize: 12, color: "var(--muted)", margin: "10px 0 0" }}>
            Only affects full carousel regen. Copy-only / override-only rework is unchanged. Issue tag{" "}
            <span className="font-mono" style={{ fontSize: 11 }}>
              carousel_template_change
            </span>{" "}
            is ignored when “Keep current” is selected.
          </p>
        </div>
      )}

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
              <strong>Rewrite copy (LLM)</strong>
              {mimicReviewMode ? (
                <> — let the model rewrite narrative on rework. Uncheck to keep your edited text.</>
              ) : (
                <>
                  {" "}
                  — let the language model produce new narrative copy on rework. Uncheck to patch in your edited text
                  only (override-only) when the pipeline allows it.
                  <span style={{ display: "block", fontSize: 12, color: "var(--fg-secondary)", marginTop: 6 }}>
                    Independent from <strong>Regenerate rendered assets</strong> above: this toggle does{" "}
                    <strong>not</strong> turn carousel PNGs or HeyGen on or off — use the regenerate checkbox for billed
                    renders.
                  </span>
                  {includeHeyGenFields ? (
                    <span style={{ display: "block", fontSize: 12, color: "var(--fg-secondary)", marginTop: 4 }}>
                      For HeyGen: uncheck to drive re-render from your script / avatar / voice edits without a full LLM
                      rewrite.
                    </span>
                  ) : (
                    <span style={{ display: "block", fontSize: 12, color: "var(--fg-secondary)", marginTop: 4 }}>
                      If checked while override-only is possible, the model may still run but can be instructed to keep
                      your text verbatim.
                    </span>
                  )}
                </>
              )}
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
