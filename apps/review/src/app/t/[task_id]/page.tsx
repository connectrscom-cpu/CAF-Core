"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { TaskViewer } from "@/components/TaskViewer";
import { DecisionPanel } from "@/components/DecisionPanel";
import { CarouselEdits, CarouselEditsExport } from "@/components/CarouselEdits";
import { buildSlidesJson, createSyntheticSlides, parseSlidesFromJson } from "@/lib/carousel-slides";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import type { ReviewQueueRow } from "@/lib/types";
import { taskAssetsToPreviewRows, type TaskAssetPreview } from "@/lib/media-url";

function hashtagsInitialFromRow(data: ReviewQueueRow): string {
  const override = (data.final_hashtags_override ?? "").trim();
  if (override) return override;
  const plain = (data.generated_hashtags ?? "").trim();
  if (plain) return plain;
  const json = (data.generated_hashtags_json ?? "").trim();
  if (!json) return "";
  try {
    const parsed = JSON.parse(json) as unknown;
    if (Array.isArray(parsed)) return parsed.map((x) => String(x)).join(" ");
    if (typeof parsed === "string") return parsed;
  } catch { /* use raw */ }
  return json;
}

interface TaskDetailResponse {
  rowIndex: number;
  data: ReviewQueueRow;
}

interface AssetsResponse {
  assets: { position: number; public_url: string | null; asset_type: string | null }[];
}

export default function TaskPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const projectFromUrl = searchParams.get("project")?.trim() ?? "";
  const task_id = typeof params.task_id === "string" ? params.task_id : "";

  const [data, setData] = useState<ReviewQueueRow | null>(null);
  const [taskAssets, setTaskAssets] = useState<TaskAssetPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { slides: initialSlides, raw: rawPayload } = useMemo(
    () => parseSlidesFromJson(data?.generated_slides_json?.trim() || undefined),
    [data?.generated_slides_json]
  );

  const [editedSlides, setEditedSlides] = useState<NormalizedSlide[]>([]);
  const [editedCaption, setEditedCaption] = useState("");
  const [editedTitle, setEditedTitle] = useState("");
  const [editedHook, setEditedHook] = useState("");
  const [editedHashtags, setEditedHashtags] = useState("");

  useEffect(() => {
    setEditedSlides([]);
    setTaskAssets([]);
  }, [task_id]);

  useEffect(() => {
    if (initialSlides.length > 0) {
      if (taskAssets.length > initialSlides.length) {
        const nExtra = taskAssets.length - initialSlides.length;
        const extra: NormalizedSlide[] = Array.from({ length: nExtra }, (_, i) => ({
          index: initialSlides.length + i,
          type: "body",
          headline: "",
          body: "",
          handle: "",
        }));
        setEditedSlides([...initialSlides, ...extra]);
      } else {
        setEditedSlides(initialSlides);
      }
      return;
    }
    if (taskAssets.length > 0) {
      setEditedSlides((prev) =>
        prev.length !== taskAssets.length ? createSyntheticSlides(taskAssets.length) : prev
      );
    }
  }, [initialSlides, taskAssets]);

  useEffect(() => {
    if (!data) return;
    setEditedCaption((data.final_caption_override ?? data.generated_caption ?? "").trim());
    setEditedTitle((data.final_title_override ?? data.generated_title ?? "").trim());
    setEditedHook((data.final_hook_override ?? data.generated_hook ?? "").trim());
    setEditedHashtags(hashtagsInitialFromRow(data));
  }, [data]);

  const fetchTask = useCallback(async () => {
    if (!task_id) return;
    setLoading(true);
    setError(null);
    try {
      const pq = projectFromUrl ? `?project=${encodeURIComponent(projectFromUrl)}` : "";
      const [taskRes, assetsRes] = await Promise.all([
        fetch(`/api/task/${encodeURIComponent(task_id)}${pq}`),
        fetch(`/api/task/${encodeURIComponent(task_id)}/assets${pq}`),
      ]);
      if (taskRes.status === 404) {
        setError("Task not found");
        setData(null);
        setTaskAssets([]);
        return;
      }
      if (!taskRes.ok) throw new Error(await taskRes.text());
      const taskJson: TaskDetailResponse = await taskRes.json();
      setData(taskJson.data);
      if (assetsRes.ok) {
        const assetsJson: AssetsResponse = await assetsRes.json();
        const rows = [...(assetsJson.assets ?? [])].sort((a, b) => a.position - b.position);
        const flowHint = (taskJson.data?.flow_type ?? "").trim();
        setTaskAssets(taskAssetsToPreviewRows(rows, { flowTypeHint: flowHint }));
      } else {
        setTaskAssets([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load task");
      setData(null);
      setTaskAssets([]);
    } finally {
      setLoading(false);
    }
  }, [task_id, projectFromUrl]);

  useEffect(() => { fetchTask(); }, [fetchTask]);

  const decision = useMemo(() => (data?.decision ?? "").trim(), [data?.decision]);
  const notes = useMemo(() => (data?.notes ?? "").trim(), [data?.notes]);
  const runId = (data?.run_id ?? "").trim();

  const { hasEdits, editsSummary } = useMemo(() => {
    const summary: string[] = [];
    if (!data) return { hasEdits: false, editsSummary: [] };
    const initialTitle = (data.final_title_override ?? data.generated_title ?? "").trim();
    const initialHook = (data.final_hook_override ?? data.generated_hook ?? "").trim();
    const initialCaption = (data.final_caption_override ?? data.generated_caption ?? "").trim();
    const initialHashtags = hashtagsInitialFromRow(data);
    if (editedTitle !== initialTitle) summary.push("Title");
    if (editedHook !== initialHook) summary.push("Hook");
    if (editedCaption !== initialCaption) summary.push("Caption");
    if (editedHashtags !== initialHashtags) summary.push("Hashtags");
    const hadParsedSlides = initialSlides.length > 0;
    if (hadParsedSlides) {
      if (editedSlides.length !== initialSlides.length) {
        summary.push("Slides (count)");
      } else {
        for (let i = 0; i < editedSlides.length; i++) {
          const a = editedSlides[i];
          const b = initialSlides[i];
          if (!b || a.headline !== b.headline || a.body !== b.body) summary.push(`Slide ${i + 1}`);
        }
      }
    }
    return { hasEdits: summary.length > 0, editsSummary: summary };
  }, [data, editedTitle, editedHook, editedCaption, editedHashtags, editedSlides, initialSlides]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "a" || e.key === "A") {
        e.preventDefault();
        if (!hasEdits) {
          const btn = document.querySelector('[data-decision="APPROVED"]') as HTMLButtonElement;
          btn?.click();
        }
      }
      if (e.key === "e" || e.key === "E") {
        e.preventDefault();
        (document.querySelector('[data-decision="NEEDS_EDIT"]') as HTMLButtonElement)?.click();
      }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        (document.querySelector('[data-decision="REJECTED"]') as HTMLButtonElement)?.click();
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [hasEdits]);

  const finalSlidesJsonOverride =
    editedSlides.length > 0 && rawPayload !== undefined
      ? JSON.stringify(buildSlidesJson(editedSlides, rawPayload))
      : undefined;

  return (
    <>
      <div className="detail-back">
        <Link href="/">← Back to Workbench</Link>
        {runId && (
          <> · <Link href={`/r/${encodeURIComponent(runId)}`}>Run: {runId}</Link></>
        )}
      </div>
      <h1 className="detail-title">{data?.generated_title || task_id}</h1>
      <p className="detail-subtitle">
        {data?.platform && <>{data.platform} · </>}
        {data?.flow_type && <>{data.flow_type} · </>}
        {task_id}
      </p>

      {error && (
        <div style={{ margin: "0 28px 16px", padding: 12, background: "var(--red-bg)", color: "var(--red)", borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
      {loading && !data && <div style={{ padding: 28, color: "var(--muted)" }}>Loading…</div>}

      {data && !loading && (
        <div className="detail-grid">
          <div style={{ minWidth: 0 }}>
            <TaskViewer
              data={data}
              taskAssets={taskAssets}
              editedSlides={editedSlides.length > 0 ? editedSlides : undefined}
              onSlidesChange={setEditedSlides}
              fallbackPreviewUrl={taskAssets[0]?.public_url}
            />

            {/* Metadata card */}
            <div className="card mt-4">
              <div className="card-header">Task Info</div>
              <div className="info-row"><span className="info-label">Task ID</span><span className="info-value font-mono">{task_id}</span></div>
              {(data.project ?? "").trim() && (
                <div className="info-row"><span className="info-label">Project</span><span className="info-value">{(data.project ?? "").trim()}</span></div>
              )}
              <div className="info-row"><span className="info-label">Platform</span><span className="info-value">{data.platform || "—"}</span></div>
              <div className="info-row"><span className="info-label">Flow type</span><span className="info-value">{data.flow_type || "—"}</span></div>
              <div className="info-row"><span className="info-label">Route</span><span className="info-value">{data.recommended_route || "—"}</span></div>
              <div className="info-row"><span className="info-label">Run ID</span><span className="info-value">{runId || "—"}</span></div>
              <div className="info-row"><span className="info-label">Risk</span><span className="info-value">{data.risk_score || "—"}</span></div>
              <div className="info-row"><span className="info-label">QC</span><span className="info-value">{data.qc_status || "—"}</span></div>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <CarouselEdits
              taskId={task_id}
              runId={runId || undefined}
              editedSlides={editedSlides}
              rawPayload={rawPayload ?? null}
              finalTitleOverride={editedTitle}
              onFinalTitleOverrideChange={setEditedTitle}
              finalHookOverride={editedHook}
              onFinalHookOverrideChange={setEditedHook}
              generatedCaption={editedCaption}
              onCaptionChange={setEditedCaption}
              finalHashtagsOverride={editedHashtags}
              onFinalHashtagsOverrideChange={setEditedHashtags}
              extraFields={{
                generated_title: (data.generated_title ?? "").trim(),
                generated_hook: (data.generated_hook ?? "").trim(),
              }}
              exportAtEnd
            />
            <DecisionPanel
              taskId={task_id}
              projectSlug={(data.project ?? projectFromUrl).trim() || undefined}
              onSuccess={() => router.push("/")}
              existingDecision={decision}
              existingNotes={notes}
              finalTitleOverride={editedTitle}
              finalHookOverride={editedHook}
              finalCaptionOverride={editedCaption}
              finalHashtagsOverride={editedHashtags}
              finalSlidesJsonOverride={finalSlidesJsonOverride}
              hasEdits={hasEdits}
              editsSummary={editsSummary}
            />
            <CarouselEditsExport
              taskId={task_id}
              runId={runId || undefined}
              editedSlides={editedSlides}
              rawPayload={rawPayload ?? null}
              finalTitleOverride={editedTitle}
              finalHookOverride={editedHook}
              generatedCaption={editedCaption}
              finalHashtagsOverride={editedHashtags}
              extraFields={{
                generated_title: (data.generated_title ?? "").trim(),
                generated_hook: (data.generated_hook ?? "").trim(),
              }}
            />
          </div>
        </div>
      )}
    </>
  );
}
