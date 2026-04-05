"use client";

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
  onSuccess?: () => void;
  existingDecision?: string;
  existingNotes?: string;
}

export function DecisionPanel({ taskId, onSuccess, existingDecision, existingNotes = "" }: DecisionPanelProps) {
  const [decision, setDecision] = useState<DecisionValue | "">((existingDecision as DecisionValue) || "");
  const [notes, setNotes] = useState(existingNotes);
  const [tags, setTags] = useState<string[]>([]);
  const [validator, setValidator] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submittedMessage, setSubmittedMessage] = useState<string | null>(null);

  const submit = useCallback(async () => {
    if (!decision || !["APPROVED", "NEEDS_EDIT", "REJECTED"].includes(decision)) {
      setError("Select a decision");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/task/${encodeURIComponent(taskId)}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, notes: notes.trim() || undefined, rejection_tags: tags, validator: validator.trim() || undefined }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(json.error ?? `HTTP ${res.status}`);
        return;
      }
      setSubmittedMessage(decision === "APPROVED" ? "Approved" : "Decision submitted");
      setTimeout(() => onSuccess?.(), 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setSubmitting(false);
    }
  }, [decision, notes, tags, validator, taskId, onSuccess]);

  const toggleTag = (tag: string) => {
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  return (
    <div className="space-y-4 rounded-lg border bg-card p-4 text-card-foreground">
      <h3 className="text-sm font-semibold">Decision</h3>
      <div className="flex flex-wrap gap-2">
        <Button variant={decision === "APPROVED" ? "success" : "outline"} size="sm" onClick={() => setDecision("APPROVED")}>Approve</Button>
        <Button variant={decision === "NEEDS_EDIT" ? "warning" : "outline"} size="sm" onClick={() => setDecision("NEEDS_EDIT")}>Needs Edit</Button>
        <Button variant={decision === "REJECTED" ? "destructive" : "outline"} size="sm" onClick={() => setDecision("REJECTED")}>Reject</Button>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Notes</Label>
        <textarea className="min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" placeholder="Optional notes" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>

      <div className="grid gap-3">
        <Label className="text-xs">Issue tags</Label>
        <div className="flex flex-wrap gap-1.5 rounded-md border p-3">
          {REVIEW_ISSUE_TAGS.map((tag) => (
            <button key={tag} type="button" onClick={() => toggleTag(tag)} className={cn("rounded-md border px-2 py-1 text-xs transition-colors", tags.includes(tag) ? "border-primary bg-primary text-primary-foreground" : "border-input bg-background hover:bg-muted")}>{tag}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-2">
        <Label className="text-xs">Validator</Label>
        <input type="text" className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" placeholder="Your name or ID" value={validator} onChange={(e) => setValidator(e.target.value)} />
      </div>

      {submittedMessage && <p className="text-sm font-medium text-green-700 dark:text-green-400">{submittedMessage}. Taking you back…</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={submitting || !!submittedMessage}>
        {submitting ? "Submitting…" : submittedMessage ? "Submitted" : "Submit decision"}
      </Button>
    </div>
  );
}
