"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TaskTable } from "@/components/TaskTable";
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

export default function PublishPage() {
  const [approved, setApproved] = useState<ApprovedResponse | null>(null);
  const [loadingApproved, setLoadingApproved] = useState(true);
  const [selected, setSelected] = useState<ReviewQueueRow | null>(null);
  const [job, setJob] = useState<ReviewJobDetail | null>(null);
  const [loadingJob, setLoadingJob] = useState(false);
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

  const loadJob = useCallback(async (row: ReviewQueueRow) => {
    const tid = row.task_id?.trim();
    const proj = row.project?.trim();
    if (!tid) return;
    setLoadingJob(true);
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
      const pr = proj ? `&project=${encodeURIComponent(proj)}` : "";
      const pres = await fetch(`/api/publish?task_id=${encodeURIComponent(tid)}${pr}`);
      if (pres.ok) {
        const pj = (await pres.json()) as { placements?: PublicationPlacement[] };
        setPlacements(pj.placements ?? []);
      } else setPlacements([]);
    } catch {
      setJob(null);
      setPlacements([]);
    } finally {
      setLoadingJob(false);
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

      <div style={{ padding: "12px 28px 32px", display: "grid", gridTemplateColumns: "minmax(320px,1fr) minmax(400px,1.1fr)", gap: 24, alignItems: "start" }}>
        <div>
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
              selectedRowKey={selectedRowKey}
              onRowSelect={(row) => {
                setSelected(row);
                loadJob(row);
              }}
            />
          )}
        </div>

        <div style={{ borderLeft: "1px solid var(--border)", paddingLeft: 24, minHeight: 400 }}>
          {effectiveProjectForQueue ? (
            <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: "1px solid var(--border)" }}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: 0 }}>Due for publish</h3>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                  {effectiveProjectForQueue}
                </span>
                <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={() => fetchDueQueue()}>
                  Refresh
                </button>
              </div>
              {loadingDue ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading due queue…</p>
              ) : duePlacements.length === 0 ? (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>No scheduled placements past their time.</p>
              ) : (
                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
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
                      <span className="mono" style={{ fontSize: 11, color: "var(--muted)", flex: "1 1 140px" }}>
                        {pl.task_id.slice(0, 48)}
                        {pl.task_id.length > 48 ? "…" : ""}
                      </span>
                      <span>
                        <strong>{pl.platform}</strong> · {pl.content_format}
                      </span>
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
          ) : !loadingApproved ? (
            <p style={{ color: "var(--muted)", fontSize: 13, marginBottom: 20 }}>
              Open the approved list (left) so we can resolve a project slug, or set <span className="mono">PROJECT_SLUG</span>{" "}
              for single-tenant mode.
            </p>
          ) : null}

          {!selected && <p style={{ color: "var(--muted)" }}>Select a row to compose a publish.</p>}
          {selected && (
            <>
              <div style={{ marginBottom: 16 }}>
                <div className="mono" style={{ fontSize: 12, color: "var(--muted)", wordBreak: "break-all" }}>
                  {selected.task_id}
                </div>
                <div style={{ fontSize: 13, marginTop: 4 }}>
                  {(selected.platform ?? "")} · {(selected.flow_type ?? "")} ·{" "}
                  <span style={{ color: "var(--muted)" }}>format: {contentFormat}</span>
                </div>
              </div>

              {loadingJob && <p style={{ color: "var(--muted)" }}>Loading task…</p>}

              {!loadingJob && job && (
                <>
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
