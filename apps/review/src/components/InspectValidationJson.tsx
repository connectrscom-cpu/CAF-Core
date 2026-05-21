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

function pickCarouselTemplateName(generationPayload: Record<string, unknown>): string {
  const gp = generationPayload ?? {};
  const go = asRec((gp as any).generated_output) ?? null;
  const goRender = go ? asRec((go as any).render) : null;
  const gpRender = asRec((gp as any).render) ?? null;
  const v =
    (goRender?.html_template_name as unknown) ??
    (goRender?.template_key as unknown) ??
    (gpRender?.html_template_name as unknown) ??
    (gpRender?.template_key as unknown) ??
    ((gp as any).template as unknown) ??
    ((go as any)?.template as unknown);
  const s = typeof v === "string" ? v.trim() : "";
  if (!s) return "";
  return s.replace(/\.hbs$/i, "");
}

export interface InspectValidationJsonProps {
  /** Full job detail from Core (`include_job=1`). */
  job: Record<string, unknown> | null;
}

export function InspectValidationJson({ job }: InspectValidationJsonProps) {
  const [expanded, setExpanded] = useState(false);
  const [copyHint, setCopyHint] = useState<string | null>(null);

  const {
    latestValidation,
    latestReviewedContent,
    history,
    reviewSnapshot,
    draftPackage,
    draftMeta,
    carouselGenerationSlice,
    carouselInspectMeta,
  } = useMemo(() => {
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

    const latestReviewedContent =
      latest && typeof latest === "object" && !Array.isArray(latest)
        ? ((latest as Record<string, unknown>).reviewed_content ?? null)
        : null;

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
    const templateUsed = pickCarouselTemplateName(gp);
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
    if (templateUsed) carouselSource.carousel_template_used = templateUsed;
    if (reviewSlidesParsed != null) carouselSource.review_slides_json = reviewSlidesParsed;
    const genOut = gp.generated_output;
    if (genOut && typeof genOut === "object") carouselSource.generated_output = genOut as Record<string, unknown>;
    if (gp.slides != null) carouselSource.generation_payload_slides = gp.slides;
    if (gp.publish_image_urls != null) carouselSource.publish_image_urls = gp.publish_image_urls;
    if (gp.publish_media_urls != null) carouselSource.publish_media_urls = gp.publish_media_urls;
    const carouselGenerationSlice = Object.keys(carouselSource).length > 0 ? carouselSource : null;

    const genOutObj =
      genOut && typeof genOut === "object" && !Array.isArray(genOut)
        ? (genOut as Record<string, unknown>)
        : null;
    const slidesFromGen = genOutObj && Array.isArray(genOutObj.slides) ? (genOutObj.slides as unknown[]) : null;
    const slidesTop = Array.isArray(gp.slides) ? (gp.slides as unknown[]) : null;
    const slideRowCount =
      slidesFromGen != null ? slidesFromGen.length : slidesTop != null ? slidesTop.length : null;

    const carouselInspectMeta = {
      task_id: String((j as any).task_id ?? "").trim(),
      template_used: templateUsed,
      slide_row_count: slideRowCount,
      template_path_hint: templateUsed ? `services/renderer/templates/${templateUsed}.hbs` : "",
    };

    return {
      latestValidation: latest,
      latestReviewedContent,
      history: historyRows,
      reviewSnapshot: reviewSnap,
      draftPackage: draft,
      draftMeta: meta,
      carouselGenerationSlice,
      carouselInspectMeta,
    };
  }, [job]);

  async function copyJsonSnippet(label: string, payload: unknown) {
    try {
      await navigator.clipboard.writeText(pretty(payload));
      setCopyHint(label);
      window.setTimeout(() => setCopyHint(null), 2200);
    } catch {
      setCopyHint("Copy failed");
      window.setTimeout(() => setCopyHint(null), 2200);
    }
  }

  if (!job) {
    return (
    <div className="card surface-purple">
      <div className="card-header">Inspect JSON</div>
        <p style={{ margin: 0, fontSize: 13, color: "var(--muted)" }}>No job payload loaded.</p>
      </div>
    );
  }

  return (
    <div className="card surface-purple">
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

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", margin: "0 0 12px" }}>
        <button
          type="button"
          className="btn-ghost"
          style={{ fontSize: 12 }}
          disabled={!latestValidation}
          onClick={() => latestValidation && copyJsonSnippet("Validation output copied", latestValidation)}
        >
          Copy latest validation output
        </button>
        <button
          type="button"
          className="btn-ghost"
          style={{ fontSize: 12 }}
          disabled={latestReviewedContent == null}
          onClick={() => latestReviewedContent != null && copyJsonSnippet("reviewed_content copied", latestReviewedContent)}
        >
          Copy reviewed_content
        </button>
        <button
          type="button"
          className="btn-ghost"
          style={{ fontSize: 12 }}
          disabled={draftPackage == null}
          onClick={() => draftPackage != null && copyJsonSnippet("Draft package copied", draftPackage)}
        >
          Copy draft_package_snapshot
        </button>
        {copyHint ? <span style={{ fontSize: 11, color: "var(--muted)" }}>{copyHint}</span> : null}
      </div>

      <details open style={{ marginTop: 10 }}>
        <summary style={{ cursor: "pointer", color: "var(--fg-secondary)", fontSize: 13, fontWeight: 600 }}>
          Carousel render package (quick facts)
        </summary>
        <div style={{ marginTop: 10, fontSize: 12, lineHeight: 1.55, color: "var(--fg-secondary)" }}>
          {carouselInspectMeta.task_id ? (
            <div>
              <span style={{ color: "var(--muted)" }}>task_id </span>
              <span className="font-mono">{carouselInspectMeta.task_id}</span>
            </div>
          ) : null}
          <div style={{ marginTop: 6 }}>
            <span style={{ color: "var(--muted)" }}>template </span>
            {carouselInspectMeta.template_used ? (
              <span className="font-mono">{carouselInspectMeta.template_used}</span>
            ) : (
              <span style={{ color: "var(--muted)" }}>(unset until Core persists render template / explicit payload)</span>
            )}
          </div>
          {carouselInspectMeta.template_path_hint ? (
            <div style={{ marginTop: 4, fontSize: 11, wordBreak: "break-all", opacity: 0.9 }}>
              <span style={{ color: "var(--muted)" }}>repo path </span>
              <span className="font-mono">{carouselInspectMeta.template_path_hint}</span>
            </div>
          ) : null}
          <div style={{ marginTop: 6 }}>
            <span style={{ color: "var(--muted)" }}>slide rows in payload </span>
            {carouselInspectMeta.slide_row_count != null ? (
              <strong>{carouselInspectMeta.slide_row_count}</strong>
            ) : (
              <span style={{ color: "var(--muted)" }}>—</span>
            )}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginTop: 12 }}>
            <button
              type="button"
              className="btn-ghost"
              style={{ fontSize: 12 }}
              disabled={!carouselGenerationSlice}
              onClick={() => carouselGenerationSlice && copyJsonSnippet("Carousel slice copied", carouselGenerationSlice)}
            >
              Copy carousel / copy source JSON
            </button>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              draft package:{" "}
              {draftPackage != null ? (
                <strong style={{ color: "var(--fg-secondary)" }}>present</strong>
              ) : (
                <span style={{ color: "var(--muted)" }}>missing (generator did not persist)</span>
              )}
            </span>
          </div>
        </div>
      </details>

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
          reviewed_content (from latest validation output)
        </summary>
        <p style={{ margin: "8px 0 6px", fontSize: 11, color: "var(--muted)", lineHeight: 1.45 }}>
          This is the compact snapshot stored at submit time (may omit fields not resolvable then).
        </p>
        <pre className="slides-json" style={{ marginTop: 4, maxHeight: expanded ? 520 : 260 }}>
          {pretty(latestReviewedContent)}
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
        {draftPackage == null ? (
          <p style={{ margin: "8px 0 0", fontSize: 12, color: "var(--muted)", lineHeight: 1.45 }}>
            Not present on this job. The generator only writes this when it persists a draft package; otherwise inspect the
            carousel copy under <span className="font-mono">generation_payload</span> (section above).
          </p>
        ) : null}
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

