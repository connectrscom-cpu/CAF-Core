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

  const { latestValidation, history, reviewSnapshot, draftPackage, draftMeta, carouselGenerationSlice } = useMemo(() => {
    const j = job ?? {};
    const reviews = Array.isArray((j as any).reviews) ? ((j as any).reviews as unknown[]) : [];
    const reviewRecs = reviews.map((r) => asRec(r)).filter(Boolean) as Record<string, unknown>[];

    const reviewSnap = asRec((j as any).review_snapshot) ?? null;
    const snapVo = reviewSnap?.validation_output ?? null;

    const fromJob = (j as any).latest_validation_output_json ?? null;
    const firstReviewOut =
      reviewRecs.length > 0 ? (reviewRecs[0]!.validation_output_json as unknown) ?? null : null;
    const latest =
      (fromJob && typeof fromJob === "object" ? fromJob : null) ??
      (firstReviewOut && typeof firstReviewOut === "object" ? firstReviewOut : null) ??
      (snapVo && typeof snapVo === "object" ? snapVo : null);

    const historyRows = reviewRecs.map((r) => ({
      id: String(r.id ?? ""),
      created_at: String(r.created_at ?? ""),
      decision: String(r.decision ?? ""),
      validator: String(r.validator ?? ""),
      submitted_at: r.submitted_at != null ? String(r.submitted_at) : null,
      schema_version: String(r.validation_schema_version ?? ""),
      validation_output_json: (r.validation_output_json as unknown) ?? null,
    }));

    const gp = asRec((j as any).generation_payload) ?? {};
    const draft = gp.draft_package_snapshot ?? null;
    const meta = {
      draft_package_type: gp.draft_package_type ?? null,
      draft_package_warnings: gp.draft_package_warnings ?? [],
      draft_package_errors: gp.draft_package_errors ?? [],
    };

    const rsjRaw = (j as any).review_slides_json;
    let reviewSlidesParsed: unknown = null;
    if (typeof rsjRaw === "string" && rsjRaw.trim()) {
      try {
        reviewSlidesParsed = JSON.parse(rsjRaw) as unknown;
      } catch {
        reviewSlidesParsed = rsjRaw;
      }
    }
    const carouselSource: Record<string, unknown> = {};
    if (reviewSlidesParsed != null) carouselSource.review_slides_json = reviewSlidesParsed;
    const genOut = gp.generated_output;
    if (genOut && typeof genOut === "object") carouselSource.generated_output = genOut as Record<string, unknown>;
    if (gp.slides != null) carouselSource.generation_payload_slides = gp.slides;
    if (gp.publish_image_urls != null) carouselSource.publish_image_urls = gp.publish_image_urls;
    if (gp.publish_media_urls != null) carouselSource.publish_media_urls = gp.publish_media_urls;
    const carouselGenerationSlice = Object.keys(carouselSource).length > 0 ? carouselSource : null;

    return {
      latestValidation: latest,
      history: historyRows,
      reviewSnapshot: reviewSnap,
      draftPackage: draft,
      draftMeta: meta,
      carouselGenerationSlice,
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
        <span className="font-mono">validation_output.reviewed_content</span> is a compact snapshot at submit time: only fields
        Core could resolve (caption, title, slides, etc.) are included — missing keys were empty in the job payload then. The LLM
        “draft package” lives in <span className="font-mono">draft_package_snapshot</span> when the generator persists it;
        otherwise full carousel copy is under <span className="font-mono">generation_payload</span> (see section below).
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
          Carousel / copy source (merged slides + generated_output)
        </summary>
        <p style={{ margin: "8px 0 6px", fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
          Same merge Core uses for review UI: <span className="font-mono">review_slides_json</span> plus raw{" "}
          <span className="font-mono">generation_payload</span> slices. Rendered slide files are listed under the assets API.
        </p>
        <pre className="slides-json" style={{ marginTop: 4, maxHeight: expanded ? 560 : 280 }}>
          {pretty(carouselGenerationSlice)}
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

