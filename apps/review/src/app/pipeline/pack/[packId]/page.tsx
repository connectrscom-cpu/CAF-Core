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

  const ideas = useMemo(() => {
    const oc = pack?.overall_candidates_json;
    if (!Array.isArray(oc)) return [] as Record<string, unknown>[];
    return oc.filter((x): x is Record<string, unknown> => x != null && typeof x === "object");
  }, [pack]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return ideas;
    return ideas.filter((row) => JSON.stringify(row).toLowerCase().includes(q));
  }, [ideas, filter]);

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
            {(pack?.upload_filename as string) || packId} · {ideas.length} overall candidate
            {ideas.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <div style={{ padding: "12px 28px 28px" }}>
        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {!slug && <p style={{ color: "var(--muted)" }}>Select a project in the sidebar.</p>}

        {pack && (
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 13, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              Filter rows
              <input
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="Substring match on full row JSON"
                style={{ padding: "8px 12px", minWidth: 280, borderRadius: 6, border: "1px solid var(--border)" }}
              />
              <span style={{ color: "var(--muted)" }}>
                Showing {filtered.length} of {ideas.length}
              </span>
            </label>
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

        {pack && ideas.length === 0 && (
          <p style={{ color: "var(--muted)" }}>This pack has no overall_candidates_json rows.</p>
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
