"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAbortableLoad } from "@/lib/marketer/use-abortable-load";
import type { ResearchBrief, ResearchSourceGroup } from "@/lib/marketer/types";
import { formatResearchPlatformLabels } from "@/lib/marketer/research-notes";
import { RESEARCH_POST_AGE_OPTIONS } from "@/lib/marketer/research-adapters";

interface ResearchBoardProps {
  slug: string;
}

interface ResearchResponse {
  sources: ResearchSourceGroup[];
  briefs: ResearchBrief[];
  runOptions?: {
    platforms: Array<{ id: string; label: string }>;
    postAgeOptions: Array<{ days: number; label: string }>;
    defaultPlatforms: string[];
    defaultPostAgeDays: number;
  };
  evidenceImports: Array<{ id: string; filename: string | null; createdAt: string; rowCount: number }>;
  scraperRuns: Array<{
    id: string;
    scraper_key: string;
    status: string;
    started_at: string | null;
    error_message: string | null;
  }>;
}

type ResearchPlatform = "instagram" | "tiktok" | "html" | "facebook" | "reddit" | "linkedin";

function postAgeLabel(days: number | null): string {
  if (days == null) return "—";
  return RESEARCH_POST_AGE_OPTIONS.find((o) => o.days === days)?.label ?? `Last ${days} days`;
}

function platformLabels(ids: string[]): string {
  const labels = formatResearchPlatformLabels(ids);
  return labels || "—";
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function ResearchBoard({ slug }: ResearchBoardProps) {
  const [data, setData] = useState<ResearchResponse | null>(null);
  const [activeSource, setActiveSource] = useState("instagram");
  const [paste, setPaste] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [selectedPlatforms, setSelectedPlatforms] = useState<ResearchPlatform[]>(["instagram", "tiktok"]);
  const [postMaxAgeDays, setPostMaxAgeDays] = useState(30);
  const [uploading, setUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [editingBriefId, setEditingBriefId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async (signal: AbortSignal) => {
    const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research`, { signal });
    if (!res.ok) throw new Error("Failed to load research");
    const j = (await res.json()) as ResearchResponse;
    if (signal.aborted) return;
    setData(j);
    if (j.runOptions) {
      setSelectedPlatforms(j.runOptions.defaultPlatforms as ResearchPlatform[]);
      setPostMaxAgeDays(j.runOptions.defaultPostAgeDays);
    }
  }, [slug]);

  const refreshData = useCallback(async () => {
    const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research`);
    if (!res.ok) throw new Error("Failed to refresh research");
    const j = (await res.json()) as ResearchResponse;
    setData(j);
    if (j.runOptions) {
      setSelectedPlatforms(j.runOptions.defaultPlatforms as ResearchPlatform[]);
      setPostMaxAgeDays(j.runOptions.defaultPostAgeDays);
    }
  }, [slug]);

  const { loading, error, setError, reload } = useAbortableLoad([slug], load);

  useEffect(() => {
    const group = data?.sources.find((s) => s.id === activeSource);
    if (group) {
      setPaste(group.handles.join("\n"));
    }
  }, [activeSource, data?.sources]);

  async function saveSources() {
    const group = data?.sources.find((s) => s.id === activeSource);
    if (!group) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tab: group.tab, paste }),
      });
      if (!res.ok) throw new Error("Save failed");
      setMessage(`${group.label} saved.`);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function togglePlatform(id: ResearchPlatform) {
    setSelectedPlatforms((prev) => {
      if (prev.includes(id)) {
        const next = prev.filter((p) => p !== id);
        return next.length ? next : prev;
      }
      return [...prev, id];
    });
  }

  async function runResearch() {
    if (selectedPlatforms.length === 0) {
      setError("Select at least one platform.");
      return;
    }
    setRunning(true);
    setMessage(null);
    setError(null);
    try {
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "run_scraper",
          platforms: selectedPlatforms,
          postMaxAgeDays,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.message ?? "Research failed to start");
      const ageLabel =
        data?.runOptions?.postAgeOptions.find((o) => o.days === postMaxAgeDays)?.label ??
        `last ${postMaxAgeDays} days`;
      const platformLabelsStr =
        data?.runOptions?.platforms
          .filter((p) => selectedPlatforms.includes(p.id as ResearchPlatform))
          .map((p) => p.label)
          .join(", ") ?? selectedPlatforms.join(", ");
      setMessage(
        `Market research started for ${platformLabelsStr} (${ageLabel}). Results appear as research briefs once processing completes.`
      );
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  }

  async function uploadWorkbook(file: File) {
    setUploading(true);
    setUploadStatus(null);
    setMessage(null);
    setError(null);
    try {
      const data_base64 = await fileToBase64(file);
      const res = await fetch(`/api/brand/${encodeURIComponent(slug)}/research/upload`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, data_base64 }),
      });
      let j: {
        ok?: boolean;
        message?: string;
        total_rows?: number;
        tabs?: Array<{ label: string; row_count: number; sheet_name: string }>;
      };
      try {
        j = (await res.json()) as typeof j;
      } catch {
        throw new Error(`Upload failed (HTTP ${res.status})`);
      }
      if (!res.ok) throw new Error(j.message ?? "Upload failed");
      const parts =
        j.tabs
          ?.filter((t) => t.row_count > 0)
          .map((t) => `${t.row_count} ${t.label.toLowerCase()}`)
          .join(", ") ?? "";
      const statusText = parts
        ? `Imported ${j.total_rows ?? 0} sources (${parts}). Watchlist tabs updated below.`
        : `Workbook uploaded but no source rows were found. Use sheet tabs: IGAccounts, TikTokAccounts, Hashtags, SubReddits, Facebook, Websites+Blogs.`;
      setUploadStatus({ kind: "ok", text: statusText });
      setMessage(statusText);
      await refreshData();
    } catch (e) {
      const text = e instanceof Error ? e.message : "Upload failed";
      setUploadStatus({ kind: "err", text });
      setError(text);
    } finally {
      setUploading(false);
    }
  }

  async function saveRename(packId: string) {
    const title = renameDraft.trim();
    if (!title) return;
    setError(null);
    try {
      const res = await fetch(
        `/api/brand/${encodeURIComponent(slug)}/research/briefs/${encodeURIComponent(packId)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title }),
        }
      );
      if (!res.ok) throw new Error("Rename failed");
      setMessage("Brief renamed.");
      setRenameDraft("");
      setEditingBriefId(null);
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    }
  }

  if (loading) return <p className="workspace-muted">Loading research…</p>;
  if (error && !data) return <p className="workspace-error">{error}</p>;

  const activeGroup = data?.sources.find((s) => s.id === activeSource);
  const hasWatchlistSources = (data?.sources ?? []).some((s) => s.handles.length > 0);

  return (
    <div className="research-board">
      <section className="research-section">
        <h3>Import from spreadsheet</h3>
        <p className="research-lead">
          Upload an <strong>.xlsx</strong> workbook to fill every watchlist tab at once for <strong>{slug}</strong>.
          Each sheet tab maps to a source type (Instagram accounts, hashtags, subreddits, etc.). You can still edit
          individual tabs below after import.
        </p>
        <div className="research-upload-panel">
          <a
            href={`/api/brand/${encodeURIComponent(slug)}/research/workbook-template`}
            className="btn-ghost btn-sm"
            download="caf-research-sources-template.xlsx"
          >
            Download template
          </a>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            disabled={uploading}
            className="research-upload-input-hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void uploadWorkbook(file);
            }}
          />
          <button
            type="button"
            className="btn-primary btn-sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            {uploading ? "Importing…" : "Upload .xlsx"}
          </button>
        </div>
        {uploadStatus && (
          <p className={uploadStatus.kind === "err" ? "research-upload-status research-upload-status--err" : "research-upload-status research-upload-status--ok"}>
            {uploadStatus.text}
          </p>
        )}
        <p className="research-run-hint">
          Expected sheet tabs: <span className="mono">IGAccounts</span>, <span className="mono">TikTokAccounts</span>,{" "}
          <span className="mono">Hashtags</span>, <span className="mono">SubReddits</span>, <span className="mono">Facebook</span>,{" "}
          <span className="mono">Websites+Blogs</span> — with columns <span className="mono">Name</span>,{" "}
          <span className="mono">Link</span>, <span className="mono">Platform</span>.
        </p>
      </section>

      <section className="research-section">
        <h3>Watchlist</h3>
        <p className="research-lead">
          Add accounts, hashtags, subreddits, and competitors for <strong>{slug}</strong>. Paste one entry per line —
          each brand keeps its own watchlist. CAF uses these when you start market research.
        </p>
        <div className="research-source-tabs">
          {(data?.sources ?? []).map((s) => (
            <button
              key={s.id}
              type="button"
              className={`research-source-tab ${activeSource === s.id ? "active" : ""}`}
              onClick={() => setActiveSource(s.id)}
            >
              {s.label}
              {s.handles.length > 0 && <span className="research-source-count">{s.handles.length}</span>}
            </button>
          ))}
        </div>
        {activeGroup && (
          <div className="research-paste-panel">
            <textarea
              className="research-paste"
              rows={8}
              placeholder={activeGroup.placeholder}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
            />
            <div className="research-paste-actions">
              <button type="button" className="btn-primary btn-sm" disabled={saving} onClick={() => void saveSources()}>
                {saving ? "Saving…" : "Save list"}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="research-section">
        <div className="research-section-head">
          <h3>Start market research</h3>
          <button
            type="button"
            className="btn-primary"
            disabled={running || selectedPlatforms.length === 0}
            onClick={() => void runResearch()}
          >
            {running ? "Starting…" : "Start market research"}
          </button>
        </div>
        <p className="research-lead">
          Choose which platforms to analyze and how far back to look for posts. After import, processing turns evidence
          into a <strong>research brief</strong> with ideas and market intelligence.
        </p>

        <div className="research-run-options">
          <div className="research-run-block">
            <span className="research-run-label">Platforms to analyze</span>
            <div className="research-platform-grid">
              {(data?.runOptions?.platforms ?? []).map((p) => (
                <label key={p.id} className="research-platform-chip">
                  <input
                    type="checkbox"
                    checked={selectedPlatforms.includes(p.id as ResearchPlatform)}
                    onChange={() => togglePlatform(p.id as ResearchPlatform)}
                  />
                  {p.label}
                </label>
              ))}
            </div>
          </div>
          <div className="research-run-block">
            <label className="research-run-label" htmlFor="research-post-age">
              Include posts from the last…
            </label>
            <select
              id="research-post-age"
              className="research-post-age"
              value={postMaxAgeDays}
              onChange={(e) => setPostMaxAgeDays(Number(e.target.value))}
            >
              {(data?.runOptions?.postAgeOptions ?? []).map((o) => (
                <option key={o.days} value={o.days}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="research-run-hint">
              Only posts within this window are collected. TikTok, Instagram, Facebook, and Reddit each use their
              platform&apos;s native date filters.
            </p>
          </div>
        </div>

        {!hasWatchlistSources && (
          <p className="section-stub-note">Tip: add watchlist sources first so research has accounts and hashtags to analyze.</p>
        )}

        {(data?.scraperRuns ?? []).length > 0 && (
          <ul className="research-runs">
            {data!.scraperRuns.slice(0, 3).map((run) => (
              <li key={run.id}>
                <span className={`research-run-status research-run-status--${run.status}`}>{run.status}</span>
                Research run · {run.scraper_key} · {run.started_at?.slice(0, 16) ?? "pending"}
                {run.error_message && <span className="research-run-err"> — {run.error_message}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="research-section">
        <h3>Research briefs</h3>
        <p className="research-lead">
          Completed research stored as briefs — easy to revisit and use for ideas and intelligence.
        </p>
        {(data?.briefs ?? []).length === 0 ? (
          <div className="workspace-empty workspace-empty--compact">
            <p>No research briefs yet. Add sources and start market research to get started.</p>
            <button type="button" className="btn-primary btn-sm" onClick={() => void runResearch()} disabled={running}>
              Start market research
            </button>
          </div>
        ) : (
          <div className="research-briefs">
            {data!.briefs.map((b) => (
              <article key={b.id} className="research-brief-card">
                <h4>{b.userTitle || b.label}</h4>
                {b.userTitle && b.label !== b.userTitle && (
                  <p className="research-brief-full-label">{b.label}</p>
                )}
                <div className="research-brief-meta">
                  {b.createdAt && <span>{new Date(b.createdAt).toLocaleDateString()}</span>}
                  {b.sourceWindow && <span>Window: {b.sourceWindow}</span>}
                  <span>{platformLabels(b.platforms)}</span>
                  <span>{postAgeLabel(b.postMaxAgeDays)}</span>
                  <span>{b.ideasCount} ideas</span>
                </div>
                <div className="research-brief-rename">
                  <label className="research-run-label" htmlFor={`brief-name-${b.id}`}>
                    Brief name
                  </label>
                  <input
                    id={`brief-name-${b.id}`}
                    type="text"
                    placeholder="e.g. Jun 25, 2026 12:02 · Sign And Sound · Instagram, TikTok"
                    value={editingBriefId === b.id ? renameDraft : b.userTitle ?? ""}
                    onFocus={() => {
                      setEditingBriefId(b.id);
                      setRenameDraft(b.userTitle ?? "");
                    }}
                    onChange={(e) => {
                      setEditingBriefId(b.id);
                      setRenameDraft(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveRename(b.id);
                    }}
                  />
                  <button
                    type="button"
                    className="btn-ghost btn-sm"
                    disabled={editingBriefId !== b.id || !renameDraft.trim()}
                    onClick={() => void saveRename(b.id)}
                  >
                    Save name
                  </button>
                </div>
                <div className="research-brief-actions">
                  <Link href={`/brand/${encodeURIComponent(slug)}/intelligence?packId=${encodeURIComponent(b.id)}`} className="btn-ghost btn-sm">
                    View intelligence
                  </Link>
                  <Link href={`/brand/${encodeURIComponent(slug)}/ideas?packId=${encodeURIComponent(b.id)}`} className="btn-ghost btn-sm">
                    View ideas
                  </Link>
                  <Link
                    href={`/brand/${encodeURIComponent(slug)}/ideas?packId=${encodeURIComponent(b.id)}&tab=top_performers`}
                    className="btn-ghost btn-sm"
                  >
                    View top performers
                  </Link>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {(message || error) && (
        <p className={error ? "workspace-error" : "profile-editor-ok"}>{error ?? message}</p>
      )}
    </div>
  );
}
