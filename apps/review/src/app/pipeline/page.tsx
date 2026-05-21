"use client";

import type { CSSProperties } from "react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { CafPageHeader } from "@/components/CafOptionsMenu";
import { CafTerm } from "@/components/CafTerm";
import { SignalPackIntro } from "@/components/SignalPackIntro";
import { useReviewProject } from "@/components/ReviewProjectContext";

type Tab = "evidence" | "packs";

function parsePipelineTab(raw: string | null): Tab {
  return raw === "packs" || raw === "ideas" ? "packs" : "evidence";
}

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
  jobs_count?: number;
  ideas_count?: number;
}

export default function PipelinePage() {
  const searchParams = useSearchParams();
  const { activeProjectSlug, lockedSlug, navHref, ready, multiProject } = useReviewProject();
  const slug = (activeProjectSlug || lockedSlug || "").trim();
  const [tab, setTab] = useState<Tab>(() => parsePipelineTab(searchParams.get("tab")));

  useEffect(() => {
    setTab(parsePipelineTab(searchParams.get("tab")));
  }, [searchParams]);
  const [imports, setImports] = useState<ImportRow[] | null>(null);
  const [packs, setPacks] = useState<PackRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);

  const qs = useMemo(() => (slug ? `?project=${encodeURIComponent(slug)}&summary=1` : "?summary=1"), [slug]);

  const loadEvidence = useCallback(async () => {
    if (!slug) {
      setImports([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/inputs-imports${slug ? `?project=${encodeURIComponent(slug)}` : ""}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { imports?: ImportRow[] };
      setImports(j.imports ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load imports");
      setImports(null);
    } finally {
      setLoading(false);
    }
  }, [slug]);

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
      const j = JSON.parse(text) as { total_rows?: number };
      setUploadMsg(`Imported ${j.total_rows ?? 0} rows`);
      await loadEvidence();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const needProject = multiProject && !slug;
  const packCount = packs?.length ?? 0;
  const importCount = imports?.length ?? 0;
  const isAdminEmbed = searchParams.get("embed") === "admin";
  const processingHref =
    isAdminEmbed && slug ? `/admin/processing?project=${encodeURIComponent(slug)}#pack` : null;

  return (
    <>
      <CafPageHeader
        title={
          tab === "packs" ? (
            <CafTerm term="signalPack">Signal packs</CafTerm>
          ) : (
            <CafTerm term="evidence">Evidence imports</CafTerm>
          )
        }
        chips={
          tab === "packs"
            ? slug
              ? `${packCount} pack(s)`
              : undefined
            : slug
              ? `${importCount} import(s)`
              : undefined
        }
      />

      <div style={{ padding: "12px 28px 28px" }}>
        <div className="tabs" style={{ padding: "0 0 0", marginBottom: 16 }}>
          <TabBtn active={tab === "evidence"} onClick={() => setTab("evidence")}>
            Evidence (XLSX)
          </TabBtn>
          <TabBtn active={tab === "packs"} onClick={() => setTab("packs")}>
            Signal packs
          </TabBtn>
        </div>

        {!ready && <p style={{ color: "var(--muted)" }}>Loading…</p>}
        {ready && needProject && tab === "evidence" && (
          <p style={{ color: "var(--yellow)" }}>Select a project in the sidebar.</p>
        )}

        {error && <p style={{ color: "var(--red)", marginBottom: 12, fontSize: 13 }}>{error}</p>}

        {tab === "evidence" && ready && slug && (
          <section>
            <div className="caf-toolbar">
              <label className="btn-primary" style={{ position: "relative", overflow: "hidden", display: "inline-flex" }}>
                {uploading ? "Uploading…" : "Upload .xlsx"}
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
              </label>
              <button type="button" className="btn-ghost" onClick={() => void loadEvidence()} disabled={loading}>
                Reload
              </button>
              {uploadMsg ? <span className="caf-stat-chips" style={{ color: "var(--green)" }}>{uploadMsg}</span> : null}
            </div>

            {loading && !imports && <p style={{ color: "var(--muted)" }}>Loading…</p>}
            {imports && imports.length === 0 && !loading && (
              <p style={{ color: "var(--muted)" }}>No evidence imports yet.</p>
            )}
            {imports && imports.length > 0 && (
              <div className="pipeline-table-wrap">
                <table className="caf-table-compact">
                  <thead>
                    <tr>
                      <Th>File</Th>
                      <Th>Rows</Th>
                      <Th>Created</Th>
                      <Th></Th>
                    </tr>
                  </thead>
                  <tbody>
                    {imports.map((r) => (
                      <tr key={r.id}>
                        <Td>{r.upload_filename ?? "—"}</Td>
                        <Td>{r.stored_row_count}</Td>
                        <Td>{fmt(r.created_at)}</Td>
                        <Td>
                          <Link href={navHref(`/pipeline/evidence/${r.id}`)}>Inspect</Link>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === "packs" && ready && (
          <section>
            <SignalPackIntro processingHref={processingHref} />
            {needProject ? (
              <p style={{ color: "var(--yellow)", marginTop: 12 }}>Select a project in the sidebar to list packs.</p>
            ) : !slug ? null : (
              <>
                <div className="caf-toolbar">
                  <button type="button" className="btn-ghost" onClick={() => void loadPacks()} disabled={loading}>
                    {loading ? "Refreshing…" : "Refresh"}
                  </button>
                </div>
                {loading && !packs && <p style={{ color: "var(--muted)" }}>Loading…</p>}
                {packs && packs.length === 0 && !loading && (
                  <p style={{ color: "var(--muted)" }}>No signal packs for this project.</p>
                )}
                {packs && packs.length > 0 && (
                  <div className="pipeline-table-wrap">
                    <table className="caf-table-compact">
                      <thead>
                        <tr>
                          <Th>Pack</Th>
                          <Th>Run</Th>
                          <Th>Ideas</Th>
                          <Th>Created</Th>
                          <Th></Th>
                        </tr>
                      </thead>
                      <tbody>
                        {packs.map((p) => {
                          const nIdeas = Number(p.ideas_count ?? p.jobs_count ?? 0);
                          return (
                            <tr key={p.id}>
                              <Td>{p.upload_filename ?? p.id.slice(0, 8)}</Td>
                              <Td className="job-id-cell">{p.run_id}</Td>
                              <Td>{nIdeas}</Td>
                              <Td>{fmt(p.created_at)}</Td>
                              <Td>
                                <Link href={navHref(`/pipeline/pack/${p.id}`)}>Open</Link>
                              </Td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
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
    <button type="button" className={`tab ${active ? "active" : ""}`} onClick={onClick} style={{ background: "none", border: "none" }}>
      {children}
    </button>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th>{children}</th>;
}

function Td({ children, className, style }: { children: React.ReactNode; className?: string; style?: CSSProperties }) {
  return (
    <td className={className} style={style}>
      {children}
    </td>
  );
}

function fmt(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}
