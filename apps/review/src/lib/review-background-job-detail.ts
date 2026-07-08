import type { ReviewBackgroundJob, ReviewBackgroundJobKind } from "@/lib/review-background-jobs";
import { slideIndicesLabel } from "@/lib/review-background-jobs";

export type ReviewBackgroundJobStepStatus = "done" | "active" | "pending" | "failed";

export type ReviewBackgroundJobStep = {
  id: string;
  label: string;
  status: ReviewBackgroundJobStepStatus;
  hint?: string;
};

export type ReviewBackgroundJobFact = {
  label: string;
  value: string;
};

export type ReviewBackgroundJobDetail = {
  updatedAt: string;
  headline: string;
  progressLabel: string | null;
  progressDone: number | null;
  progressTotal: number | null;
  steps: ReviewBackgroundJobStep[];
  facts: ReviewBackgroundJobFact[];
  error: string | null;
};

function formatElapsed(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const rem = sec % 60;
  return rem > 0 ? `${min}m ${rem}s` : `${min}m`;
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? d.toLocaleString() : iso;
}

function countUpdatedAssetSlides(
  baseline: Record<number, string>,
  current: Record<number, string>,
  slideIndices?: number[]
): { updated: number; total: number } {
  const positions =
    slideIndices && slideIndices.length > 0
      ? slideIndices.map((i) => i - 1)
      : [...new Set([...Object.keys(baseline), ...Object.keys(current)].map((k) => Number(k)))].filter(
          (n) => Number.isFinite(n)
        );
  positions.sort((a, b) => a - b);
  let updated = 0;
  for (const pos of positions) {
    const next = current[pos] ?? "";
    const prev = baseline[pos] ?? "";
    if (next && next !== prev) updated += 1;
  }
  return { updated, total: positions.length };
}

function parseSlideIndicesFromLabel(label: string | null | undefined): number[] | undefined {
  if (!label || label === "all") return undefined;
  return label
    .split(/[,\s]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 1);
}

type ReprintPollState = {
  active: boolean;
  failed: boolean;
  status: string | null;
  error: string | null;
  requested_at: string | null;
  completed_at: string | null;
  slide_indices: string | null;
  slide_index?: number | null;
  slide_total?: number | null;
};

type RegenPollState = {
  active: boolean;
  failed: boolean;
  status: string | null;
  error: string | null;
  done: number;
  total: number;
};

export function buildReviewBackgroundJobDetail(input: {
  job: ReviewBackgroundJob;
  reprintState?: ReprintPollState | null;
  regenState?: RegenPollState | null;
  currentAssetUrls?: Record<number, string>;
}): ReviewBackgroundJobDetail {
  const { job, reprintState, regenState, currentAssetUrls = {} } = input;
  const startedMs = Date.parse(job.startedAt);
  const elapsed = Number.isFinite(startedMs) ? formatElapsed(Date.now() - startedMs) : "—";
  const scope = slideIndicesLabel(job.slideIndices);
  const baseline = job.baselineAssetUrls ?? {};
  const assetProgress = countUpdatedAssetSlides(baseline, currentAssetUrls, job.slideIndices);
  const facts: ReviewBackgroundJobFact[] = [
    { label: "Task", value: job.taskId },
    { label: "Scope", value: scope },
    { label: "Elapsed", value: elapsed },
  ];

  if (job.kind === "text_reprint" && reprintState) {
    if (reprintState.requested_at) {
      facts.push({ label: "Queued at", value: formatWhen(reprintState.requested_at) });
    }
    if (reprintState.completed_at) {
      facts.push({ label: "Completed at", value: formatWhen(reprintState.completed_at) });
    }
    if (reprintState.status) {
      facts.push({ label: "Core status", value: reprintState.status });
    }
    facts.push({ label: "Pipeline", value: "HTML text overlay → Puppeteer renderer → carousel slide PNGs" });

    const reprintRunning =
      reprintState.active ||
      reprintState.failed ||
      assetProgress.updated > 0 ||
      (reprintState.slide_index != null && reprintState.slide_total != null);

    const steps: ReviewBackgroundJobStep[] = [
      {
        id: "queue",
        label: "Queue reprint on Core",
        status: reprintState.requested_at || reprintRunning ? "done" : job.status === "pending" ? "active" : "pending",
        hint: "Persists layout, then runs text-overlay reprint without Flux.",
      },
      {
        id: "render",
        label: "Bake copy onto stored background plates",
        status: reprintState.failed
          ? "failed"
          : reprintState.active || assetProgress.updated > 0
            ? "active"
            : reprintState.completed_at
              ? "done"
              : "pending",
        hint: "One slide at a time via carousel renderer (Puppeteer). Logo/frame applied last.",
      },
      {
        id: "upload",
        label: "Upload updated slide images",
        status: reprintState.failed
          ? "failed"
          : assetProgress.total > 0 && assetProgress.updated >= assetProgress.total
            ? "done"
            : reprintState.active && assetProgress.updated > 0
              ? "active"
              : reprintState.completed_at
                ? "done"
                : "pending",
        hint:
          assetProgress.total > 0
            ? `${assetProgress.updated}/${assetProgress.total} slide assets changed in storage`
            : "Watching carousel_slide assets for new URLs",
      },
      {
        id: "preview",
        label: "Refresh workbench preview",
        status: job.status === "done" ? "done" : reprintState.completed_at ? "active" : "pending",
        hint: "Carousel thumbnails update when assets finish uploading.",
      },
    ];

    let progressLabel: string | null = null;
    let progressDone: number | null = null;
    let progressTotal: number | null = null;
    let headline = "Text reprint running";

    if (job.status === "done") {
      headline = "Text reprint finished";
      progressLabel = "All targeted slides updated.";
    } else if (reprintState.failed) {
      headline = "Text reprint failed";
      progressLabel = reprintState.error ?? "Renderer or worker error.";
    } else if (reprintState.active || assetProgress.updated > 0) {
      if (reprintState.slide_index != null && reprintState.slide_total != null) {
        progressDone = Math.max(0, reprintState.slide_index - 1);
        progressTotal = reprintState.slide_total;
        progressLabel = `Rendering slide ${reprintState.slide_index} of ${reprintState.slide_total} (${elapsed})`;
      } else if (assetProgress.total > 0) {
        progressDone = assetProgress.updated;
        progressTotal = assetProgress.total;
        progressLabel = `Baking text onto slides — ${assetProgress.updated} of ${assetProgress.total} asset(s) updated`;
      } else {
        progressLabel = `Compositor running (${elapsed}) — waiting for slide assets`;
      }
    } else if (!reprintState.requested_at) {
      headline = "Starting text reprint";
      progressLabel = "Sending layout to Core and starting Puppeteer compositor…";
    }

    return {
      updatedAt: new Date().toISOString(),
      headline,
      progressLabel,
      progressDone,
      progressTotal,
      steps,
      facts,
      error: reprintState.error,
    };
  }

  if (job.kind === "image_regenerate" && regenState) {
    if (regenState.status) facts.push({ label: "Core status", value: regenState.status });
    facts.push({ label: "Pipeline", value: "Flux/Qwen image model → new background plates per slide" });

    const steps: ReviewBackgroundJobStep[] = [
      {
        id: "queue",
        label: "Queue image regenerate",
        status: regenState.active || regenState.failed || job.status === "done" ? "done" : "active",
      },
      {
        id: "flux",
        label: "Generate new slide images (billed)",
        status: regenState.failed ? "failed" : regenState.active ? "active" : job.status === "done" ? "done" : "pending",
        hint:
          regenState.total > 0
            ? `${regenState.done}/${regenState.total} slides complete on Core`
            : "Watching render_state.carousel_regenerate",
      },
      {
        id: "upload",
        label: "Store new carousel assets",
        status: regenState.failed
          ? "failed"
          : assetProgress.total > 0 && assetProgress.updated >= assetProgress.total
            ? "done"
            : regenState.active
              ? "active"
              : job.status === "done"
                ? "done"
                : "pending",
        hint:
          assetProgress.total > 0
            ? `${assetProgress.updated}/${assetProgress.total} slide URLs changed`
            : undefined,
      },
    ];

    let progressLabel: string | null = null;
    let progressDone: number | null = regenState.total > 0 ? regenState.done : null;
    let progressTotal: number | null = regenState.total > 0 ? regenState.total : null;
    let headline = "Image regenerate running";

    if (job.status === "done") {
      headline = "Image regenerate finished";
      progressLabel =
        regenState.total > 0
          ? `${regenState.done}/${regenState.total} slides updated.`
          : "New images are ready.";
    } else if (regenState.failed) {
      headline = "Image regenerate failed";
      progressLabel = regenState.error ?? "Image model or renderer error.";
    } else if (regenState.active && regenState.total > 0) {
      progressLabel = `Generating images — ${regenState.done}/${regenState.total} slides on Core`;
    } else if (assetProgress.total > 0 && assetProgress.updated > 0) {
      progressDone = assetProgress.updated;
      progressTotal = assetProgress.total;
      progressLabel = `New images landing — ${assetProgress.updated}/${assetProgress.total} assets updated`;
    }

    return {
      updatedAt: new Date().toISOString(),
      headline,
      progressLabel,
      progressDone,
      progressTotal,
      steps,
      facts,
      error: regenState.error,
    };
  }

  return {
    updatedAt: new Date().toISOString(),
    headline: job.status === "done" ? "Finished" : job.status === "failed" ? "Failed" : "Running",
    progressLabel: job.message ?? null,
    progressDone: null,
    progressTotal: null,
    steps: [],
    facts,
    error: null,
  };
}

export function kindPipelineLabel(kind: ReviewBackgroundJobKind): string {
  return kind === "text_reprint"
    ? "Text overlay reprint (HTML → PNG, no Flux)"
    : "Image regenerate (Flux/Qwen)";
}

export function parseReprintSlideIndices(slideRaw: string | null | undefined): number[] | undefined {
  return parseSlideIndicesFromLabel(slideRaw);
}
