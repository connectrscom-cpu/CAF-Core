"use client";

/**
 * Why Mimic — read-only per-slide intelligence panel.
 * Reads the projected `mimic_v1.slide_intelligence` bundle and shows, for the
 * active slide, what the reference slide is *doing* and *why it works*.
 * Render-only: it never affects layout, copy, or render. Editing/correction is
 * handled separately (operator correction -> learning_observation).
 */
import { useMemo, useState } from "react";
import {
  parseSlideIntelligenceBundle,
  type SlideIntelligenceV1,
} from "@caf-core-carousel/slide-intelligence";

function confidenceLabel(c: number): string {
  if (c >= 0.66) return "high";
  if (c >= 0.4) return "medium";
  return "low";
}

function Field({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value || !value.trim()) return null;
  return (
    <div style={{ display: "flex", gap: 8, fontSize: 12, lineHeight: 1.4 }}>
      <span style={{ flex: "0 0 116px", opacity: 0.6 }}>{label}</span>
      <span style={{ flex: 1 }}>{value}</span>
    </div>
  );
}

const CORRECTABLE_FIELDS: Array<{ id: string; label: string }> = [
  { id: "slide_role", label: "Role" },
  { id: "narrative_function", label: "Narrative job" },
  { id: "emotion", label: "Emotion" },
  { id: "psychological_trigger", label: "Psychological trigger" },
  { id: "persuasion_mechanism", label: "Persuasion mechanism" },
  { id: "why_it_works", label: "Why it works" },
  { id: "visual_description", label: "Image description" },
];

export function MimicSlideWhyPanel({
  mimicV1,
  slideIndex,
  taskId,
  projectSlug,
}: {
  mimicV1: Record<string, unknown> | null | undefined;
  slideIndex: number;
  taskId?: string;
  projectSlug?: string;
}) {
  const [open, setOpen] = useState(true);
  const [correcting, setCorrecting] = useState(false);
  const [field, setField] = useState(CORRECTABLE_FIELDS[0].id);
  const [value, setValue] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const bundle = useMemo(
    () => parseSlideIntelligenceBundle(mimicV1?.slide_intelligence),
    [mimicV1]
  );

  const slide: SlideIntelligenceV1 | null = useMemo(() => {
    if (!bundle) return null;
    return (
      bundle.slides.find((s) => s.slide_index === slideIndex) ??
      bundle.slides[slideIndex - 1] ??
      null
    );
  }, [bundle, slideIndex]);

  const canCorrect = !!taskId?.trim();

  async function submitCorrection() {
    const trimmed = value.trim();
    if (!trimmed || !taskId?.trim()) return;
    setStatus("saving");
    setStatusMsg(null);
    try {
      const original =
        slide && field in slide ? (slide[field as keyof SlideIntelligenceV1] as unknown) : null;
      const res = await fetch("/api/task/slide-intelligence-correction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          task_id: taskId,
          slide_index: slideIndex,
          field,
          corrected_value: trimmed,
          original_value: typeof original === "string" ? original : null,
          ...(projectSlug?.trim() ? { project: projectSlug.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `HTTP ${res.status}`);
      }
      setStatus("saved");
      setStatusMsg("Correction recorded");
      setValue("");
      setCorrecting(false);
    } catch (err) {
      setStatus("error");
      setStatusMsg(err instanceof Error ? err.message : "Failed to save");
    }
  }

  if (!bundle) return null;

  const why = bundle.why_analysis;
  const mechanisms = slide
    ? [slide.psychological_trigger, slide.attention_device, slide.curiosity_mechanism, slide.persuasion_mechanism]
        .filter((m): m is string => !!m && m.trim().length > 0)
    : [];

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
          slide {slideIndex}
          {slide ? ` · ${slide.slide_role ?? "?"}` : ""}
        </span>
        {slide ? (
          <span
            style={{ fontSize: 10, opacity: 0.5, marginLeft: "auto" }}
            title={`provider: ${slide.provider}`}
          >
            confidence: {confidenceLabel(slide.confidence)}
          </span>
        ) : null}
        <span style={{ marginLeft: slide ? 8 : "auto", fontSize: 11, opacity: 0.5 }}>
          {open ? "▾" : "▸"}
        </span>
      </button>

      {open ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
          {slide ? (
            <>
              <Field label="Role" value={slide.slide_role} />
              <Field label="Narrative job" value={slide.narrative_function} />
              <Field label="Emotion" value={slide.emotion} />
              {mechanisms.length > 0 ? <Field label="Mechanisms" value={mechanisms.join(" · ")} /> : null}
              <Field label="Visual role" value={slide.visual_role} />
              {slide.symbolic_elements.length > 0 ? (
                <Field
                  label="Symbolism"
                  value={slide.symbolic_elements
                    .map((s) =>
                      s.connotations.length > 0 ? `${s.element} → ${s.connotations.join(", ")}` : s.element
                    )
                    .join("; ")}
                />
              ) : null}
              <Field label="Why it works" value={slide.why_it_works} />
              <Field label="Image description" value={slide.visual_description} />
              {slide.on_screen_text ? (
                <Field label="On-screen text" value={slide.on_screen_text} />
              ) : null}
            </>
          ) : (
            <div style={{ fontSize: 12, opacity: 0.6 }}>No per-slide intelligence for this slide.</div>
          )}

          {why ? (
            <details style={{ marginTop: 6 }}>
              <summary style={{ fontSize: 11, opacity: 0.65, cursor: "pointer" }}>Deck strategy</summary>
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                <Field label="Strategic intent" value={why.strategic_thesis} />
                <Field label="Dominant" value={why.dominant_mechanism} />
                <Field
                  label="Narrative spine"
                  value={why.narrative_spine.length ? why.narrative_spine.join(" → ") : null}
                />
              </div>
            </details>
          ) : null}

          {canCorrect ? (
            <div style={{ marginTop: 8, borderTop: "1px solid rgba(127,127,127,0.18)", paddingTop: 6 }}>
              {correcting ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6 }}>
                    <select
                      value={field}
                      onChange={(e) => setField(e.target.value)}
                      style={{ fontSize: 12, flex: "0 0 auto" }}
                    >
                      {CORRECTABLE_FIELDS.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="text"
                      value={value}
                      onChange={(e) => setValue(e.target.value.slice(0, 2000))}
                      placeholder="Corrected value"
                      style={{ fontSize: 12, flex: 1 }}
                    />
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <button
                      type="button"
                      className="btn-primary btn-sm"
                      disabled={status === "saving" || !value.trim()}
                      onClick={submitCorrection}
                    >
                      {status === "saving" ? "Saving…" : "Save correction"}
                    </button>
                    <button
                      type="button"
                      className="btn-ghost btn-sm"
                      onClick={() => {
                        setCorrecting(false);
                        setValue("");
                      }}
                    >
                      Cancel
                    </button>
                    {statusMsg ? (
                      <span
                        style={{ fontSize: 11, opacity: 0.7, color: status === "error" ? "#c0392b" : undefined }}
                      >
                        {statusMsg}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="btn-ghost btn-sm"
                  onClick={() => {
                    setCorrecting(true);
                    setStatus("idle");
                    setStatusMsg(null);
                  }}
                  title="Record a correction as a learning observation"
                >
                  {status === "saved" ? "✓ Correction recorded — suggest another" : "✎ Suggest correction"}
                </button>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export default MimicSlideWhyPanel;
