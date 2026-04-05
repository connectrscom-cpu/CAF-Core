"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { TaskViewer } from "@/components/TaskViewer";
import { DecisionPanel } from "@/components/DecisionPanel";
import { CarouselEdits, CarouselEditsExport } from "@/components/CarouselEdits";
import { buildSlidesJson, createSyntheticSlides, parseSlidesFromJson } from "@/lib/carousel-slides";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import type { ReviewQueueRow } from "@/lib/types";

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
  assets: { position: number; public_url: string }[];
}

export default function TaskPage() {
  const params = useParams();
  const router = useRouter();
  const task_id = typeof params.task_id === "string" ? params.task_id : "";

  const [data, setData] = useState<ReviewQueueRow | null>(null);
  const [assetUrls, setAssetUrls] = useState<string[]>([]);
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

  useEffect(() => { setEditedSlides([]); }, [task_id]);

  useEffect(() => {
    if (initialSlides.length > 0) {
      setEditedSlides(initialSlides);
      return;
    }
    if (assetUrls.length > 0) {
      setEditedSlides((prev) =>
        prev.length !== assetUrls.length ? createSyntheticSlides(assetUrls.length) : prev
      );
    }
  }, [initialSlides, initialSlides.length, assetUrls.length]);

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
      const [taskRes, assetsRes] = await Promise.all([
        fetch(`/api/task/${encodeURIComponent(task_id)}`),
        fetch(`/api/task/${encodeURIComponent(task_id)}/assets`),
      ]);
      if (taskRes.status === 404) {
        setError("Task not found");
        setData(null);
        setAssetUrls([]);
        return;
      }
      if (!taskRes.ok) throw new Error(await taskRes.text());
      const taskJson: TaskDetailResponse = await taskRes.json();
      setData(taskJson.data);
      if (assetsRes.ok) {
        const assetsJson: AssetsResponse = await assetsRes.json();
        setAssetUrls(
          (assetsJson.assets ?? [])
            .sort((a, b) => a.position - b.position)
            .map((a) => a.public_url)
            .filter(Boolean) as string[]
        );
      } else {
        setAssetUrls([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load task");
      setData(null);
      setAssetUrls([]);
    } finally {
      setLoading(false);
    }
  }, [task_id]);

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
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Workbench
          </Link>
          {runId && (
            <Link
              href={`/r/${encodeURIComponent(runId)}`}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Run: {runId}
            </Link>
          )}
          <h1 className="min-w-0 truncate text-base font-semibold text-card-foreground sm:text-lg">
            {task_id}
          </h1>
        </div>
      </header>

      <main className="p-4 sm:p-6">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            {error}
          </div>
        )}
        {loading && !data && <div className="text-muted-foreground">Loading…</div>}

        {data && !loading && (
          <div className="grid gap-6 lg:grid-cols-[1fr,340px] lg:gap-8">
            <div className="min-w-0">
              <TaskViewer
                data={data}
                assetUrls={assetUrls}
                editedSlides={editedSlides.length > 0 ? editedSlides : undefined}
                onSlidesChange={setEditedSlides}
                fallbackPreviewUrl={assetUrls?.[0]}
              />
            </div>
            <div className="flex min-w-0 flex-col gap-6">
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
      </main>
    </div>
  );
}
