"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { TaskViewer } from "@/components/TaskViewer";
import { createSyntheticSlides, parseSlidesFromJson } from "@/lib/carousel-slides";
import type { NormalizedSlide } from "@/lib/carousel-slides";
import type { ReviewQueueRow } from "@/lib/types";

interface ContentResponse {
  data: ReviewQueueRow;
}

interface AssetsResponse {
  assets: { position: number; public_url: string }[];
}

export default function ContentPage() {
  const params = useParams();
  const task_id = typeof params.task_id === "string" ? params.task_id : "";

  const [data, setData] = useState<ReviewQueueRow | null>(null);
  const [assetUrls, setAssetUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const { slides: initialSlides } = useMemo(
    () => parseSlidesFromJson(data?.generated_slides_json?.trim() || undefined),
    [data?.generated_slides_json]
  );

  const [editedSlides, setEditedSlides] = useState<NormalizedSlide[]>([]);

  useEffect(() => {
    if (initialSlides.length > 0) {
      setEditedSlides((prev) =>
        prev.length !== initialSlides.length ? initialSlides : prev
      );
      return;
    }
    const imageUrls = assetUrls.filter((u) => /\.(png|jpg|jpeg|gif|webp|avif)(\?|$)/i.test(u));
    const videoUrls = assetUrls.filter((u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u));
    if (videoUrls.length > 0) return;
    if (imageUrls.length > 1) {
      setEditedSlides((prev) =>
        prev.length !== imageUrls.length ? createSyntheticSlides(imageUrls.length) : prev
      );
    }
  }, [initialSlides, initialSlides.length, assetUrls]);

  const fetchContent = useCallback(async () => {
    if (!task_id) return;
    setLoading(true);
    setError(null);
    try {
      const [contentRes, assetsRes] = await Promise.all([
        fetch(`/api/content/${encodeURIComponent(task_id)}`),
        fetch(`/api/task/${encodeURIComponent(task_id)}/assets`),
      ]);
      if (contentRes.status === 404) {
        setError("Content not found");
        setData(null);
        setAssetUrls([]);
        return;
      }
      if (!contentRes.ok) throw new Error(await contentRes.text());
      const contentJson: ContentResponse = await contentRes.json();
      setData(contentJson.data);
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
      setError(e instanceof Error ? e.message : "Failed to load content");
      setData(null);
      setAssetUrls([]);
    } finally {
      setLoading(false);
    }
  }, [task_id]);

  useEffect(() => { fetchContent(); }, [fetchContent]);

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card px-4 py-3 sm:px-6 sm:py-4">
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Workbench
          </Link>
          <h1 className="min-w-0 truncate text-base font-semibold text-card-foreground sm:text-lg">
            Content: {task_id}
          </h1>
        </div>
      </header>
      <main className="p-4 sm:p-6">
        {error && (
          <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">{error}</div>
        )}
        {loading && !data && <div className="text-muted-foreground">Loading…</div>}
        {data && !loading && (
          <div className="w-full max-w-4xl">
            <TaskViewer
              data={data}
              assetUrls={assetUrls}
              editedSlides={editedSlides.length > 0 ? editedSlides : undefined}
              fallbackPreviewUrl={assetUrls?.[0]}
              readOnly
            />
          </div>
        )}
      </main>
    </div>
  );
}
