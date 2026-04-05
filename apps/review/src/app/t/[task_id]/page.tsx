"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { DecisionPanel } from "@/components/DecisionPanel";
import type { ReviewQueueRow } from "@/lib/types";

interface TaskDetailResponse {
  rowIndex: number;
  data: ReviewQueueRow;
}

interface AssetsResponse {
  assets: { position: number; public_url: string }[];
}

function InfoRow({ label, value }: { label: string; value: string | undefined }) {
  if (!value) return null;
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}

export default function TaskPage() {
  const params = useParams();
  const router = useRouter();
  const task_id = typeof params.task_id === "string" ? params.task_id : "";

  const [data, setData] = useState<ReviewQueueRow | null>(null);
  const [assetUrls, setAssetUrls] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load task");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [task_id]);

  useEffect(() => {
    fetchTask();
  }, [fetchTask]);

  const decision = (data?.decision ?? "").trim();
  const notes = (data?.notes ?? "").trim();
  const runId = (data?.run_id ?? "").trim();

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
            <div className="min-w-0 space-y-4">
              {assetUrls.length > 0 && (
                <div className="space-y-4 rounded-lg border bg-muted/30 p-4">
                  <p className="text-sm font-medium">Assets</p>
                  <div className="flex flex-col gap-4 overflow-auto max-h-[70vh]">
                    {assetUrls.map((url, i) => (
                      <img
                        key={i}
                        src={url}
                        alt={`Asset ${i + 1}`}
                        className="max-h-[500px] w-auto rounded border object-contain"
                      />
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-lg border bg-card p-4 space-y-3">
                <h2 className="text-sm font-semibold">Task Details</h2>
                <InfoRow label="Task ID" value={data.task_id} />
                <InfoRow label="Run ID" value={data.run_id} />
                <InfoRow label="Platform" value={data.platform} />
                <InfoRow label="Flow Type" value={data.flow_type} />
                <InfoRow label="Recommended Route" value={data.recommended_route} />
                <InfoRow label="QC Status" value={data.qc_status} />
                <InfoRow label="Risk Score" value={data.risk_score} />
                <InfoRow label="Review Status" value={data.review_status} />
              </div>

              {data.generated_title && (
                <div className="rounded-lg border bg-card p-4 space-y-2">
                  <h2 className="text-sm font-semibold">Generated Content</h2>
                  {data.generated_title && (
                    <div>
                      <p className="text-xs text-muted-foreground">Title</p>
                      <p className="text-sm">{data.generated_title}</p>
                    </div>
                  )}
                  {data.generated_hook && (
                    <div>
                      <p className="text-xs text-muted-foreground">Hook</p>
                      <p className="text-sm">{data.generated_hook}</p>
                    </div>
                  )}
                  {data.generated_caption && (
                    <div>
                      <p className="text-xs text-muted-foreground">Caption</p>
                      <p className="text-sm whitespace-pre-wrap">{data.generated_caption}</p>
                    </div>
                  )}
                </div>
              )}

              {data.generated_slides_json && (
                <div className="rounded-lg border bg-card p-4 space-y-2">
                  <h2 className="text-sm font-semibold">Slides JSON</h2>
                  <pre className="max-h-[30vh] overflow-auto whitespace-pre-wrap rounded bg-background p-3 text-xs">
                    {data.generated_slides_json}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex min-w-0 flex-col gap-6">
              <DecisionPanel
                taskId={task_id}
                onSuccess={() => router.push("/")}
                existingDecision={decision}
                existingNotes={notes}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
