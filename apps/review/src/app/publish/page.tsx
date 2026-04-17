"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { zipSync } from "fflate";
import { TaskTable } from "@/components/TaskTable";
import { TaskViewer } from "@/components/TaskViewer";
import type { ReviewQueueRow } from "@/lib/types";
import type { ReviewJobDetail, PublicationPlacement } from "@/lib/caf-core-client";
import { inferPublishContentFormat } from "@/lib/flow-kind";
import {
  carouselUrlsFromJob,
  pickCaptionFromJob,
  pickTitleFromJob,
  videoUrlFromJob,
} from "@/lib/publish-prefill";

interface ApprovedResponse {
  items: ReviewQueueRow[];
  total: number;
  scope?: "all" | "single";
}

const PLATFORMS: { id: string; n8nReady: boolean }[] = [
  { id: "Instagram", n8nReady: true },
  { id: "Facebook", n8nReady: true },
  { id: "TikTok", n8nReady: false },
];

function localDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function safeFilename(s: string): string {
  return (s || "file").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 160);
}

function filenameFromUrl(url: string, index: number): string {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").pop() || "";
    const clean = safeFilename(base.split("?")[0].split("#")[0]);
    if (clean && /\.[a-z0-9]{2,5}$/i.test(clean)) return clean;
  } catch {
    /* ignore */
  }
  return `image_${String(index + 1).padStart(2, "0")}.jpg`;
}

async function downloadBlobAsFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export default function PublishPage() {
  const [activeTab, setActiveTab] = useState<"approved" | "due">("approved");
  const [approved, setApproved] = useState<ApprovedResponse | null>(null);
  const [loadingApproved, setLoadingApproved] = useState(true);
  const [selected, setSelected] = useState<ReviewQueueRow | null>(null);
  const [job, setJob] = useState<ReviewJobDetail | null>(null);
  const [loadingJob, setLoadingJob] = useState(false);
  const [contentRow, setContentRow] = useState<ReviewQueueRow | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [placements, setPlacements] = useState<PublicationPlacement[]>([]);
  const [title, setTitle] = useState("");
  const [caption, setCaption] = useState("");
  const [mediaUrlsText, setMediaUrlsText] = useState("");
  const [videoUrl, setVideoUrl] = useState("");
  const [scheduledLocal, setScheduledLocal] = useState(() => localDatetimeValue(new Date()));
  const [selectedPlatforms, setSelectedPlatforms] = useState<Record<string, boolean>>({
    Instagram: true,
    Facebook: false,
    TikTok: false,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [n8nPreview, setN8nPreview] = useState<string | null>(null);
  const [duePlacements, setDuePlacements] = useState<PublicationPlacement[]>([]);
  const [loadingDue, setLoadingDue] = useState(false);
  const [projectStrategy, setProjectStrategy] = useState<Record<string, unknown> | null>(null);
  const [loadingStrategy, setLoadingStrategy] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);

  const projectSlug = (selected?.project ?? "").trim();
  const effectiveProjectForQueue = (
    projectSlug ||
    (approved?.items[0]?.project ?? "").trim() ||
    ""
  ).trim();

  const selectedRowKey = useMemo(() => {
    if (!selected?.task_id) return "";
    const p = (selected.project ?? "").trim();
    const t = selected.task_id.trim();
    return `${p}::${t}`;
  }, [selected]);

  const contentFormat = useMemo(() => inferPublishContentFormat(job?.flow_type ?? ""), [job?.flow_type]);

  const mediaUrls = useMemo(
    () =>
      mediaUrlsText
        .split(/\n+/)
        .map((s) => s.trim())
        .filter(Boolean),
    [mediaUrlsText]
  );

  const captionCharCount = useMemo(() => (caption || "").length, [caption]);

  const fetchApproved = useCallback(async () => {
    setLoadingApproved(true);
    try {
      const res = await fetch("/api/approved");
      if (!res.ok) throw new Error(await res.text());
      const json: ApprovedResponse = await res.json();
      setApproved(json);
    } catch {
      setApproved(null);
    } finally {
      setLoadingApproved(false);
    }
  }, []);

  useEffect(() => {
    fetchApproved();
  }, [fetchApproved]);

  const loadProjectStrategy = useCallback(async (slug: string) => {
    const s = (slug || "").trim();
    if (!s) {
      setProjectStrategy(null);
      return;
    }
    setLoadingStrategy(true);
    try {
      const res = await fetch(`/api/project-config/strategy?project=${encodeURIComponent(s)}`);
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { strategy?: Record<string, unknown> | null };
      setProjectStrategy((json.strategy ?? null) as Record<string, unknown> | null);
    } catch {
      setProjectStrategy(null);
    } finally {
      setLoadingStrategy(false);
    }
  }, []);

  const fetchDueQueue = useCallback(async () => {
    const p = effectiveProjectForQueue;
    if (!p) {
      setDuePlacements([]);
      return;
    }
    setLoadingDue(true);
    try {
      const res = await fetch(`/api/publish?due_only=1&project=${encodeURIComponent(p)}&limit=50`);
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { placements?: PublicationPlacement[] };
      setDuePlacements(json.placements ?? []);
    } catch {
      setDuePlacements([]);
    } finally {
      setLoadingDue(false);
    }
  }, [effectiveProjectForQueue]);

  useEffect(() => {
    fetchDueQueue();
  }, [fetchDueQueue]);

  useEffect(() => {
    if (effectiveProjectForQueue) loadProjectStrategy(effectiveProjectForQueue);
  }, [effectiveProjectForQueue, loadProjectStrategy]);

  useEffect(() => {
    // If user opens /publish and there are due items, default to Due tab for quick action.
    if (activeTab === "approved" && duePlacements.length > 0) setActiveTab("due");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [duePlacements.length]);

  const loadJob = useCallback(async (row: ReviewQueueRow) => {
    const tid = row.task_id?.trim();
    const proj = row.project?.trim();
    if (!tid) return;
    setLoadingJob(true);
    setLoadingPreview(true);
    setMessage(null);
    setN8nPreview(null);
    try {
      const qs = new URLSearchParams();
      if (proj) qs.set("project", proj);
      qs.set("include_job", "1");
      const res = await fetch(`/api/task/${encodeURIComponent(tid)}?${qs}`);
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { job?: ReviewJobDetail };
      const j = json.job ?? null;
      setJob(j);
      if (j) {
        setTitle(pickTitleFromJob(j));
        setCaption(pickCaptionFromJob(j));
        const urls = carouselUrlsFromJob(j);
        setMediaUrlsText(urls.join("\n"));
        setVideoUrl(videoUrlFromJob(j));
      }

      // Preview should match the dedicated content view renderer (generated_slides_json + preview_url fields).
      // This is also resilient when job detail is missing some derived fields client-side.
      try {
        const cqs = new URLSearchParams();
        if (proj) cqs.set("project", proj);
        const cres = await fetch(`/api/content/${encodeURIComponent(tid)}?${cqs.toString()}`);
        if (cres.ok) {
          const cj = (await cres.json()) as { data?: ReviewQueueRow };
          setContentRow(cj.data ?? null);
        } else {
          setContentRow(null);
        }
      } catch {
        setContentRow(null);
      } finally {
        setLoadingPreview(false);
      }

      const pr = proj ? `&project=${encodeURIComponent(proj)}` : "";
      const pres = await fetch(`/api/publish?task_id=${encodeURIComponent(tid)}${pr}`);
      if (pres.ok) {
        const pj = (await pres.json()) as { placements?: PublicationPlacement[] };
        setPlacements(pj.placements ?? []);
      } else setPlacements([]);
    } catch {
      setJob(null);
      setContentRow(null);
      setPlacements([]);
    } finally {
      setLoadingJob(false);
      setLoadingPreview(false);
    }
  }, []);

  const startPlacement = useCallback(
    async (placementId: string, project: string, opts?: { allow_not_yet_due?: boolean }) => {
      setMessage(null);
      try {
        const res = await fetch(`/api/publish/${encodeURIComponent(placementId)}/start`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            project_slug: project,
            allow_not_yet_due: opts?.allow_not_yet_due,
          }),
        });
        const text = await res.text();
        let json: { payload?: Record<string, unknown>; error?: string } = {};
        try {
          json = JSON.parse(text) as typeof json;
        } catch {
          /* ignore */
        }
        if (!res.ok) {
          setMessage(json.error ?? text.slice(0, 200));
          return;
        }
        const pretty = JSON.stringify(json.payload ?? {}, null, 2);
        setN8nPreview(pretty);
        await navigator.clipboard.writeText(pretty);
        setMessage("Started → status publishing. n8n payload copied; finish with POST …/complete from n8n.");
        await fetchDueQueue();
        if (selected?.task_id) await loadJob(selected);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Start failed");
      }
    },
    [fetchDueQueue, loadJob, selected]
  );

  const togglePlatform = (id: string) => {
    setSelectedPlatforms((p) => ({ ...p, [id]: !p[id] }));
  };

  const submitSchedules = async () => {
    if (!selected?.task_id || !projectSlug) {
      setMessage("Select a task (with project) first.");
      return;
    }
    const picks = PLATFORMS.filter((p) => selectedPlatforms[p.id]);
    if (picks.length === 0) {
      setMessage("Choose at least one platform.");
      return;
    }
    const scheduledIso = scheduledLocal ? new Date(scheduledLocal).toISOString() : null;
    const media_urls_json = mediaUrlsText
      .split(/\n+/)
      .map((s) => s.trim())
      .filter(Boolean);

    setSaving(true);
    setMessage(null);
    try {
      for (const p of picks) {
        const body: Record<string, unknown> = {
          project_slug: projectSlug,
          task_id: selected.task_id,
          platform: p.id,
          content_format: contentFormat,
          status: "scheduled",
          scheduled_at: scheduledIso,
          caption_snapshot: caption || null,
          title_snapshot: title || null,
        };
        if (contentFormat === "video") body.video_url_snapshot = videoUrl || null;
        else body.media_urls_json = media_urls_json;

        const res = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setMessage(`Saved ${picks.length} scheduled placement(s).`);
      await loadJob(selected);
      await fetchDueQueue();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const copyN8nPayload = async (placementId: string) => {
    const proj = projectSlug || effectiveProjectForQueue;
    if (!proj) return;
    try {
      const res = await fetch(
        `/api/publish/${encodeURIComponent(placementId)}/n8n-payload?project=${encodeURIComponent(proj)}`
      );
      if (!res.ok) throw new Error(await res.text());
      const j = (await res.json()) as { payload?: Record<string, unknown> };
      const text = JSON.stringify(j.payload ?? {}, null, 2);
      setN8nPreview(text);
      await navigator.clipboard.writeText(text);
      setMessage("n8n payload copied to clipboard (Meta tokens are added in n8n, not here).");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Copy failed");
    }
  };

  const downloadImagesZip = useCallback(async () => {
    if (contentFormat === "video") {
      setMessage("This task is video format; image zip is only available for carousel.");
      return;
    }
    if (mediaUrls.length === 0) {
      setMessage("No carousel image URLs found to download.");
      return;
    }
    setDownloadingZip(true);
    setMessage(null);
    try {
      const files: Record<string, Uint8Array> = {};
      for (let i = 0; i < mediaUrls.length; i++) {
        const url = mediaUrls[i];
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Failed to fetch image ${i + 1} (HTTP ${res.status})`);
        const ab = await res.arrayBuffer();
        files[filenameFromUrl(url, i)] = new Uint8Array(ab);
      }
      const zipBytes = zipSync(files, { level: 0 });
      const base = safeFilename(selected?.task_id?.trim() || "carousel");
      // `fflate` returns a Uint8Array; cast for BlobPart compatibility across TS lib versions.
      const blob = new Blob([zipBytes as unknown as BlobPart], { type: "application/zip" });
      await downloadBlobAsFile(blob, `${base}_images.zip`);
      setMessage(`Downloaded ${mediaUrls.length} image(s) as a zip.`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadingZip(false);
    }
  }, [contentFormat, mediaUrls, selected?.task_id]);

  return (
    <>
      <div className="page-header">
        <div>
          <h2>Publish</h2>
          <span className="page-header-sub">
            Schedule in Review → GET <span className="mono">?due_only=1</span> or use the due list → POST{" "}
            <span className="mono">…/start</span> (claim) → n8n Meta/TikTok → POST <span className="mono">…/complete</span>
          </span>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === "approved" ? "active" : ""}`}
          onClick={() => setActiveTab("approved")}
          type="button"
        >
          Approved
          <span className="tab-count">{approved?.total ?? 0}</span>
        </button>
        <button
          className={`tab ${activeTab === "due" ? "active" : ""}`}
          onClick={() => setActiveTab("due")}
          type="button"
        >
          Due
          <span className="tab-count">{duePlacements.length}</span>
        </button>
      </div>

      <div className="publish-layout" style={{ padding: "12px 28px 32px" }}>
        <div
          className="publish-left"
          style={{ display: activeTab === "approved" ? "block" : "none" }}
        >
          <Link href="/" className="detail-back" style={{ padding: 0, marginBottom: 12, display: "inline-block" }}>
            ← Review Console
          </Link>
          <Link href="/approved" className="detail-back" style={{ padding: 0, marginBottom: 16, marginLeft: 16, display: "inline-block" }}>
            Approved list
          </Link>
          {loadingApproved && <p style={{ color: "var(--muted)" }}>Loading approved…</p>}
          {approved && !loadingApproved && (
            <TaskTable
              items={approved.items}
              groupBy=""
              page={1}
              limit={approved.total}
              total={approved.total}
              contentSlug="content"
              showProjectColumn={approved.scope === "all"}
              hideTitleColumn
              hideOpenColumn
              selectedRowKey={selectedRowKey}
              onRowSelect={(row) => {
                setSelected(row);
                loadJob(row);
              }}
            />
          )}
        </div>

        <div
          className="publish-right"
          style={{ borderLeft: "1px solid var(--border)", paddingLeft: 24, minHeight: 400 }}
        >
          {activeTab === "due" && (
            <div style={{ marginBottom: 18, paddingBottom: 18, borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Due for publish</h3>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                  {effectiveProjectForQueue || "—"}
                </span>
                <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={() => fetchDueQueue()}>
                  Refresh
                </button>
              </div>
              {loadingDue ? (
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>Loading due queue…</p>
              ) : duePlacements.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 10 }}>No scheduled placements past their time.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: "10px 0 0" }}>
                  {duePlacements.map((pl) => (
                    <li
                      key={pl.id}
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        alignItems: "center",
                        gap: 8,
                        fontSize: 13,
                        marginBottom: 8,
                        padding: "8px 10px",
                        borderRadius: 8,
                        border: "1px solid var(--border)",
                        background: "var(--panel)",
                      }}
                    >
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={async () => {
                          // Select corresponding job row (if present) so compose panel loads.
                          const match =
                            approved?.items.find((r) => (r.task_id ?? "").trim() === pl.task_id) ??
                            ({ task_id: pl.task_id, project: effectiveProjectForQueue } as ReviewQueueRow);
                          setSelected(match);
                          await loadJob(match);
                        }}
                      >
                        Select
                      </button>
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)", flex: "1 1 160px" }}>
                        {pl.task_id.slice(0, 56)}
                        {pl.task_id.length > 56 ? "…" : ""}
                      </span>
                      <span>
                        <strong>{pl.platform}</strong> · {pl.content_format}
                      </span>
                      {pl.scheduled_at && (
                        <span style={{ color: "var(--muted)", fontSize: 12 }}>
                          {new Date(pl.scheduled_at).toLocaleString()}
                        </span>
                      )}
                      <button
                        type="button"
                        className="btn"
                        style={{ fontSize: 12, padding: "4px 10px" }}
                        onClick={() => startPlacement(pl.id, effectiveProjectForQueue)}
                      >
                        Start &amp; copy payload
                      </button>
                      <button
                        type="button"
                        className="btn-ghost"
                        style={{ fontSize: 12 }}
                        onClick={() => startPlacement(pl.id, effectiveProjectForQueue, { allow_not_yet_due: true })}
                      >
                        Start (ignore schedule)
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {!selected && <p style={{ color: "var(--muted)" }}>Select a row to compose a publish.</p>}
          {selected && (
            <>
              <div
                style={{
                  marginBottom: 16,
                  padding: 12,
                  border: "1px solid var(--border)",
                  background: "var(--panel)",
                  borderRadius: 10,
                }}
              >
                <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "baseline" }}>
                  <div style={{ fontWeight: 650 }}>Publish details</div>
                  <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                    {projectSlug || effectiveProjectForQueue || "—"}
                  </span>
                  {loadingStrategy && (
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>Loading account…</span>
                  )}
                  {!loadingStrategy && projectStrategy && (
                    <>
                      {typeof projectStrategy.instagram_handle === "string" &&
                        projectStrategy.instagram_handle.trim() && (
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            Account:{" "}
                            <span className="mono">
                              {projectStrategy.instagram_handle.trim().startsWith("@")
                                ? projectStrategy.instagram_handle.trim()
                                : `@${projectStrategy.instagram_handle.trim()}`}
                            </span>
                          </span>
                        )}
                      {typeof projectStrategy.owner === "string" && projectStrategy.owner.trim() && (
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>
                          Owner: <span className="mono">{projectStrategy.owner.trim()}</span>
                        </span>
                      )}
                    </>
                  )}
                </div>

                <div className="mono" style={{ fontSize: 12, color: "var(--muted)", wordBreak: "break-all", marginTop: 8 }}>
                  {selected.task_id}
                </div>
                <div style={{ fontSize: 13, marginTop: 6, display: "flex", flexWrap: "wrap", gap: 10 }}>
                  <span>
                    <strong>{(selected.platform ?? "").trim() || "—"}</strong>
                  </span>
                  <span style={{ color: "var(--muted)" }}>·</span>
                  <span>{(selected.flow_type ?? "").trim() || "—"}</span>
                  <span style={{ color: "var(--muted)" }}>· format: {contentFormat}</span>
                  {job?.run_id && (
                    <>
                      <span style={{ color: "var(--muted)" }}>·</span>
                      <span style={{ color: "var(--muted)" }}>
                        run: <span className="mono">{job.run_id}</span>
                      </span>
                    </>
                  )}
                </div>
              </div>

              {loadingJob && <p style={{ color: "var(--muted)" }}>Loading task…</p>}

              {!loadingJob && job && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>Preview (as-posted format)</div>
                      <Link
                        href={`/content/${encodeURIComponent(selected.task_id ?? "")}?project=${encodeURIComponent(projectSlug)}`}
                        className="btn-ghost"
                        style={{ fontSize: 12 }}
                      >
                        Open full content preview
                      </Link>
                    </div>
                    <div style={{ marginTop: 10 }}>
                      {loadingPreview && (
                        <div style={{ color: "var(--muted)", fontSize: 13, padding: "8px 0" }}>Loading preview…</div>
                      )}
                      {!loadingPreview && contentRow && (
                        <div className="publish-preview-grid">
                          <div style={{ minWidth: 0 }}>
                            <TaskViewer
                              data={contentRow}
                              assetUrls={contentFormat === "video" ? (videoUrl ? [videoUrl] : []) : mediaUrls}
                              fallbackPreviewUrl={contentFormat === "video" ? videoUrl : mediaUrls[0]}
                              readOnly
                            />
                          </div>
                          <div
                            className="publish-caption-preview"
                            style={{
                              border: "1px solid var(--border)",
                              background: "var(--panel)",
                              borderRadius: 10,
                              padding: 12,
                              minWidth: 0,
                            }}
                          >
                            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
                              <div style={{ fontWeight: 650, fontSize: 13 }}>Caption preview</div>
                              <span className="mono" style={{ fontSize: 11, color: "var(--muted)" }}>
                                {captionCharCount.toLocaleString()} chars
                              </span>
                            </div>
                            <div style={{ fontSize: 13, lineHeight: 1.45, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                              {caption?.trim() ? caption : <span style={{ color: "var(--muted)" }}>—</span>}
                            </div>
                          </div>
                        </div>
                      )}
                      {!loadingPreview && !contentRow && (
                        <div style={{ color: "var(--muted)", fontSize: 13, padding: "8px 0" }}>
                          Preview unavailable for this task right now (content endpoint didn’t return data). You can still use “Open full content preview”.
                        </div>
                      )}
                    </div>
                  </div>

                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Title</label>
                  <input
                    className="input"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    style={{ width: "100%", marginBottom: 12, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel)" }}
                  />
                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Caption</label>
                  <textarea
                    value={caption}
                    onChange={(e) => setCaption(e.target.value)}
                    rows={5}
                    style={{ width: "100%", marginBottom: 12, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel)", resize: "vertical" }}
                  />
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: -6, marginBottom: 12 }}>
                    <span style={{ fontSize: 12, color: "var(--muted)" }}>
                      {captionCharCount.toLocaleString()} chars
                    </span>
                    <button
                      type="button"
                      className="btn-ghost"
                      style={{ fontSize: 12 }}
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(caption || "");
                          setMessage("Caption copied to clipboard.");
                        } catch {
                          setMessage("Copy failed.");
                        }
                      }}
                    >
                      Copy caption
                    </button>
                  </div>

                  {contentFormat === "video" ? (
                    <>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Video URL</label>
                      <input
                        className="input"
                        value={videoUrl}
                        onChange={(e) => setVideoUrl(e.target.value)}
                        style={{ width: "100%", marginBottom: 12, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel)" }}
                      />
                    </>
                  ) : (
                    <>
                      <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>
                        Carousel image URLs (one per line)
                      </label>
                      <textarea
                        value={mediaUrlsText}
                        onChange={(e) => setMediaUrlsText(e.target.value)}
                        rows={6}
                        style={{ width: "100%", marginBottom: 12, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel)", fontFamily: "var(--mono, monospace)", fontSize: 11 }}
                      />
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginTop: -6, marginBottom: 12 }}>
                        <span style={{ fontSize: 12, color: "var(--muted)" }}>
                          {mediaUrls.length} image(s)
                        </span>
                        <button
                          type="button"
                          className="btn"
                          disabled={downloadingZip || mediaUrls.length === 0}
                          onClick={() => downloadImagesZip()}
                          style={{ fontSize: 12, padding: "6px 10px" }}
                        >
                          {downloadingZip ? "Preparing zip…" : "Download images (.zip)"}
                        </button>
                        {mediaUrls[0] && (
                          <a
                            className="btn-ghost"
                            style={{ fontSize: 12 }}
                            href={mediaUrls[0]}
                            target="_blank"
                            rel="noreferrer"
                          >
                            Open first image
                          </a>
                        )}
                      </div>
                      {mediaUrls.length > 0 && (
                        <div
                          style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
                            gap: 10,
                            marginBottom: 14,
                          }}
                        >
                          {mediaUrls.slice(0, 12).map((u, ix) => (
                            <a
                              key={`${u}::${ix}`}
                              href={u}
                              target="_blank"
                              rel="noreferrer"
                              title="Open in new tab"
                              style={{
                                border: "1px solid var(--border)",
                                borderRadius: 10,
                                overflow: "hidden",
                                background: "var(--panel)",
                                display: "block",
                              }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img
                                src={u}
                                alt={`Carousel image ${ix + 1}`}
                                style={{ width: "100%", height: 92, objectFit: "cover", display: "block" }}
                              />
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  <label style={{ display: "block", fontSize: 12, color: "var(--muted)", marginBottom: 4 }}>Schedule (local)</label>
                  <input
                    type="datetime-local"
                    value={scheduledLocal}
                    onChange={(e) => setScheduledLocal(e.target.value)}
                    style={{ marginBottom: 16, padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--panel)" }}
                  />

                  <div style={{ marginBottom: 12, fontSize: 12, color: "var(--muted)" }}>Platforms</div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
                    {PLATFORMS.map((p) => (
                      <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 14 }}>
                        <input type="checkbox" checked={!!selectedPlatforms[p.id]} onChange={() => togglePlatform(p.id)} />
                        {p.id}
                        {!p.n8nReady && (
                          <span style={{ fontSize: 11, color: "var(--muted)" }}>(executor TBD)</span>
                        )}
                      </label>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="btn"
                    disabled={saving}
                    onClick={() => submitSchedules()}
                    style={{ marginRight: 12 }}
                  >
                    {saving ? "Saving…" : "Save scheduled placements"}
                  </button>
                  <Link href={`/content/${encodeURIComponent(selected.task_id ?? "")}?project=${encodeURIComponent(projectSlug)}`} className="btn-ghost">
                    Open in content review
                  </Link>

                  {message && (
                    <p style={{ marginTop: 16, fontSize: 13, color: message.includes("fail") ? "var(--red)" : "var(--fg)" }}>{message}</p>
                  )}

                  <h3 style={{ marginTop: 28, fontSize: 14, fontWeight: 600 }}>Placements for this task</h3>
                  {placements.length === 0 ? (
                    <p style={{ color: "var(--muted)", fontSize: 13 }}>None yet.</p>
                  ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {placements.map((pl) => (
                        <li
                          key={pl.id}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 8,
                            padding: 12,
                            marginBottom: 10,
                            fontSize: 13,
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
                            <span>
                              <strong>{pl.platform}</strong> · {pl.status}
                              {pl.scheduled_at && (
                                <span style={{ color: "var(--muted)" }}> · {new Date(pl.scheduled_at).toLocaleString()}</span>
                              )}
                            </span>
                            <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={() => copyN8nPayload(pl.id)}>
                              Copy n8n JSON
                            </button>
                          </div>
                          {pl.posted_url && (
                            <a href={pl.posted_url} target="_blank" rel="noreferrer" style={{ fontSize: 12 }}>
                              {pl.posted_url}
                            </a>
                          )}
                          {pl.publish_error && <div style={{ color: "var(--red)", fontSize: 12 }}>{pl.publish_error}</div>}
                        </li>
                      ))}
                    </ul>
                  )}

                  {n8nPreview && (
                    <pre
                      style={{
                        marginTop: 16,
                        padding: 12,
                        background: "var(--panel)",
                        borderRadius: 8,
                        fontSize: 11,
                        overflow: "auto",
                        maxHeight: 280,
                      }}
                    >
                      {n8nPreview}
                    </pre>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
