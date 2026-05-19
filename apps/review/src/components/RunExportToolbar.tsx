"use client";

import { useCallback, useState, type CSSProperties } from "react";

export interface RunExportToolbarProps {
  runId: string;
  projectSlug: string;
  /** `header` = full button row; `compact` = smaller buttons for table cells */
  variant?: "header" | "compact";
}

function exportUrl(projectSlug: string, runId: string, format: "md" | "json"): string {
  const qs = new URLSearchParams({ run_id: runId, project_slug: projectSlug, format });
  return `/api/runs/export?${qs.toString()}`;
}

function contentLogUrl(projectSlug: string, runId: string, download: boolean): string {
  const qs = new URLSearchParams({ run_id: runId, project_slug: projectSlug });
  if (download) qs.set("download", "1");
  return `/api/runs/content-log-export?${qs.toString()}`;
}

export function RunExportToolbar({ runId, projectSlug, variant = "header" }: RunExportToolbarProps) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const slug = projectSlug.trim();
  const rid = runId.trim();
  const compact = variant === "compact";

  const copyText = useCallback(async (text: string, label: string) => {
    if (!text) {
      setMsg("Nothing to copy");
      return;
    }
    setBusy(true);
    setMsg(null);
    try {
      await navigator.clipboard.writeText(text);
      setMsg(`Copied ${label}`);
    } catch {
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        document.body.removeChild(ta);
        setMsg(`Copied ${label}`);
      } catch {
        setMsg("Copy failed");
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const copyExportMd = useCallback(async () => {
    if (!slug || !rid) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(exportUrl(slug, rid, "md"), { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      await copyText(await res.text(), "full export (Markdown)");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Copy failed");
    } finally {
      setBusy(false);
    }
  }, [copyText, rid, slug]);

  const copyContentLog = useCallback(async () => {
    if (!slug || !rid) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch(contentLogUrl(slug, rid, false), { cache: "no-store" });
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { export?: unknown };
      const payload = j.export ?? j;
      await copyText(JSON.stringify(payload, null, 2), "content log (JSON)");
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "Copy failed");
    } finally {
      setBusy(false);
    }
  }, [copyText, rid, slug]);

  if (!slug || !rid) {
    return (
      <span style={{ fontSize: 12, color: "var(--yellow)" }}>
        Select a project to export this run.
      </span>
    );
  }

  const btnStyle: CSSProperties = compact
    ? { fontSize: 11, padding: "4px 8px" }
    : { fontSize: 12, padding: "6px 12px" };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 6 : 8, alignItems: compact ? "flex-start" : "flex-end" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, justifyContent: compact ? "flex-start" : "flex-end" }}>
        <button type="button" className="btn-ghost" style={btnStyle} disabled={busy} onClick={() => void copyExportMd()}>
          Copy all (MD)
        </button>
        <button type="button" className="btn-ghost" style={btnStyle} disabled={busy} onClick={() => void copyContentLog()}>
          Copy content log
        </button>
        <button
          type="button"
          className="btn-ghost"
          style={btnStyle}
          disabled={busy}
          onClick={() => {
            window.location.href = exportUrl(slug, rid, "md");
          }}
        >
          Download all (MD)
        </button>
        <button
          type="button"
          className="btn-ghost"
          style={btnStyle}
          disabled={busy}
          onClick={() => {
            window.location.href = exportUrl(slug, rid, "json");
          }}
          title="All jobs, job_drafts (draft packages), assets, transitions, reviews, audits"
        >
          Download all (JSON)
        </button>
        <button
          type="button"
          className="btn-ghost"
          style={btnStyle}
          disabled={busy}
          onClick={() => {
            window.location.href = contentLogUrl(slug, rid, true);
          }}
          title="Per-job stage snapshots, draft packages, pipeline outcomes"
        >
          Download content log
        </button>
      </div>
      {msg && (
        <span style={{ fontSize: 12, color: msg.includes("fail") ? "var(--red)" : "var(--muted)" }}>{msg}</span>
      )}
      {!compact && (
        <span style={{ fontSize: 11, color: "var(--muted)", maxWidth: 420, textAlign: "right", lineHeight: 1.4 }}>
          Includes every <span className="mono">job_drafts</span> row (draft packages), generation/render/review snapshots,
          assets, and pipeline outcome rows.
        </span>
      )}
    </div>
  );
}
