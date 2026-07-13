"use client";

import { useMemo, useState } from "react";
import { buildNewVisualSlideWhyContext } from "@/lib/new-visual-slide-why";

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value?.trim()) return null;
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.4 }}>
      <span style={{ flex: "0 0 116px", opacity: 0.6 }}>{label}</span>
      <span style={{ flex: 1 }}>{value}</span>
    </div>
  );
}

export function NewVisualSlideWhyPanel({
  generationPayload,
  mimicV1,
  slideIndex,
  slideCount,
  generatedOnScreenText,
  defaultOpen = false,
}: {
  generationPayload: Record<string, unknown> | null | undefined;
  mimicV1: Record<string, unknown> | null | undefined;
  slideIndex: number;
  slideCount: number;
  generatedOnScreenText?: string | null;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  const ctx = useMemo(
    () =>
      buildNewVisualSlideWhyContext({
        generationPayload,
        mimicV1,
        slideIndex,
        slideCount,
        generatedOnScreenText,
      }),
    [generationPayload, mimicV1, slideIndex, slideCount, generatedOnScreenText]
  );

  if (!ctx) return null;

  return (
    <div
      style={{
        border: "1px solid rgba(127,127,127,0.25)",
        borderRadius: 8,
        padding: "8px 10px",
        margin: "8px 0",
        background: "rgba(127,127,127,0.05)",
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          background: "none",
          border: "none",
          padding: 0,
          cursor: "pointer",
          font: "inherit",
          color: "inherit",
        }}
        aria-expanded={open}
      >
        <span style={{ fontWeight: 600, fontSize: 12 }}>Why this works</span>
        <span style={{ fontSize: 11, opacity: 0.55 }}>
          slide {slideIndex} · {ctx.slideRole} · original concept
        </span>
        <span style={{ marginLeft: "auto", fontSize: 11, opacity: 0.5 }}>{open ? "▾" : "▸"}</span>
      </button>

      {open ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 11, opacity: 0.58, lineHeight: 1.35 }}>
            Strategy for this new visual carousel — grounded in the pack idea and per-slide art direction, not a
            top-performer reference replica.
          </div>
          <Field label="Arc position" value={ctx.arcPosition} />
          <Field label="Narrative job" value={ctx.slideArgument} />
          <Field label="Visual direction" value={ctx.visualDirection} />
          <Field label="Visual metaphor" value={ctx.visualMetaphor} />
          <Field label="Must avoid" value={ctx.mustAvoid} />
          {ctx.generatedCopy ? <Field label="Generated copy" value={ctx.generatedCopy} /> : null}

          <details style={{ marginTop: 6 }}>
            <summary style={{ fontSize: 11, opacity: 0.65, cursor: "pointer" }}>Deck strategy</summary>
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              <Field label="Deck concept" value={ctx.deckConcept} />
              <Field label="Thesis" value={ctx.thesis} />
              <Field label="Novelty angle" value={ctx.noveltyAngle} />
              {ctx.keyPoints.length > 0 ? (
                <Field label="Key points" value={ctx.keyPoints.join(" · ")} />
              ) : null}
            </div>
          </details>
        </div>
      ) : null}
    </div>
  );
}

export default NewVisualSlideWhyPanel;
