"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { TaskViewer } from "@/components/TaskViewer";
import { DecisionPanel } from "@/components/DecisionPanel";
import { CarouselEdits, CarouselEditsExport } from "@/components/CarouselEdits";
import { buildSlidesJson, createSyntheticSlides, parseSlidesFromJson } from "@/lib/carousel-slides";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import type { ReviewQueueRow } from "@/lib/types";
import { taskAssetsToPreviewRows, type TaskAssetPreview } from "@/lib/media-url";
import { decodeTaskIdParam } from "@/lib/task-id";
import { taskApiQuery } from "@/lib/task-links";
import { HeyGenReviewEdits } from "@/components/HeyGenReviewEdits";
import { isHeyGenReviewFlow } from "@/lib/heygen-review-flow";

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

export interface TaskReviewClientProps {
  taskIdParam: string;
  projectFromUrl: string;
}

export function TaskReviewClient({ taskIdParam, projectFromUrl }: TaskReviewClientProps) {
  const router = useRouter();
  const task_id = useMemo(() => decodeTaskIdParam(taskIdParam), [taskIdParam]);

  const [data, setData] = useState<ReviewQueueRow | null>(null);
  const [taskAssets, setTaskAssets] = useState<TaskAssetPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const execTaskId = (data?.task_id ?? "").trim() || task_id;

  const { slides: initialSlides, raw: rawPayload } = useMemo(
    () =>
      parseSlidesFromJson(
        (data?.final_slides_json_override ?? data?.generated_slides_json)?.trim() || undefined
      ),
    [data?.generated_slides_json, data?.final_slides_json_override]
  );

  const [editedSlides, setEditedSlides] = useState<NormalizedSlide[]>([]);
  const [editedCaption, setEditedCaption] = useState("");
  const [editedTitle, setEditedTitle] = useState("");
  const [editedHook, setEditedHook] = useState("");
  const [editedHashtags, setEditedHashtags] = useState("");
  const [editedScript, setEditedScript] = useState("");
  const [heygenAvatarId, setHeygenAvatarId] = useState("");
  const [heygenVoiceId, setHeygenVoiceId] = useState("");
  const [heygenForceRerender, setHeygenForceRerender] = useState(false);

  useEffect(() => {
    setEditedSlides([]);
    setTaskAssets([]);
    setEditedScript("");
    setHeygenAvatarId("");
    setHeygenVoiceId("");
    setHeygenForceRerender(false);
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
    setEditedScript((data.final_spoken_script_override ?? data.generated_spoken_script ?? "").trim());
    setHeygenAvatarId((data.heygen_avatar_id ?? "").trim());
    setHeygenVoiceId((data.heygen_voice_id ?? "").trim());
    setHeygenForceRerender(false);
  }, [data]);

  const fetchTask = useCallback(async () => {
    if (!task_id) return;
    setLoading(true);
    setError(null);
    try {
      const qs = taskApiQuery(task_id, projectFromUrl);
      const [taskRes, assetsRes] = await Promise.all([
        fetch(`/api/task?${qs}`),
        fetch(`/api/task/assets?${qs}`),
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

  const heygenWorkbench = useMemo(() => isHeyGenReviewFlow(data?.flow_type), [data?.flow_type]);

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
    if (heygenWorkbench) {
      const initialScript = (data.final_spoken_script_override ?? data.generated_spoken_script ?? "").trim();
      if (editedScript.trim() !== initialScript) summary.push("Spoken script");
      const initialAv = (data.heygen_avatar_id ?? "").trim();
      const initialVo = (data.heygen_voice_id ?? "").trim();
      if (heygenAvatarId.trim() !== initialAv) summary.push("HeyGen avatar id");
      if (heygenVoiceId.trim() !== initialVo) summary.push("HeyGen voice id");
      if (heygenForceRerender) summary.push("Force HeyGen re-render");
    }
    return { hasEdits: summary.length > 0, editsSummary: summary };
  }, [
    data,
    editedTitle,
    editedHook,
    editedCaption,
    editedHashtags,
    editedSlides,
    initialSlides,
    heygenWorkbench,
    editedScript,
    heygenAvatarId,
    heygenVoiceId,
    heygenForceRerender,
  ]);

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
              spokenScript={heygenWorkbench ? editedScript : undefined}
              onSpokenScriptChange={heygenWorkbench ? setEditedScript : undefined}
            />

            <div className="card mt-4">
              <div className="card-header">Task Info</div>
              <div className="info-row"><span className="info-label">Task ID</span><span className="info-value font-mono">{execTaskId}</span></div>
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
            {heygenWorkbench && (
              <HeyGenReviewEdits
                heygenAvatarId={heygenAvatarId}
                onHeygenAvatarIdChange={setHeygenAvatarId}
                heygenVoiceId={heygenVoiceId}
                onHeygenVoiceIdChange={setHeygenVoiceId}
                heygenForceRerender={heygenForceRerender}
                onHeygenForceRerenderChange={setHeygenForceRerender}
              />
            )}
            <CarouselEdits
              taskId={execTaskId}
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
              taskId={execTaskId}
              projectSlug={(data.project ?? projectFromUrl).trim() || undefined}
              onSuccess={() => router.push("/")}
              existingDecision={decision}
              existingNotes={notes}
              existingRewriteCopy={data.rewrite_copy !== "false"}
              finalTitleOverride={editedTitle}
              finalHookOverride={editedHook}
              finalCaptionOverride={editedCaption}
              finalHashtagsOverride={editedHashtags}
              finalSlidesJsonOverride={finalSlidesJsonOverride}
              includeHeyGenFields={heygenWorkbench}
              finalSpokenScriptOverride={heygenWorkbench ? editedScript : undefined}
              heygenAvatarId={heygenWorkbench ? heygenAvatarId : undefined}
              heygenVoiceId={heygenWorkbench ? heygenVoiceId : undefined}
              heygenForceRerender={heygenWorkbench ? heygenForceRerender : undefined}
              hasEdits={hasEdits}
              editsSummary={editsSummary}
            />
            <CarouselEditsExport
              taskId={execTaskId}
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
