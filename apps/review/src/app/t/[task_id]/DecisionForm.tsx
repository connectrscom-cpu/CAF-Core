"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const DECISIONS = [
  { val: "APPROVED", cls: "decision-btn-approve", label: "Approve" },
  { val: "NEEDS_EDIT", cls: "decision-btn-edit", label: "Needs Edit" },
  { val: "REJECTED", cls: "decision-btn-reject", label: "Reject" },
] as const;

export function DecisionForm({ taskId, project }: { taskId: string; project: string }) {
  const router = useRouter();
  const [decision, setDecision] = useState("");
  const [notes, setNotes] = useState("");
  const [rejectionTags, setRejectionTags] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!decision) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          project_slug: project,
          task_id: taskId,
          decision,
          notes: notes || undefined,
          rejection_tags: rejectionTags
            ? rejectionTags.split(",").map((t) => t.trim()).filter(Boolean)
            : undefined,
          validator: "reviewer",
        }),
      });
      if (res.ok) {
        router.push("/?status=in_review");
        router.refresh();
      } else {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "Failed to submit decision");
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <div className="decision-buttons">
        {DECISIONS.map((b) => (
          <button
            key={b.val}
            type="button"
            className={`decision-btn ${b.cls} ${decision === b.val ? "selected" : ""}`}
            onClick={() => setDecision(decision === b.val ? "" : b.val)}
          >
            {b.label}
          </button>
        ))}
      </div>

      {decision === "REJECTED" && (
        <div className="mb-3">
          <label className="filter-label">Rejection tags</label>
          <input
            placeholder="e.g. low-quality, off-brand, wrong-format"
            value={rejectionTags}
            onChange={(e) => setRejectionTags(e.target.value)}
          />
        </div>
      )}

      <div className="mb-3">
        <label className="filter-label">Notes (optional)</label>
        <textarea
          placeholder="Add review notes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
      </div>

      <button
        className="btn-primary"
        disabled={!decision || submitting}
        onClick={submit}
        style={{ width: "100%" }}
      >
        {submitting ? "Submitting..." : `Submit — ${decision || "select decision"}`}
      </button>
    </div>
  );
}
