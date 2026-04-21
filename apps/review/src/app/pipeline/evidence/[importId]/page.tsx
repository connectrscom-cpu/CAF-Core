"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useReviewProject } from "@/components/ReviewProjectContext";

interface DetailResponse {
  import: {
    id: string;
    upload_filename: string | null;
    workbook_sha256: string | null;
    sheet_stats_json: { sheets?: unknown[]; total_rows?: number };
    created_at: string;
    stored_row_count: string;
  };
  rows_by_sheet: Array<{ sheet_name: string; cnt: string }>;
}

interface RowItem {
  id: string;
  sheet_name: string;
  row_index: number;
  evidence_kind: string;
  dedupe_key: string | null;
  payload_json: Record<string, unknown>;
}

export default function EvidenceImportInspectPage() {
  const params = useParams();
  const importId = String(params.importId ?? "");
  const { activeProjectSlug, lockedSlug, navHref } = useReviewProject();
  const slug = (activeProjectSlug || lockedSlug || "").trim();
  const qs = useMemo(() => (slug ? `?project=${encodeURIComponent(slug)}` : ""), [slug]);

  const [detail, setDetail] = useState<DetailResponse | null>(null);
  const [sheet, setSheet] = useState<string>("");
  const [rows, setRows] = useState<RowItem[]>([]);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const limit = 80;

  const loadDetail = useCallback(async () => {
    if (!importId || !slug) return;
    setError(null);
    try {
      const res = await fetch(`/api/pipeline/inputs-imports/${importId}${qs}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as DetailResponse;
      setDetail(j);
      const first = j.rows_by_sheet[0]?.sheet_name ?? "";
      setSheet((s) => (s && j.rows_by_sheet.some((x) => x.sheet_name === s) ? s : first));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    }
  }, [importId, qs, slug]);

  const loadRows = useCallback(async () => {
    if (!importId || !slug || !sheet) {
      setRows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const u = new URLSearchParams();
      u.set("sheet", sheet);
      u.set("limit", String(limit));
      u.set("offset", String(offset));
      if (slug) u.set("project", slug);
      const res = await fetch(`/api/pipeline/inputs-imports/${importId}/rows?${u}`, { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { rows: RowItem[] };
      setRows(j.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }, [importId, offset, sheet, slug]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  useEffect(() => {
    setOffset(0);
  }, [sheet]);

  useEffect(() => {
    if (detail && sheet) void loadRows();
  }, [detail, sheet, offset, loadRows]);

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const r of rows) {
      for (const k of Object.keys(r.payload_json)) {
        if (keys.size < 14) keys.add(k);
      }
    }
    return Array.from(keys);
  }, [rows]);

  return (
    <>
      <div className="page-header">
        <div>
          <Link href={navHref("/pipeline")} className="detail-back" style={{ fontSize: 13 }}>
            ← Pipeline inputs
          </Link>
          <h2 style={{ marginTop: 8 }}>Evidence import</h2>
          <span className="page-header-sub">{detail?.import.upload_filename ?? importId}</span>
        </div>
      </div>
      <div style={{ padding: "12px 28px 28px" }}>
        {error && <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>}
        {!slug && <p style={{ color: "var(--muted)" }}>Select a project in the sidebar.</p>}
        {detail && (
          <div style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
            <div>
              Rows stored: <strong style={{ color: "var(--fg)" }}>{detail.import.stored_row_count}</strong>
            </div>
            {detail.import.workbook_sha256 && (
              <div style={{ marginTop: 4, fontFamily: "var(--font-mono, monospace)", fontSize: 11 }}>
                sha256: {detail.import.workbook_sha256}
              </div>
            )}
          </div>
        )}

        {detail && detail.rows_by_sheet.length > 0 && (
          <label style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, fontSize: 13 }}>
            Sheet
            <select
              value={sheet}
              onChange={(e) => setSheet(e.target.value)}
              style={{ padding: "6px 10px", minWidth: 220 }}
            >
              {detail.rows_by_sheet.map((s) => (
                <option key={s.sheet_name} value={s.sheet_name}>
                  {s.sheet_name} ({s.cnt})
                </option>
              ))}
            </select>
            <button
              className="button"
              type="button"
              disabled={offset === 0}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
            >
              Prev page
            </button>
            <button className="button" type="button" disabled={rows.length < limit} onClick={() => setOffset((o) => o + limit)}>
              Next page
            </button>
            <span style={{ color: "var(--muted)" }}>offset {offset}</span>
          </label>
        )}

        {loading && <p style={{ color: "var(--muted)" }}>Loading rows…</p>}

        {!loading && rows.length > 0 && (
          <div style={{ overflowX: "auto", border: "1px solid var(--border)", borderRadius: 8 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--surface-2, #151515)" }}>
                  <Th>#</Th>
                  <Th>kind</Th>
                  <Th>dedupe</Th>
                  {columns.map((c) => (
                    <Th key={c}>{c}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <Td>{r.row_index}</Td>
                    <Td>{r.evidence_kind}</Td>
                    <Td style={{ maxWidth: 140, wordBreak: "break-all", fontSize: 11 }}>{r.dedupe_key ?? "—"}</Td>
                    {columns.map((c) => (
                      <Td key={c} style={{ maxWidth: 220, verticalAlign: "top" }}>
                        {cellPreview(r.payload_json[c])}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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

function cellPreview(v: unknown): string {
  if (v == null) return "—";
  const s = typeof v === "string" ? v : JSON.stringify(v);
  if (s.length <= 180) return s;
  return `${s.slice(0, 180)}…`;
}
