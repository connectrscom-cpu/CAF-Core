"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useReviewProject } from "@/components/ReviewProjectContext";

export default function SignalPackIdeasPage() {
  const params = useParams();
  const packId = String(params.packId ?? "");
  const { activeProjectSlug, lockedSlug, navHref } = useReviewProject();
  const slug = (activeProjectSlug || lockedSlug || "").trim();
  const qs = useMemo(() => (slug ? `?project=${encodeURIComponent(slug)}` : ""), [slug]);

  const [pack, setPack] = useState<Record<string, unknown> | null>(null);
  const [source, setSource] = useState<"ideas_json" | "overall_candidates_json">("ideas_json");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!packId || !slug) return;
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/signal-packs/${packId}${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { signal_pack: Record<string, unknown> };
      setPack(j.signal_pack ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [packId, qs, slug]);

  useEffect(() => {
    void load();
  }, [load]);

  const ideasJson = useMemo(() => {
    const v = pack?.ideas_json;
    if (!Array.isArray(v)) return [] as Record<string, unknown>[];
    return v.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
  }, [pack]);

  const overallCandidates = useMemo(() => {
    const v = pack?.overall_candidates_json;
    if (!Array.isArray(v)) return [] as Record<string, unknown>[];
    return v.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
  }, [pack]);

  const rows = useMemo(() => {
    if (source === "overall_candidates_json") return overallCandidates;
    return ideasJson;
  }, [ideasJson, overallCandidates, source]);

  useEffect(() => {
    // Default to ideas_json when present; otherwise fall back to overall_candidates_json.
    if (ideasJson.length > 0) setSource("ideas_json");
    else setSource("overall_candidates_json");
  }, [ideasJson.length, packId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  }, [rows, filter]);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const r of filtered.slice(0, 400)) {
      for (const k of Object.keys(r)) {
        keys.add(k);
        if (keys.size >= 16) break;
      }
      if (keys.size >= 16) break;
    }
    return Array.from(keys);
  }, [filtered]);

  return (
    <>
      <div className="page-header">
        <div>
          <Link href={navHref("/pipeline")} className="detail-back" style={{ fontSize: 13 }}>
            ← Pipeline inputs
          </Link>
          <h2 style={{ marginTop: 8 }}>Signal pack — ideas</h2>
          <span className="page-header-sub">
            {(pack?.upload_filename as string) || packId} ·{" "}
            {ideasJson.length > 0 ? `${ideasJson.length} ideas_json` : `${overallCandidates.length} overall candidates`}
          </span>
        </div>
      </div>
      <div style={{ padding: "12px 28px 28px" }}>
        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {!slug && <p style={{ color: "var(--muted)" }}>Select a project in the sidebar.</p>}

        {pack && (
          <div style={{ marginBottom: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <label style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}>
                Source
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value as "ideas_json" | "overall_candidates_json")}
                  style={{
                    padding: "8px 10px",
                    borderRadius: 6,
                    border: "1px solid var(--border)",
                    background: "transparent",
                    color: "inherit",
                    fontSize: 13,
                  }}
                >
                  <option value="ideas_json" disabled={ideasJson.length === 0}>
                    ideas_json ({ideasJson.length})
                  </option>
                  <option value="overall_candidates_json" disabled={overallCandidates.length === 0}>
                    overall_candidates_json ({overallCandidates.length})
                  </option>
                </select>
              </label>

              <label style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 8 }}>
                Filter rows
                <input
                  type="search"
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Substring match on full row JSON"
                  style={{ padding: "8px 12px", minWidth: 280, borderRadius: 6, border: "1px solid var(--border)" }}
                />
              </label>

              <span style={{ color: "var(--muted)", fontSize: 13 }}>
                Showing {filtered.length} of {rows.length}
              </span>
            </div>
          </div>
        )}

        {filtered.length > 0 && (
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--surface-2, #151515)" }}>
                  <Th>idx</Th>
                  {columns.map((c) => (
                    <Th key={c}>{c}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => (
                  <tr key={idx} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>{idx + 1}</Td>
                    {columns.map((c) => (
                      <Td key={c} style={{ maxWidth: 260, verticalAlign: "top" }}>
                        {cellStr(row[c])}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pack && rows.length === 0 && (
          <p style={{ color: "var(--muted)" }}>
            This pack has no {source} rows.
            {source === "overall_candidates_json" && ideasJson.length > 0 ? " Try switching to ideas_json." : ""}
            {source === "ideas_json" && overallCandidates.length > 0 ? " Try switching to overall_candidates_json." : ""}
          </p>
        )}
      </div>
    </>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ textAlign: "left", padding: "8px 10px", fontWeight: 600, fontSize: 11, color: "var(--muted)" }}>
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return <td style={{ padding: "8px 10px", ...style }}>{children}</td>;
}

function cellStr(v: unknown): string {
  if (v == null) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s.length <= 240) return s;
  return `${s.slice(0, 240)}…`;
}
