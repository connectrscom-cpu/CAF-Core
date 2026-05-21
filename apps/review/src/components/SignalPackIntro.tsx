"use client";

import Link from "next/link";
import { CafTerm } from "@/components/CafTerm";

const STRUCTURE_EXAMPLE = `{
  "run_id": "SNS_2026W14",
  "source_inputs_import_id": "<uuid of evidence import>",
  "ideas_json": [
    {
      "idea_id": "ig_001",
      "content_idea": "Hook: why silent rooms fail…",
      "platform": "Instagram",
      "format": "carousel",
      "confidence": 0.82
    }
  ],
  "overall_candidates_json": [
    {
      "candidate_id": "SNS_2026W14_Instagram_0001",
      "platform": "Instagram",
      "format": "carousel",
      "content_idea": "…"
    }
  ],
  "derived_globals_json": {
    "hashtag_leaderboard_v1": [{ "hashtag": "#acoustic", "count": 12 }],
    "visual_guidelines_v1": { "carousel": { "typography": "…" } },
    "signal_pack_publication_hints": { "hashtag_seeds": ["…"] }
  }
}`;

type Props = {
  /** Link to Processing step 5 (pack build) when embedded in Admin. */
  processingHref?: string | null;
};

/** Short intro on the Signal packs tab — research bundle before runs/jobs exist. */
export function SignalPackIntro({ processingHref }: Props) {
  return (
    <div className="card signal-pack-intro" style={{ marginBottom: 16, padding: "16px 18px" }}>
      <div className="card-header" style={{ marginBottom: 10, paddingBottom: 8 }}>
        What is a <CafTerm term="signalPack">signal pack</CafTerm>?
      </div>

      <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--fg2)", margin: "0 0 12px" }}>
        A signal pack is the <strong>research handoff</strong> for one content cycle: curated{" "}
        <CafTerm term="ideas">ideas</CafTerm> plus globals distilled from{" "}
        <CafTerm term="evidence">evidence</CafTerm> and <CafTerm term="insights">insights</CafTerm>. It is stored
        as one database row before any run exists. When you create a run, you attach a pack — the planner reads it
        and materializes <CafTerm term="jobs">jobs</CafTerm> (one idea × enabled flow).
      </p>

      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--muted)", margin: "0 0 6px", textTransform: "uppercase", letterSpacing: "0.04em" }}>
        What it holds
      </p>
      <ul style={{ fontSize: 13, lineHeight: 1.5, color: "var(--fg2)", margin: "0 0 12px", paddingLeft: 18 }}>
        <li>
          <code style={{ fontSize: 12 }}>ideas_json</code> — curated concepts (platform, format, hook, confidence)
        </li>
        <li>
          <code style={{ fontSize: 12 }}>overall_candidates_json</code> — planner-facing rows (rated / synthesized
          from evidence)
        </li>
        <li>
          <code style={{ fontSize: 12 }}>derived_globals_json</code> — hashtags, visual guidelines, publication
          hints, top-performer knowledge
        </li>
        <li>
          <code style={{ fontSize: 12 }}>source_inputs_import_id</code> — trace back to the INPUTS import that fed
          the pack
        </li>
      </ul>

      <details style={{ marginBottom: 12 }}>
        <summary style={{ fontSize: 13, fontWeight: 500, cursor: "pointer", color: "var(--fg)" }}>
          Structure example (simplified)
        </summary>
        <pre
          style={{
            marginTop: 10,
            padding: 12,
            fontSize: 11,
            lineHeight: 1.45,
            overflow: "auto",
            maxHeight: 280,
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg)",
            color: "var(--fg2)",
          }}
        >
          {STRUCTURE_EXAMPLE}
        </pre>
      </details>

      <p style={{ fontSize: 13, lineHeight: 1.55, color: "var(--fg2)", margin: 0 }}>
        <strong>Research → creation bridge:</strong> Processing ends with a pack; Runs begins by picking that pack.
        Idea picking (automated, LLM, or manual) chooses which pack ideas become planned jobs;{" "}
        <strong>Start</strong> on the run turns them into executable jobs for generation, QC, render, and review.
        {processingHref ? (
          <>
            {" "}
            Build new packs in{" "}
            <Link href={processingHref} style={{ color: "var(--accent)", fontWeight: 500 }}>
              Processing → Signal pack (step 5)
            </Link>
            .
          </>
        ) : null}
      </p>
    </div>
  );
}
