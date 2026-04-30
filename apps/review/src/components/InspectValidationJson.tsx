"use client";

import { useMemo, useState } from "react";

function asRec(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pretty(v: unknown): string {
  try {
    return JSON.stringify(v, null, 2);
  } catch {
    return String(v);
  }
}

export interface InspectValidationJsonProps {
  /** Full job detail from Core (`include_job=1`). */
  job: Record<string, unknown> | null;
}

export function InspectValidationJson({ job }: InspectValidationJsonProps) {
  const [expanded, setExpanded] = useState(false);

  const { latestValidation, history, reviewSnapshot, draftPackage, draftMeta } = useMemo(() => {
    const j = job ?? {};
    const latest = (j as any).latest_validation_output_json ?? null;
    const reviews = Array.isArray((j as any).reviews) ? ((j as any).reviews as unknown[]) : [];
    const historyRows = reviews
      .map((r) => asRec(r))
      .filter(Boolean)
      .map((r) => ({
        id: String(r!.id ?? ""),
        created_at: String(r!.created_at ?? ""),
        decision: String(r!.decision ?? ""),
        schema_version: String(r!.validation_schema_version ?? ""),
        validation_output_json: r!.validation_output_json ?? null,
      }))
      .filter((x) => x.validation_output_json != null || x.schema_version || x.decision || x.created_at);

    const reviewSnap = asRec((j as any).review_snapshot) ?? null;
    const gp = asRec((j as any).generation_payload) ?? {};
    const draft = gp.draft_package_snapshot ?? null;
    const meta = {
      draft_package_type: gp.draft_package_type ?? null,
      draft_package_warnings: gp.draft_package_warnings ?? [],
      draft_package_errors: gp.draft_package_errors ?? [],
    };
    return {
      latestValidation: latest,
      history: historyRows,
      reviewSnapshot: reviewSnap,
      draftPackage: draft,
      draftMeta: meta,
    };
  }, [job]);

  if (!job) {
    return (
      <div className="card">
        <div className="card-header">Inspect JSON</div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No job payload loaded.</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span>Inspect JSON</span>
        <button type="button" className="btn-ghost" onClick={() => setExpanded((v) => !v)} style={{ fontSize: 12 }}>
          {expanded ? "Collapse" : "Expand"}
        </button>
      </div>

      <p style={{ margin: "8px 0 12px", fontSize: 12, color: "var(--fg-secondary)", lineHeight: 1.45 }}>
        Shows the structured <span className="font-mono">validation_output_json</span> (latest + history) and the stored{" "}
        <span className="font-mono">draft_package_snapshot</span> for traceability.
      </p>

      <details open={expanded} style={{ marginTop: 8 }}>
        <summary style={{ cursor: "pointer", color: "var(--fg-secondary)", fontSize: 13 }}>
          Latest validation output (from Core)
        </summary>
        <pre className="slides-json" style={{ marginTop: 8, maxHeight: expanded ? 520 : 260 }}>
          {pretty(latestValidation)}
        </pre>
      </details>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", color: "var(--fg-secondary)", fontSize: 13 }}>
          Validation history (all editorial reviews)
        </summary>
        <pre className="slides-json" style={{ marginTop: 8, maxHeight: expanded ? 520 : 260 }}>
          {pretty(history)}
        </pre>
      </details>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", color: "var(--fg-secondary)", fontSize: 13 }}>
          Draft package snapshot (generation_payload.draft_package_snapshot)
        </summary>
        <pre className="slides-json" style={{ marginTop: 8, maxHeight: expanded ? 520 : 260 }}>
          {pretty(draftPackage)}
        </pre>
        <pre className="slides-json" style={{ marginTop: 8, maxHeight: 240, opacity: 0.95 }}>
          {pretty(draftMeta)}
        </pre>
      </details>

      <details style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", color: "var(--fg-secondary)", fontSize: 13 }}>
          content_jobs.review_snapshot
        </summary>
        <pre className="slides-json" style={{ marginTop: 8, maxHeight: expanded ? 520 : 260 }}>
          {pretty(reviewSnapshot)}
        </pre>
      </details>
    </div>
  );
}

