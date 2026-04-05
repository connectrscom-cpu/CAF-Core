"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

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
          rejection_tags: rejectionTags ? rejectionTags.split(",").map((t) => t.trim()).filter(Boolean) : undefined,
          validator: "reviewer",
        }),
      });
      if (res.ok) {
        router.push("/?tab=in_review");
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
      <div className="flex gap-2 mb-4" style={{ gap: 8 }}>
        {[
          { val: "APPROVED", cls: "btn-approve", label: "Approve" },
          { val: "NEEDS_EDIT", cls: "btn-edit", label: "Needs Edit" },
          { val: "REJECTED", cls: "btn-reject", label: "Reject" },
        ].map((b) => (
          <button
            key={b.val}
            type="button"
            className={b.cls}
            onClick={() => setDecision(b.val)}
            style={{ opacity: decision === b.val ? 1 : 0.4, transform: decision === b.val ? "scale(1.05)" : "none" }}
          >
            {b.label}
          </button>
        ))}
      </div>
      {decision === "REJECTED" && (
        <input
          placeholder="Rejection tags (comma separated)"
          value={rejectionTags}
          onChange={(e) => setRejectionTags(e.target.value)}
          className="mb-4"
        />
      )}
      <textarea
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={3}
        className="mb-4"
      />
      <button className="btn-primary" disabled={!decision || submitting} onClick={submit} style={{ width: "100%" }}>
        {submitting ? "Submitting..." : "Submit Decision"}
      </button>
    </div>
  );
}
