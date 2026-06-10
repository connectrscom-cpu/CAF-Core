"use client";

import { useEffect, useMemo, useState } from "react";

export interface CarouselSlideReworkPickerProps {
  slideCount: number;
  /** 1-based indices to pre-check (e.g. slides with copy edits). */
  defaultSelectedIndices?: number[];
  /** Restored from last NEEDS_EDIT overrides. */
  existingSelectedIndices?: number[];
  /** Called when partial mode or selection changes. */
  onChange: (state: { partialRework: boolean; selectedIndices: number[] }) => void;
  disabled?: boolean;
}

function normalizeIndices(indices: number[], slideCount: number): number[] {
  const max = Math.max(1, slideCount);
  return [...new Set(indices.map((i) => Math.floor(i)).filter((i) => i >= 1 && i <= max))].sort(
    (a, b) => a - b
  );
}

/** Parse "Slide 3" / "Slide 12" from DecisionPanel editsSummary. */
export function slideIndicesFromEditsSummary(summary: string[]): number[] {
  const out: number[] = [];
  for (const line of summary) {
    const m = /^Slide\s+(\d+)/i.exec(line.trim());
    if (m?.[1]) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 1) out.push(n);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function CarouselSlideReworkPicker({
  slideCount,
  defaultSelectedIndices = [],
  existingSelectedIndices,
  onChange,
  disabled = false,
}: CarouselSlideReworkPickerProps) {
  const n = Math.max(0, Math.floor(slideCount));

  const initialPartial = useMemo(() => {
    if (existingSelectedIndices && existingSelectedIndices.length > 0) return true;
    if (defaultSelectedIndices.length > 0) return true;
    return true;
  }, [existingSelectedIndices, defaultSelectedIndices]);

  const initialSelected = useMemo(() => {
    if (existingSelectedIndices && existingSelectedIndices.length > 0) {
      return normalizeIndices(existingSelectedIndices, n);
    }
    if (defaultSelectedIndices.length > 0) {
      return normalizeIndices(defaultSelectedIndices, n);
    }
    return [];
  }, [existingSelectedIndices, defaultSelectedIndices, n]);

  const [partialRework, setPartialRework] = useState(initialPartial);
  const [selected, setSelected] = useState<number[]>(initialSelected);

  useEffect(() => {
    setPartialRework(initialPartial);
    setSelected(initialSelected);
  }, [n, initialPartial, initialSelected]);

  useEffect(() => {
    onChange({
      partialRework,
      selectedIndices: partialRework ? selected : [],
    });
  }, [partialRework, selected, onChange]);

  if (n < 1) return null;

  const toggle = (idx: number) => {
    setSelected((prev) =>
      prev.includes(idx) ? prev.filter((x) => x !== idx) : [...prev, idx].sort((a, b) => a - b)
    );
  };

  const selectAll = () => setSelected(Array.from({ length: n }, (_, i) => i + 1));
  const clearAll = () => setSelected([]);
  const selectEdited = () => {
    const edited = normalizeIndices(defaultSelectedIndices, n);
    if (edited.length > 0) setSelected(edited);
  };

  return (
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
        Carousel slide re-render (Needs Edit rework)
      </div>
      <label
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 10,
          cursor: disabled ? "not-allowed" : "pointer",
          fontSize: 13,
          marginBottom: partialRework ? 10 : 0,
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <input
          type="checkbox"
          checked={partialRework}
          disabled={disabled}
          onChange={(e) => setPartialRework(e.target.checked)}
          style={{ marginTop: 3 }}
        />
        <span>
          <strong>Re-render selected slides only</strong> — on rework, only checked slides are sent to
          Flux / the carousel renderer (other slides are kept). Uncheck to run a full-deck rework when
          you trigger rework from the queue.
        </span>
      </label>

      {partialRework && (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={selectAll} disabled={disabled}>
              Select all
            </button>
            <button type="button" className="btn-secondary" style={{ fontSize: 12, padding: "4px 10px" }} onClick={clearAll} disabled={disabled}>
              Clear
            </button>
            {defaultSelectedIndices.length > 0 && (
              <button
                type="button"
                className="btn-secondary"
                style={{ fontSize: 12, padding: "4px 10px" }}
                onClick={selectEdited}
                disabled={disabled}
              >
                Slides you edited
              </button>
            )}
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(88px, 1fr))",
              gap: 8,
            }}
          >
            {Array.from({ length: n }, (_, i) => i + 1).map((idx) => {
              const on = selected.includes(idx);
              return (
                <label
                  key={idx}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    borderRadius: 8,
                    border: `1px solid ${on ? "var(--accent)" : "var(--border)"}`,
                    background: on ? "color-mix(in srgb, var(--accent) 12%, var(--card))" : "var(--card)",
                    cursor: disabled ? "not-allowed" : "pointer",
                    fontSize: 13,
                    fontWeight: on ? 600 : 400,
                  }}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={disabled}
                    onChange={() => toggle(idx)}
                  />
                  Slide {idx}
                </label>
              );
            })}
          </div>
          {selected.length === 0 && (
            <p style={{ fontSize: 12, color: "var(--yellow)", marginTop: 10, marginBottom: 0 }}>
              Select at least one slide, or turn off partial re-render for a full-deck rework.
            </p>
          )}
          {selected.length > 0 && (
            <p style={{ fontSize: 12, color: "var(--muted)", marginTop: 10, marginBottom: 0 }}>
              Rework will re-bill {selected.length} slide{selected.length === 1 ? "" : "s"}:{" "}
              {selected.join(", ")}.
            </p>
          )}
        </>
      )}
    </div>
  );
}
