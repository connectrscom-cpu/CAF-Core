"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useReviewProject } from "@/components/ReviewProjectContext";

type Tab = "evidence" | "ideas";

interface ImportRow {
  id: string;
  upload_filename: string | null;
  created_at: string;
  stored_row_count: string;
}

interface PackRow {
  id: string;
  run_id: string;
  upload_filename: string | null;
  created_at: string;
  overall_candidates_count?: number;
  ideas_count?: number;
}

export default function PipelinePage() {
  const { activeProjectSlug, lockedSlug, navHref, ready, multiProject } = useReviewProject();
  const slug = (activeProjectSlug || lockedSlug || "").trim();
  const [tab, setTab] = useState<Tab>("evidence");
  const [imports, setImports] = useState<ImportRow[] | null>(null);
  const [packs, setPacks] = useState<PackRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const qs = useMemo(() => (slug ? `?project=${encodeURIComponent(slug)}` : ""), [slug]);

  const loadEvidence = useCallback(async () => {
    if (!slug) {
      setImports([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/inputs-imports${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { imports?: ImportRow[] };
      setImports(j.imports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load imports");
      setImports(null);
    } finally {
      setLoading(false);
    }
  }, [qs, slug]);

  const loadPacks = useCallback(async () => {
    if (!slug) {
      setPacks([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/signal-packs${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { signal_packs?: PackRow[] };
      setPacks(j.signal_packs ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load signal packs");
      setPacks(null);
    } finally {
      setLoading(false);
    }
  }, [qs, slug]);

  useEffect(() => {
    if (!ready) return;
    if (tab === "evidence") void loadEvidence();
    else void loadPacks();
  }, [ready, tab, loadEvidence, loadPacks]);

  async function onUpload(file: File | null) {
    if (!file || !slug) return;
    setUploading(true);
    setUploadMsg(null);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("project_slug", slug);
      const res = await fetch("/api/pipeline/inputs-upload", { method: "POST", body: fd });
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      const j = JSON.parse(text) as { total_rows?: number; inputs_evidence_import_id?: string };
      setUploadMsg(`Imported ${j.total_rows ?? 0} rows. Open the import below to inspect by sheet.`);
      await loadEvidence();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const needProject = multiProject && !slug;

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Pipeline inputs</h2>
          <span className="page-header-sub">
            Upload scraper-style INPUTS workbooks into Core for provenance, and inspect signal-pack ideas (overall
            candidates) when you need context next to human review. Processing controls (health, profile, RTP, QC,
            build-from-import) stay in CAF Core Admin → Inputs &amp; processing — not here.
          </span>
        </div>
      </div>

      <div style={{ padding: "12px 28px 28px" }}>
        <div style={{ display: "flex", gap: 8, marginBottom: 20, borderBottom: "1px solid var(--border)" }}>
          <TabBtn active={tab === "evidence"} onClick={() => setTab("evidence")}>
            Scraped evidence (XLSX)
          </TabBtn>
          <TabBtn active={tab === "ideas"} onClick={() => setTab("ideas")}>
            Signal packs (ideas)
          </TabBtn>
        </div>

        {!ready && <p style={{ color: "var(--muted)" }}>Loading…</p>}
        {ready && needProject && (
          <p style={{ color: "var(--yellow)" }}>
            Select a project in the sidebar to upload or browse pipeline data for a tenant.
          </p>
        )}

        {error && <p style={{ color: "var(--red)", marginBottom: 12, fontSize: 13 }}>{error}</p>}

        {tab === "evidence" && ready && slug && (
          <section>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Upload INPUTS workbook</h3>
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12, maxWidth: 720 }}>
              Matches the &quot;INPUTS — Sources for SNS&quot; shape: registry tabs (All Sources, SCRAPED,
              Reddit_Raw_Info, Tiktok_Videos, …). Each sheet is stored as typed rows with dedupe keys for inspection.
            </p>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 10, fontSize: 13 }}>
              <span className="button" style={{ position: "relative", overflow: "hidden" }}>
                {uploading ? "Uploading…" : "Choose .xlsx"}
                <input
                  type="file"
                  accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  disabled={uploading}
                  style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }}
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    e.target.value = "";
                    void onUpload(f);
                  }}
                />
              </span>
              <span style={{ color: "var(--muted)" }}>Project: {slug}</span>
            </label>
            {uploadMsg && <p style={{ marginTop: 10, fontSize: 13, color: "var(--green)" }}>{uploadMsg}</p>}

            <h3 style={{ fontSize: 14, margin: "24px 0 10px" }}>Recent imports</h3>
            {loading && !imports && <p style={{ color: "var(--muted)" }}>Loading…</p>}
            {imports && imports.length === 0 && !loading && (
              <p style={{ color: "var(--muted)" }}>No evidence imports yet for this project.</p>
            )}
            {imports && imports.length > 0 && (
              <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "var(--surface-2, #151515)" }}>
                      <Th>File</Th>
                      <Th>Rows stored</Th>
                      <Th>Created</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map((r) => (
                      <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                        <Td>{r.upload_filename ?? "—"}</Td>
                        <Td>{r.stored_row_count}</Td>
                        <Td>{fmt(r.created_at)}</Td>
                        <Td>
                          <Link href={navHref(`/pipeline/evidence/${r.id}`)} className="detail-back">
                            Inspect
                          </Link>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "ideas" && ready && slug && (
          <section>
            <h3 style={{ fontSize: 14, marginBottom: 10 }}>Signal packs in Core</h3>
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 12, maxWidth: 720 }}>
              Each pack holds <code style={{ fontSize: 12 }}>overall_candidates_json</code> — the idea rows the
              planner multiplies by enabled flow types. Open a pack to review or search candidates when that helps
              editorial judgment.
            </p>
            <button className="button" type="button" onClick={() => void loadPacks()} disabled={loading}>
              {loading ? "Refreshing…" : "Refresh"}
            </button>
            {loading && !packs && <p style={{ color: "var(--muted)", marginTop: 12 }}>Loading…</p>}
            {packs && packs.length === 0 && !loading && (
              <p style={{ color: "var(--muted)", marginTop: 12 }}>No signal packs for this project.</p>
            )}
            {packs && packs.length > 0 && (
              <div
                style={{
                  marginTop: 16,
                  overflowX: "auto",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                }}
              >
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "var(--surface-2, #151515)" }}>
                      <Th>Pack</Th>
                      <Th>Run id</Th>
                      <Th>Ideas (rows)</Th>
                      <Th>Created</Th>
                      <Th>Actions</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {packs.map((p) => {
                      const nIdeas = Number(p.ideas_count ?? 0);
                      const nOverall = Number(p.overall_candidates_count ?? 0);
                      return (
                        <tr key={p.id} style={{ borderTop: "1px solid var(--border)" }}>
                          <Td>{p.upload_filename ?? p.id.slice(0, 8)}</Td>
                          <Td style={{ fontFamily: "var(--font-mono, monospace)", fontSize: 12 }}>{p.run_id}</Td>
                          <Td>{nIdeas > 0 ? nIdeas : nOverall}</Td>
                          <Td>{fmt(p.created_at)}</Td>
                          <Td>
                            <Link href={navHref(`/pipeline/pack/${p.id}`)} className="detail-back">
                              Inspect ideas
                            </Link>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
      </div>
    </>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "10px 14px",
        fontSize: 13,
        border: "none",
        borderBottom: active ? "2px solid var(--accent)" : "2px solid transparent",
        marginBottom: -1,
        background: "transparent",
        color: active ? "var(--fg)" : "var(--muted)",
        cursor: "pointer",
      }}
    >
      {children}
    </button>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th style={{ textAlign: "left", padding: "10px 12px", fontWeight: 600, fontSize: 12, color: "var(--muted)" }}>
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: CSSProperties }) {
  return <td style={{ padding: "10px 12px", verticalAlign: "top", ...style }}>{children}</td>;
}

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}
