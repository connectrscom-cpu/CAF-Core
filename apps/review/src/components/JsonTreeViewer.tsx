"use client";

import { useMemo, useState } from "react";

type Props = {
  data: unknown;
  maxDepth?: number;
};

function nodePreview(v: unknown): string {
  if (v === null) return "null";
  if (Array.isArray(v)) return `Array(${v.length})`;
  if (typeof v === "object") return "Object";
  if (typeof v === "string") return v.length > 48 ? `"${v.slice(0, 48)}…"` : `"${v}"`;
  return String(v);
}

function JsonNode({ name, value, depth, maxDepth }: { name?: string; value: unknown; depth: number; maxDepth: number }) {
  const [open, setOpen] = useState(depth < 1);
  const isBranch = value !== null && typeof value === "object";
  const entries = useMemo(() => {
    if (Array.isArray(value)) return value.map((v, i) => [String(i), v] as const);
    if (value && typeof value === "object") return Object.entries(value as Record<string, unknown>);
    return [];
  }, [value]);

  if (!isBranch) {
    return (
      <div className="caf-json-leaf" style={{ paddingLeft: depth * 14 }}>
        {name != null ? <span className="caf-json-key">{name}: </span> : null}
        <span className="caf-json-val">{nodePreview(value)}</span>
      </div>
    );
  }

  return (
    <div className="caf-json-branch">
      <button
        type="button"
        className="caf-json-toggle"
        style={{ paddingLeft: depth * 14 }}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span className="caf-json-caret">{open ? "▾" : "▸"}</span>
        {name != null ? <span className="caf-json-key">{name}</span> : null}
        <span className="caf-json-meta">{nodePreview(value)}</span>
      </button>
      {open && depth < maxDepth
        ? entries.map(([k, v]) => <JsonNode key={k} name={k} value={v} depth={depth + 1} maxDepth={maxDepth} />)
        : null}
      {open && depth >= maxDepth ? (
        <div className="caf-json-leaf" style={{ paddingLeft: (depth + 1) * 14, color: "var(--muted)" }}>
          … max depth
        </div>
      ) : null}
    </div>
  );
}

/** Lightweight collapsible JSON tree (no external deps). */
export function JsonTreeViewer({ data, maxDepth = 8 }: Props) {
  const [filter, setFilter] = useState("");
  const filtered = useMemo(() => {
    if (!filter.trim()) return data;
    const q = filter.trim().toLowerCase();
    try {
      const raw = JSON.stringify(data);
      if (!raw.toLowerCase().includes(q)) return null;
    } catch {
      return data;
    }
    return data;
  }, [data, filter]);

  return (
    <div className="caf-json-viewer">
      <input
        type="search"
        className="filter-input"
        placeholder="Filter keys / values…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        style={{ maxWidth: 280, marginBottom: 10 }}
      />
      {filtered == null ? (
        <p style={{ color: "var(--muted)", fontSize: 13 }}>No matches.</p>
      ) : (
        <JsonNode value={filtered} depth={0} maxDepth={maxDepth} />
      )}
    </div>
  );
}
