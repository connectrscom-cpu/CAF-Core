"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { TaskViewer } from "@/components/TaskViewer";
import { createSyntheticSlides, parseSlidesFromJson } from "@/lib/carousel-slides";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import type { ReviewQueueRow } from "@/lib/types";
import { taskAssetsToPreviewRows, type TaskAssetPreview } from "@/lib/media-url";
import { decodeTaskIdParam } from "@/lib/task-id";
import { taskApiQuery } from "@/lib/task-links";

interface ContentResponse {
  data: ReviewQueueRow;
}

interface AssetsResponse {
  assets: { position: number; public_url: string | null; asset_type: string | null }[];
}

export interface ContentReviewClientProps {
  taskIdParam: string;
  projectFromUrl: string;
}

export function ContentReviewClient({ taskIdParam, projectFromUrl }: ContentReviewClientProps) {
  const task_id = useMemo(() => decodeTaskIdParam(taskIdParam), [taskIdParam]);

  const [data, setData] = useState<ReviewQueueRow | null>(null);
  const [taskAssets, setTaskAssets] = useState<TaskAssetPreview[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { slides: initialSlides } = useMemo(
    () => parseSlidesFromJson(data?.generated_slides_json?.trim() || undefined),
    [data?.generated_slides_json]
  );

  const [editedSlides, setEditedSlides] = useState<NormalizedSlide[]>([]);

  useEffect(() => {
    if (initialSlides.length > 0) {
      setEditedSlides((prev) => (prev.length !== initialSlides.length ? initialSlides : prev));
      return;
    }
    if (taskAssets.length > 1) {
      setEditedSlides((prev) =>
        prev.length !== taskAssets.length ? createSyntheticSlides(taskAssets.length) : prev
      );
    }
  }, [initialSlides, initialSlides.length, taskAssets.length]);

  const fetchContent = useCallback(async () => {
    if (!task_id) return;
    setLoading(true);
    setError(null);
    try {
      const qs = taskApiQuery(task_id, projectFromUrl);
      const [contentRes, assetsRes] = await Promise.all([
        fetch(`/api/content?${qs}`),
        fetch(`/api/task/assets?${qs}`),
      ]);
      if (contentRes.status === 404) {
        setError("Content not found");
        setData(null);
        setTaskAssets([]);
        return;
      }
      if (!contentRes.ok) throw new Error(await contentRes.text());
      const contentJson: ContentResponse = await contentRes.json();
      setData(contentJson.data);
      if (assetsRes.ok) {
        const assetsJson: AssetsResponse = await assetsRes.json();
        const rows = [...(assetsJson.assets ?? [])].sort((a, b) => a.position - b.position);
        const flowHint = (contentJson.data?.flow_type ?? "").trim();
        setTaskAssets(taskAssetsToPreviewRows(rows, { flowTypeHint: flowHint }));
      } else {
        setTaskAssets([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load content");
      setData(null);
      setTaskAssets([]);
    } finally {
      setLoading(false);
    }
  }, [task_id, projectFromUrl]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  return (
    <>
      <div className="detail-back">
        <Link href="/">← Back to Workbench</Link>
      </div>
      <h1 className="detail-title">Content: {task_id}</h1>
      <p className="detail-subtitle">
        {data?.platform && <>{data.platform} · </>}
        {data?.flow_type && <>{data.flow_type}</>}
      </p>

      {error && (
        <div style={{ margin: "0 28px 16px", padding: 12, background: "var(--red-bg)", color: "var(--red)", borderRadius: 8, fontSize: 13 }}>
          {error}
        </div>
      )}
      {loading && !data && <div style={{ padding: 28, color: "var(--muted)" }}>Loading…</div>}

      {data && !loading && (
        <div style={{ padding: "20px 28px 28px", maxWidth: 900 }}>
          <TaskViewer
            data={data}
            taskAssets={taskAssets}
            editedSlides={editedSlides.length > 0 ? editedSlides : undefined}
            fallbackPreviewUrl={taskAssets[0]?.public_url}
            readOnly
          />
        </div>
      )}
    </>
  );
}
