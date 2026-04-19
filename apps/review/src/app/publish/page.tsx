"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { zipSync } from "fflate";
import { useReviewProject } from "@/components/ReviewProjectContext";
import { WorkbenchFilters } from "@/components/WorkbenchFilters";
import { TaskTable, type GroupBy } from "@/components/TaskTable";
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

/** Same shape as GET /api/tasks while this page pins `status=approved`. */
interface ApprovedTasksResponse {
  items: ReviewQueueRow[];
  total: number;
  page: number;
  limit: number;
  scope?: "all" | "single";
  tabCounts?: { in_review: number; approved: number; rejected: number; needs_edit: number };
  statusCounts?: Record<string, number>;
  missingPreviewCount?: number;
}

interface FacetsResponse {
  project?: string[];
  run_id?: string[];
  run_display_names?: Record<string, string>;
  platform?: string[];
  flow_type?: string[];
  recommended_route?: string[];
}

const PLATFORMS: { id: string; n8nReady: boolean }[] = [
  { id: "Instagram", n8nReady: true },
  { id: "Facebook", n8nReady: true },
  { id: "TikTok", n8nReady: false },
];

const PUBLISH_FONT_ZOOM_STORAGE = "caf_review_publish_font_zoom";

const PUBLISH_FONT_ZOOM_OPTIONS = [
  { label: "Small", value: 0.88 },
  { label: "Default", value: 1 },
  { label: "Large", value: 1.12 },
  { label: "Extra large", value: 1.25 },
] as const;

function nearestPublishFontZoom(n: number): number {
  const allowed = PUBLISH_FONT_ZOOM_OPTIONS.map((o) => o.value);
  if (!Number.isFinite(n)) return 1;
  const c = Math.min(1.35, Math.max(0.8, n));
  return allowed.reduce((best, v) => (Math.abs(v - c) < Math.abs(best - c) ? v : best), 1);
}

function localDatetimeValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Default publish schedule: a bit in the future so rows stay in the “upcoming” queue, not due immediately. */
function defaultScheduleLocalDatetime(): string {
  return localDatetimeValue(new Date(Date.now() + 2 * 60 * 60 * 1000));
}

function safeFilename(s: string): string {
  return (s || "file").replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").slice(0, 160);
}

/** Clipboard API throws when the document is not focused (e.g. embedded devtools). */
async function copyToClipboardSafe(text: string): Promise<boolean> {
  try {
    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
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

function looksLikeErrorMessage(msg: string): boolean {
  const m = msg.toLowerCase();
  return (
    m.includes("http 401") ||
    m.includes("http 403") ||
    m.includes("http 404") ||
    m.includes("http 409") ||
    m.includes("http 4") ||
    m.includes("http 5") ||
    m.includes("meta_publish") ||
    m.includes("publish_failed") ||
    m.includes("session has expired") ||
    m.includes("access token") ||
    m.includes("token has expired") ||
    m.includes("error:") ||
    m.includes("failed")
  );
}

function PublishPageContent() {
  const { multiProject, activeProjectSlug, lockedSlug, navHref } = useReviewProject();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<"approved" | "scheduled" | "published">("approved");
  const [approved, setApproved] = useState<ApprovedTasksResponse | null>(null);
  const [facets, setFacets] = useState<FacetsResponse>({});
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
  const [scheduledLocal, setScheduledLocal] = useState(() => defaultScheduleLocalDatetime());
  const [selectedPlatforms, setSelectedPlatforms] = useState<Record<string, boolean>>({
    Instagram: true,
    Facebook: false,
    TikTok: false,
  });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [n8nPreview, setN8nPreview] = useState<string | null>(null);
  const [scheduledPlacements, setScheduledPlacements] = useState<PublicationPlacement[]>([]);
  const [loadingScheduled, setLoadingScheduled] = useState(false);
  const [publishedPlacements, setPublishedPlacements] = useState<PublicationPlacement[]>([]);
  const [loadingPublished, setLoadingPublished] = useState(false);
  const [projectStrategy, setProjectStrategy] = useState<Record<string, unknown> | null>(null);
  const [loadingStrategy, setLoadingStrategy] = useState(false);
  const [downloadingZip, setDownloadingZip] = useState(false);
  const [removingPlacementId, setRemovingPlacementId] = useState<string | null>(null);
  const [startingPlacementId, setStartingPlacementId] = useState<string | null>(null);
  const [feedbackAt, setFeedbackAt] = useState<Date | null>(null);
  const autoSwitchedToScheduledRef = useRef(false);
  const [publishFontZoom, setPublishFontZoom] = useState(1);

  const projectSlug = (selected?.project ?? "").trim();
  const effectiveProjectForQueue = (
    projectSlug ||
    (approved?.items[0]?.project ?? "").trim() ||
    ""
  ).trim();

  useEffect(() => {
    if (message != null && message !== "") setFeedbackAt(new Date());
  }, [message]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(PUBLISH_FONT_ZOOM_STORAGE);
      if (raw == null || raw === "") return;
      const n = Number.parseFloat(raw);
      setPublishFontZoom(nearestPublishFontZoom(n));
    } catch {
      /* ignore */
    }
  }, []);

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

  const approvedTasksQuery = useMemo(() => {
    const q = new URLSearchParams(searchParams.toString());
    q.set("status", "approved");
    if (!q.get("limit")) q.set("limit", "200");
    return q.toString();
  }, [searchParams]);

  const groupBy = (searchParams.get("group") ?? "") as GroupBy;

  const fetchApproved = useCallback(async () => {
    setLoadingApproved(true);
    try {
      const res = await fetch(`/api/tasks?${approvedTasksQuery}`);
      if (!res.ok) throw new Error(await res.text());
      const json: ApprovedTasksResponse = await res.json();
      setApproved(json);
    } catch {
      setApproved(null);
    } finally {
      setLoadingApproved(false);
    }
  }, [approvedTasksQuery]);

  useEffect(() => {
    fetchApproved();
  }, [fetchApproved]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/facets")
      .then((r) => (r.ok ? r.json() : {}))
      .then((f: FacetsResponse) => {
        if (!cancelled) setFacets(f);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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

  const fetchScheduledQueue = useCallback(async () => {
    const p = effectiveProjectForQueue;
    if (!p) {
      setScheduledPlacements([]);
      return;
    }
    setLoadingScheduled(true);
    try {
      const res = await fetch(`/api/publish?upcoming_only=1&project=${encodeURIComponent(p)}&limit=50`);
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { placements?: PublicationPlacement[] };
      setScheduledPlacements(json.placements ?? []);
    } catch {
      setScheduledPlacements([]);
    } finally {
      setLoadingScheduled(false);
    }
  }, [effectiveProjectForQueue]);

  const fetchPublishedQueue = useCallback(async () => {
    const p = effectiveProjectForQueue;
    if (!p) {
      setPublishedPlacements([]);
      return;
    }
    setLoadingPublished(true);
    try {
      const res = await fetch(
        `/api/publish?status=published&project=${encodeURIComponent(p)}&limit=200`
      );
      if (!res.ok) throw new Error(await res.text());
      const json = (await res.json()) as { placements?: PublicationPlacement[] };
      setPublishedPlacements(json.placements ?? []);
    } catch {
      setPublishedPlacements([]);
    } finally {
      setLoadingPublished(false);
    }
  }, [effectiveProjectForQueue]);

  const scheduledByTask = useMemo(() => {
    const map = new Map<string, PublicationPlacement[]>();
    for (const pl of scheduledPlacements) {
      const tid = (pl.task_id ?? "").trim();
      if (!tid) continue;
      if (!map.has(tid)) map.set(tid, []);
      map.get(tid)!.push(pl);
    }
    const tasks = Array.from(map.entries()).map(([task_id, rows]) => {
      const sorted = [...rows].sort((a, b) => (a.platform ?? "").localeCompare(b.platform ?? ""));
      const earliest =
        sorted
          .map((r) => (typeof r.scheduled_at === "string" ? Date.parse(r.scheduled_at) : NaN))
          .filter((n) => Number.isFinite(n))
          .sort((a, b) => a - b)[0] ?? null;
      return { task_id, placements: sorted, earliest };
    });
    tasks.sort((a, b) => {
      if (a.earliest != null && b.earliest != null) return a.earliest - b.earliest;
      if (a.earliest != null) return -1;
      if (b.earliest != null) return 1;
      return a.task_id.localeCompare(b.task_id);
    });
    return tasks;
  }, [scheduledPlacements]);

  const duePreviewByTaskId = useMemo(() => {
    const m = new Map<string, { preview_url?: string; title?: string }>();
    for (const r of approved?.items ?? []) {
      const tid = (r.task_id ?? "").trim();
      if (!tid) continue;
      if (!m.has(tid)) m.set(tid, { preview_url: (r.preview_url ?? "").trim() || undefined, title: (r.generated_title ?? "").trim() || undefined });
    }
    return m;
  }, [approved?.items]);

  const scheduledTaskRows: ReviewQueueRow[] = useMemo(() => {
    const proj = effectiveProjectForQueue;
    return scheduledByTask.map(({ task_id, placements: rows, earliest }) => {
      const tid = task_id.trim();
      const approvedRow = approved?.items.find((r) => (r.task_id ?? "").trim() === tid);

      const platforms = Array.from(new Set(rows.map((r) => (r.platform ?? "").trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      );
      const platformLabel = platforms.length === 0 ? "—" : platforms.length === 1 ? platforms[0]! : platforms.join(" + ");

      const formats = Array.from(new Set(rows.map((r) => (r.content_format ?? "").trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      );
      const formatLabel = formats.length === 0 ? "" : formats.length === 1 ? formats[0]! : formats.join(" + ");

      const meta = duePreviewByTaskId.get(tid);
      const previewUrl = (approvedRow?.preview_url ?? meta?.preview_url ?? "").trim() || undefined;
      const generatedTitle = (approvedRow?.generated_title ?? meta?.title ?? "").trim() || undefined;

      const earliestLabel =
        earliest != null && Number.isFinite(earliest) ? new Date(earliest).toLocaleString() : "";

      const base: ReviewQueueRow = approvedRow
        ? { ...approvedRow }
        : {
            task_id: tid,
            project: proj || undefined,
          };

      const baseFlow = (base.flow_type ?? "").trim();
      const flowType = baseFlow || (formatLabel ? formatLabel : undefined);

      return {
        ...base,
        project: ((base.project ?? "").trim() || (proj || "").trim() || undefined) as string | undefined,
        preview_url: previewUrl,
        generated_title: generatedTitle,
        platform: platformLabel,
        flow_type: flowType,
        review_status: earliestLabel ? `Scheduled · ${earliestLabel}` : "Scheduled",
        decision: `${rows.length} slot(s)`,
        recommended_route: (base.recommended_route ?? "").trim() || "—",
      };
    });
  }, [approved?.items, scheduledByTask, duePreviewByTaskId, effectiveProjectForQueue]);

  const selectedScheduledPlacements = useMemo(() => {
    const tid = (selected?.task_id ?? "").trim();
    if (!tid) return [];
    return scheduledPlacements.filter((p) => (p.task_id ?? "").trim() === tid);
  }, [scheduledPlacements, selected?.task_id]);

  const publishedByTask = useMemo(() => {
    const map = new Map<string, PublicationPlacement[]>();
    for (const pl of publishedPlacements) {
      if ((pl.status ?? "").toLowerCase() !== "published") continue;
      const tid = (pl.task_id ?? "").trim();
      if (!tid) continue;
      if (!map.has(tid)) map.set(tid, []);
      map.get(tid)!.push(pl);
    }
    const tasks = Array.from(map.entries()).map(([task_id, rows]) => {
      const sorted = [...rows].sort((a, b) => (a.platform ?? "").localeCompare(b.platform ?? ""));
      const times = sorted
        .map((r) => (typeof r.published_at === "string" ? Date.parse(r.published_at) : NaN))
        .filter((n) => Number.isFinite(n));
      const latest = times.length ? Math.max(...times) : null;
      return { task_id, placements: sorted, latest };
    });
    tasks.sort((a, b) => {
      if (a.latest != null && b.latest != null) return b.latest - a.latest;
      if (a.latest != null) return -1;
      if (b.latest != null) return 1;
      return a.task_id.localeCompare(b.task_id);
    });
    return tasks;
  }, [publishedPlacements]);

  const publishedTaskRows: ReviewQueueRow[] = useMemo(() => {
    const proj = effectiveProjectForQueue;
    return publishedByTask.map(({ task_id, placements: rows, latest }) => {
      const tid = task_id.trim();
      const approvedRow = approved?.items.find((r) => (r.task_id ?? "").trim() === tid);

      const platforms = Array.from(new Set(rows.map((r) => (r.platform ?? "").trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      );
      const platformLabel = platforms.length === 0 ? "—" : platforms.length === 1 ? platforms[0]! : platforms.join(" + ");

      const formats = Array.from(new Set(rows.map((r) => (r.content_format ?? "").trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b)
      );
      const formatLabel = formats.length === 0 ? "" : formats.length === 1 ? formats[0]! : formats.join(" + ");

      const meta = duePreviewByTaskId.get(tid);
      const previewUrl = (approvedRow?.preview_url ?? meta?.preview_url ?? "").trim() || undefined;
      const generatedTitle = (approvedRow?.generated_title ?? meta?.title ?? "").trim() || undefined;

      const latestLabel =
        latest != null && Number.isFinite(latest) ? new Date(latest).toLocaleString() : "";

      const base: ReviewQueueRow = approvedRow
        ? { ...approvedRow }
        : {
            task_id: tid,
            project: proj || undefined,
          };

      const baseFlow = (base.flow_type ?? "").trim();
      const flowType = baseFlow || (formatLabel ? formatLabel : undefined);

      return {
        ...base,
        project: ((base.project ?? "").trim() || (proj || "").trim() || undefined) as string | undefined,
        preview_url: previewUrl,
        generated_title: generatedTitle,
        platform: platformLabel,
        flow_type: flowType,
        review_status: latestLabel ? `Published · ${latestLabel}` : "Published",
        decision: `${rows.length} live`,
        recommended_route: (base.recommended_route ?? "").trim() || "—",
      };
    });
  }, [approved?.items, duePreviewByTaskId, effectiveProjectForQueue, publishedByTask]);

  const selectedPublishedPlacements = useMemo(() => {
    const tid = (selected?.task_id ?? "").trim();
    if (!tid) return [];
    return publishedPlacements.filter(
      (p) => (p.task_id ?? "").trim() === tid && (p.status ?? "").toLowerCase() === "published"
    );
  }, [publishedPlacements, selected?.task_id]);

  useEffect(() => {
    fetchScheduledQueue();
  }, [fetchScheduledQueue]);

  useEffect(() => {
    if (activeTab === "published") void fetchPublishedQueue();
  }, [activeTab, fetchPublishedQueue]);

  useEffect(() => {
    if (effectiveProjectForQueue) loadProjectStrategy(effectiveProjectForQueue);
  }, [effectiveProjectForQueue, loadProjectStrategy]);

  useEffect(() => {
    // If user opens /publish and there are upcoming scheduled items, open Scheduled once.
    if (autoSwitchedToScheduledRef.current) return;
    if (activeTab !== "approved") return;
    if (scheduledPlacements.length <= 0) return;
    autoSwitchedToScheduledRef.current = true;
    setActiveTab("scheduled");
  }, [activeTab, scheduledPlacements.length]);

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

  const removeScheduledPlacement = useCallback(
    async (placementId: string) => {
      const proj = (projectSlug || effectiveProjectForQueue).trim();
      if (!proj) {
        setMessage("Missing project slug; cannot remove placement.");
        return;
      }
      if (!window.confirm("Remove this scheduled placement? It will be deleted permanently.")) return;
      setRemovingPlacementId(placementId);
      setMessage(null);
      try {
        const res = await fetch(
          `/api/publish/${encodeURIComponent(placementId)}?project=${encodeURIComponent(proj)}`,
          { method: "DELETE" }
        );
        const text = await res.text();
        if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
        setMessage("Placement removed.");
        await fetchScheduledQueue();
        if (selected?.task_id) await loadJob(selected);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Delete failed");
      } finally {
        setRemovingPlacementId(null);
      }
    },
    [effectiveProjectForQueue, fetchScheduledQueue, loadJob, projectSlug, selected?.task_id]
  );

  const removeAllScheduledForSelectedTask = useCallback(async () => {
    const proj = (projectSlug || effectiveProjectForQueue).trim();
    if (!proj || !selected?.task_id) {
      setMessage("Select a scheduled task first.");
      return;
    }
    const rows = selectedScheduledPlacements;
    if (rows.length === 0) return;
    if (
      !window.confirm(
        `Delete all ${rows.length} scheduled placement(s) for this task? They will be removed permanently.`
      )
    ) {
      return;
    }
    setRemovingPlacementId("__all__");
    setMessage(null);
    try {
      for (const pl of rows) {
        const res = await fetch(
          `/api/publish/${encodeURIComponent(pl.id)}?project=${encodeURIComponent(proj)}`,
          { method: "DELETE" }
        );
        const text = await res.text();
        if (!res.ok) throw new Error(text || `HTTP ${res.status} (${pl.platform})`);
      }
      setMessage(`Removed ${rows.length} placement(s).`);
      await fetchScheduledQueue();
      if (selected?.task_id) await loadJob(selected);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Delete failed");
      await fetchScheduledQueue();
      if (selected?.task_id) await loadJob(selected);
    } finally {
      setRemovingPlacementId(null);
    }
  }, [
    effectiveProjectForQueue,
    fetchScheduledQueue,
    loadJob,
    projectSlug,
    selected?.task_id,
    selectedScheduledPlacements,
  ]);

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
    const schedDate = scheduledLocal ? new Date(scheduledLocal) : null;
    if (!schedDate || Number.isNaN(schedDate.getTime())) {
      setMessage("Pick a valid schedule time.");
      return;
    }
    if (schedDate.getTime() <= Date.now() + 45_000) {
      setMessage("Schedule must be at least ~1 minute in the future so items stay in the upcoming queue.");
      return;
    }
    const scheduledIso = schedDate.toISOString();
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
        if (contentFormat === "video") {
          // Fall back to contentRow.video_url / preview_url so HeyGen / scene tasks always carry a URL,
          // even when the user hasn't touched the Video URL field.
          const resolvedVideoUrl =
            videoUrl?.trim() ||
            (contentRow?.video_url ?? "").trim() ||
            (contentRow?.preview_url ?? "").trim() ||
            "";
          body.video_url_snapshot = resolvedVideoUrl || null;
        } else body.media_urls_json = media_urls_json;

        const res = await fetch("/api/publish", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error(await res.text());
      }
      setMessage(`Saved ${picks.length} scheduled placement(s).`);
      await loadJob(selected);
      await fetchScheduledQueue();
      await fetchPublishedQueue();
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
      const copied = await copyToClipboardSafe(text);
      setMessage(
        copied
          ? "n8n payload copied to clipboard (Meta tokens are added in n8n, not here)."
          : "Payload loaded below. Clipboard unavailable—focus this tab and try again, or copy manually."
      );
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Copy failed");
    }
  };

  /** Calls Core `…/start` with `allow_not_yet_due` so a future slot can run immediately (in-Core Meta, dry_run, or n8n handoff). */
  const postNowPlacement = async (placementId: string) => {
    const proj = projectSlug || effectiveProjectForQueue;
    if (!proj) {
      setMessage("Set or select a project before posting.");
      return;
    }
    if (
      !window.confirm(
        "Start this placement now (before its scheduled time)?\n\nCore will run the publish executor for this row (Meta in-Core, dry-run, or external payload for n8n), depending on server config."
      )
    ) {
      return;
    }
    setStartingPlacementId(placementId);
    setMessage(null);
    try {
      const res = await fetch(`/api/publish/${encodeURIComponent(placementId)}/start?project=${encodeURIComponent(proj)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ project_slug: proj, allow_not_yet_due: true }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
        message?: string;
        executor?: string;
        placement?: PublicationPlacement;
      };
      if (!res.ok) {
        const detail = typeof j.message === "string" && j.message.trim() ? j.message.trim() : "";
        const err = typeof j.error === "string" && j.error.trim() ? j.error.trim() : "";
        throw new Error([err || `HTTP ${res.status}`, detail].filter(Boolean).join(": "));
      }
      const ex = typeof j.executor === "string" ? j.executor.trim() : "";
      const st = (j.placement?.status ?? "").trim();
      setMessage(
        ex
          ? `Publish started (${ex}). Placement status: ${st || "—"}.`
          : `Publish started. Placement status: ${st || "—"}.`
      );
      await fetchScheduledQueue();
      await fetchPublishedQueue();
      if (selected?.task_id) await loadJob(selected);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Start failed");
    } finally {
      setStartingPlacementId(null);
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
            {multiProject ? (
              <span className="page-header-tenant" style={{ display: "block", marginBottom: 8 }}>
                {activeProjectSlug ? (
                  <>Approved queue filtered to <strong>{activeProjectSlug}</strong></>
                ) : (
                  <>Approved queue: <strong>all projects</strong></>
                )}
              </span>
            ) : lockedSlug ? (
              <span className="page-header-tenant" style={{ display: "block", marginBottom: 8 }}>
                Tenant <strong>{lockedSlug}</strong>
              </span>
            ) : null}
            Schedule in Review (future time) → <span className="mono">Scheduled</span> tab lists{" "}
            <span className="mono">?upcoming_only=1</span>. When <span className="mono">scheduled_at</span> passes, your
            executor uses GET <span className="mono">?due_only=1</span> → POST <span className="mono">…/start</span> →
            n8n / Meta → POST <span className="mono">…/complete</span>.
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <label htmlFor="publish-font-zoom" style={{ fontSize: 12, color: "var(--muted)", whiteSpace: "nowrap" }}>
            Text size
          </label>
          <select
            id="publish-font-zoom"
            aria-label="Publish page text size"
            value={String(publishFontZoom)}
            onChange={(e) => {
              const v = nearestPublishFontZoom(Number.parseFloat(e.target.value));
              setPublishFontZoom(v);
              try {
                localStorage.setItem(PUBLISH_FONT_ZOOM_STORAGE, String(v));
              } catch {
                /* ignore */
              }
            }}
            style={{
              width: 132,
              padding: "6px 10px",
              fontSize: 13,
              borderRadius: 6,
              border: "1px solid var(--border)",
              background: "var(--card)",
              color: "var(--fg)",
              cursor: "pointer",
            }}
          >
            {PUBLISH_FONT_ZOOM_OPTIONS.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="tabs">
        <button
          className={`tab ${activeTab === "approved" ? "active" : ""}`}
          onClick={() => setActiveTab("approved")}
          type="button"
        >
          Approved
          <span className="tab-count">{approved?.tabCounts?.approved ?? approved?.total ?? 0}</span>
        </button>
        <button
          className={`tab ${activeTab === "scheduled" ? "active" : ""}`}
          onClick={() => setActiveTab("scheduled")}
          type="button"
        >
          Scheduled
          <span className="tab-count">{scheduledTaskRows.length}</span>
        </button>
        <button
          className={`tab ${activeTab === "published" ? "active" : ""}`}
          onClick={() => setActiveTab("published")}
          type="button"
        >
          Published
          <span className="tab-count">{publishedTaskRows.length}</span>
        </button>
      </div>

      <div
        className="publish-layout"
        style={{ padding: "12px 28px 32px", zoom: publishFontZoom }}
      >
        <div className="publish-left">
          <Link href={navHref("/")} className="detail-back" style={{ padding: 0, marginBottom: 12, display: "inline-block" }}>
            ← Review Console
          </Link>
          <Link href={navHref("/approved")} className="detail-back" style={{ padding: 0, marginBottom: 16, marginLeft: 16, display: "inline-block" }}>
            Approved list
          </Link>

          {activeTab === "approved" && (
            <>
              {loadingApproved && <p style={{ color: "var(--muted)" }}>Loading approved…</p>}
              {approved && !loadingApproved && (
                <div className="workbench publish-approved-workbench" style={{ padding: 0, margin: 0 }}>
                  <div className="workbench-filters">
                    <WorkbenchFilters
                      basePath="/publish"
                      projectValues={facets.project ?? []}
                      runIdValues={facets.run_id ?? []}
                      runDisplayNames={facets.run_display_names}
                      platformValues={facets.platform ?? []}
                      flowTypeValues={facets.flow_type ?? []}
                      recommendedRouteValues={facets.recommended_route ?? []}
                      reviewStatusValues={approved.statusCounts ? Object.keys(approved.statusCounts) : undefined}
                    />
                  </div>
                  <div className="workbench-table" style={{ paddingTop: 0 }}>
                    <TaskTable
                      items={approved.items}
                      groupBy={groupBy}
                      page={approved.page}
                      limit={approved.limit}
                      total={approved.total}
                      statusCounts={approved.statusCounts}
                      missingPreviewCount={approved.missingPreviewCount}
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
                  </div>
                </div>
              )}
            </>
          )}

          {activeTab === "scheduled" && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 650, margin: 0 }}>Upcoming publishes</h3>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                  {effectiveProjectForQueue || "—"}
                </span>
                <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={() => fetchScheduledQueue()}>
                  Refresh
                </button>
              </div>

              {!effectiveProjectForQueue && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>
                  Pick a task from <span className="mono">Approved</span> first (so we know which project to query), or open the Approved list and return here.
                </p>
              )}

              {effectiveProjectForQueue && loadingScheduled && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading scheduled queue…</p>
              )}

              {effectiveProjectForQueue && !loadingScheduled && scheduledTaskRows.length === 0 && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>
                  No upcoming scheduled placements (with a future time). Use Approved → pick a time in the future →
                  “Schedule selected platforms”.
                </p>
              )}

              {effectiveProjectForQueue && !loadingScheduled && scheduledTaskRows.length > 0 && (
                <TaskTable
                  items={scheduledTaskRows}
                  groupBy=""
                  page={1}
                  limit={scheduledTaskRows.length}
                  total={scheduledTaskRows.length}
                  contentSlug="content"
                  showProjectColumn={approved?.scope === "all"}
                  hideTitleColumn
                  hideOpenColumn
                  selectedRowKey={selectedRowKey}
                  onRowSelect={(row) => {
                    setSelected(row);
                    loadJob(row);
                  }}
                />
              )}
            </>
          )}

          {activeTab === "published" && (
            <>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 12 }}>
                <h3 style={{ fontSize: 14, fontWeight: 650, margin: 0 }}>Published (by task)</h3>
                <span className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                  {effectiveProjectForQueue || "—"}
                </span>
                <button type="button" className="btn-ghost" style={{ fontSize: 12 }} onClick={() => fetchPublishedQueue()}>
                  Refresh
                </button>
              </div>

              {!effectiveProjectForQueue && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>
                  Pick a task from <span className="mono">Approved</span> first so we know which project to query, or open the Approved list and return here.
                </p>
              )}

              {effectiveProjectForQueue && loadingPublished && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>Loading published placements…</p>
              )}

              {effectiveProjectForQueue && !loadingPublished && publishedTaskRows.length === 0 && (
                <p style={{ color: "var(--muted)", fontSize: 13 }}>No published placements in the last 200 rows for this project.</p>
              )}

              {effectiveProjectForQueue && !loadingPublished && publishedTaskRows.length > 0 && (
                <TaskTable
                  items={publishedTaskRows}
                  groupBy=""
                  page={1}
                  limit={publishedTaskRows.length}
                  total={publishedTaskRows.length}
                  contentSlug="content"
                  showProjectColumn={approved?.scope === "all"}
                  hideTitleColumn
                  hideOpenColumn
                  selectedRowKey={selectedRowKey}
                  onRowSelect={(row) => {
                    setSelected(row);
                    loadJob(row);
                  }}
                />
              )}
            </>
          )}
        </div>

        <div
          className="publish-right"
          style={{ borderLeft: "1px solid var(--border)", paddingLeft: 24, minHeight: 400 }}
        >
          {!selected && (
            <p style={{ color: "var(--muted)" }}>
              {activeTab === "scheduled"
                ? "Select a scheduled task to preview copy, use Post now to call Core /start early, or copy n8n payloads. If you do not post manually, your executor picks up due rows (GET ?due_only=1 → POST …/start)."
                : activeTab === "published"
                  ? "Select a published task to see live links per platform and preview."
                  : "Select a row to compose a publish."}
            </p>
          )}
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
                        run:{" "}
                        {(facets.run_display_names?.[job.run_id] ?? "").trim() ? (
                          <>
                            <span>{String(facets.run_display_names?.[job.run_id]).trim()}</span>
                            <span className="mono" style={{ marginLeft: 6 }}>
                              ({job.run_id})
                            </span>
                          </>
                        ) : (
                          <span className="mono">{job.run_id}</span>
                        )}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {message != null && message !== "" && (
                <div
                  role="status"
                  aria-live="polite"
                  style={{
                    marginBottom: 16,
                    padding: "12px 14px",
                    borderRadius: 10,
                    border: `1px solid ${
                      looksLikeErrorMessage(message || "")
                        ? "rgba(248, 113, 113, 0.5)"
                        : "rgba(34, 197, 94, 0.35)"
                    }`,
                    background: looksLikeErrorMessage(message || "")
                      ? "rgba(248, 113, 113, 0.12)"
                      : "rgba(34, 197, 94, 0.1)",
                    fontSize: 13,
                    lineHeight: 1.45,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {feedbackAt && (
                    <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>
                      {feedbackAt.toLocaleString(undefined, { dateStyle: "short", timeStyle: "medium" })}
                    </div>
                  )}
                  <div style={{ color: looksLikeErrorMessage(message) ? "var(--red)" : "var(--fg)" }}>{message}</div>
                </div>
              )}

              {activeTab === "scheduled" && selected?.task_id && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 }}>
                    <h3 style={{ margin: 0, fontSize: 14, fontWeight: 650 }}>Scheduled placements (this task)</h3>
                    {selectedScheduledPlacements.length > 0 && (
                      <button
                        type="button"
                        className="btn-ghost"
                        disabled={removingPlacementId != null}
                        style={{ fontSize: 12, color: "var(--red)" }}
                        onClick={() => void removeAllScheduledForSelectedTask()}
                      >
                        {removingPlacementId === "__all__" ? "Removing…" : "Delete all for this task"}
                      </button>
                    )}
                  </div>
                  {selectedScheduledPlacements.length === 0 ? (
                    <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
                      No upcoming scheduled rows for this task in the current list.
                    </p>
                  ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {selectedScheduledPlacements.map((pl) => {
                        const schedBusy = removingPlacementId != null || startingPlacementId != null;
                        return (
                        <li
                          key={pl.id}
                          style={{
                            border: "1px solid var(--border)",
                            borderRadius: 10,
                            padding: 12,
                            marginBottom: 10,
                            background: "var(--panel)",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              flexWrap: "wrap",
                              gap: 10,
                              alignItems: "baseline",
                              justifyContent: "space-between",
                            }}
                          >
                            <div style={{ fontSize: 13 }}>
                              <strong>{pl.platform}</strong> · {pl.content_format} ·{" "}
                              <span style={{ color: "var(--muted)" }}>{pl.status}</span>
                              {pl.scheduled_at && (
                                <span style={{ color: "var(--muted)" }}> · {new Date(pl.scheduled_at).toLocaleString()}</span>
                              )}
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
                              <button
                                type="button"
                                className="btn-primary"
                                disabled={schedBusy}
                                style={{
                                  fontSize: 12,
                                  opacity: schedBusy ? 0.55 : 1,
                                }}
                                onClick={() => void postNowPlacement(pl.id)}
                              >
                                {startingPlacementId === pl.id ? "Starting…" : "Post now"}
                              </button>
                              <button
                                type="button"
                                className="btn-ghost"
                                disabled={schedBusy}
                                style={{
                                  fontSize: 12,
                                  opacity: schedBusy ? 0.55 : 1,
                                }}
                                onClick={() => void copyN8nPayload(pl.id)}
                              >
                                Copy n8n payload
                              </button>
                              <button
                                type="button"
                                className="btn-ghost"
                                disabled={schedBusy}
                                style={{
                                  fontSize: 12,
                                  color: "var(--red)",
                                  opacity: schedBusy && removingPlacementId !== pl.id ? 0.55 : 1,
                                }}
                                onClick={() => void removeScheduledPlacement(pl.id)}
                              >
                                {removingPlacementId === pl.id ? "Removing…" : "Delete"}
                              </button>
                            </div>
                          </div>
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}

              {activeTab === "published" && selected?.task_id && (
                <div style={{ marginBottom: 16 }}>
                  <h3 style={{ margin: "0 0 10px", fontSize: 14, fontWeight: 650 }}>Live on platforms</h3>
                  {selectedPublishedPlacements.length === 0 ? (
                    <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>
                      No published rows for this task in the current list (try Refresh, or older posts may be past the fetch limit).
                    </p>
                  ) : (
                    <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                      {[...selectedPublishedPlacements]
                        .sort((a, b) => (a.platform ?? "").localeCompare(b.platform ?? ""))
                        .map((pl) => (
                          <li
                            key={pl.id}
                            style={{
                              border: "1px solid var(--border)",
                              borderRadius: 10,
                              padding: 12,
                              marginBottom: 10,
                              background: "var(--panel)",
                            }}
                          >
                            <div style={{ fontSize: 14, fontWeight: 650, marginBottom: 6 }}>{pl.platform}</div>
                            <div style={{ fontSize: 12, color: "var(--muted)", marginBottom: 8 }}>
                              {pl.content_format}
                              {pl.published_at && (
                                <>
                                  {" "}
                                  · Published{" "}
                                  <span className="mono">{new Date(pl.published_at).toLocaleString()}</span>
                                </>
                              )}
                            </div>
                            {pl.posted_url ? (
                              <a href={pl.posted_url} target="_blank" rel="noreferrer" style={{ fontSize: 13 }}>
                                Open live post
                              </a>
                            ) : (
                              <span style={{ fontSize: 12, color: "var(--muted)" }}>No permalink stored yet.</span>
                            )}
                            {pl.platform_post_id && (
                              <div
                                className="mono"
                                style={{ fontSize: 11, color: "var(--muted)", marginTop: 8, wordBreak: "break-all" }}
                              >
                                Post id: {pl.platform_post_id}
                              </div>
                            )}
                            {pl.external_ref && (
                              <div className="mono" style={{ fontSize: 11, color: "var(--muted)", marginTop: 4 }}>
                                Ref: {pl.external_ref}
                              </div>
                            )}
                          </li>
                        ))}
                    </ul>
                  )}
                </div>
              )}

              {loadingJob && <p style={{ color: "var(--muted)" }}>Loading task…</p>}

              {!loadingJob && job && (
                <>
                  <div style={{ marginBottom: 14 }}>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", justifyContent: "space-between" }}>
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>Preview (as-posted format)</div>
                      <Link
                        href={`/content/${encodeURIComponent(selected.task_id ?? "")}?project=${encodeURIComponent(
                          projectSlug || effectiveProjectForQueue
                        )}`}
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
                              assetUrls={
                                contentFormat === "video"
                                  ? (() => {
                                      const u =
                                        videoUrl?.trim() ||
                                        (contentRow.video_url ?? "").trim() ||
                                        (contentRow.preview_url ?? "").trim();
                                      return u ? [u] : [];
                                    })()
                                  : mediaUrls
                              }
                              fallbackPreviewUrl={
                                contentFormat === "video"
                                  ? videoUrl?.trim() ||
                                    (contentRow.video_url ?? "").trim() ||
                                    (contentRow.preview_url ?? "").trim() ||
                                    undefined
                                  : mediaUrls[0]
                              }
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
                    className="btn-primary"
                    disabled={saving}
                    onClick={() => submitSchedules()}
                    style={{ marginRight: 12 }}
                  >
                    {saving ? "Scheduling…" : "Schedule selected platforms"}
                  </button>
                  <Link href={`/content/${encodeURIComponent(selected.task_id ?? "")}?project=${encodeURIComponent(projectSlug)}`} className="btn-ghost">
                    Open in content review
                  </Link>

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

export default function PublishPage() {
  return (
    <Suspense
      fallback={
        <>
          <div className="page-header">
            <div>
              <h2>Publish</h2>
              <span className="page-header-sub">Loading…</span>
            </div>
          </div>
          <div style={{ padding: "20px 28px", color: "var(--muted)" }}>Loading publish…</div>
        </>
      }
    >
      <PublishPageContent />
    </Suspense>
  );
}
