import { RenderNotReadyError } from "../domain/render-not-ready-error.js";

export type RenderActivityKind = "carousel" | "video" | "image" | "mimic_plate" | "text_overlay";

export interface RenderActivity {
  task_id: string;
  run_id: string;
  project_slug?: string;
  flow_type: string;
  kind: RenderActivityKind;
  phase: string;
  slide_index?: number;
  slide_total?: number;
  started_at: string;
  updated_at: string;
}

export interface RenderControlSnapshot {
  paused: boolean;
  paused_at: string | null;
  active: RenderActivity[];
}

const PAUSE_MESSAGE =
  "Rendering paused by operator — resume from System → Rendering health, then re-process or render the run.";

let paused = false;
let pausedAt: string | null = null;
const active = new Map<string, RenderActivity>();

export function isRenderingPaused(): boolean {
  return paused;
}

export function pauseRendering(): RenderControlSnapshot {
  paused = true;
  pausedAt = new Date().toISOString();
  return getRenderControlSnapshot();
}

export function resumeRendering(): RenderControlSnapshot {
  paused = false;
  pausedAt = null;
  return getRenderControlSnapshot();
}

export function getRenderControlSnapshot(): RenderControlSnapshot {
  return {
    paused,
    paused_at: pausedAt,
    active: [...active.values()].sort((a, b) => a.started_at.localeCompare(b.started_at)),
  };
}

/** Throws RenderNotReadyError so jobs stay in RENDERING and can be retried after resume. */
export function assertRenderNotPaused(): void {
  if (paused) {
    throw new RenderNotReadyError(PAUSE_MESSAGE);
  }
}

export function beginRenderActivity(entry: Omit<RenderActivity, "started_at" | "updated_at">): void {
  const now = new Date().toISOString();
  active.set(entry.task_id, {
    ...entry,
    started_at: now,
    updated_at: now,
  });
}

export function updateRenderActivity(
  taskId: string,
  patch: Partial<Pick<RenderActivity, "phase" | "slide_index" | "slide_total" | "kind">>
): void {
  const cur = active.get(taskId);
  if (!cur) return;
  active.set(taskId, {
    ...cur,
    ...patch,
    updated_at: new Date().toISOString(),
  });
}

export function endRenderActivity(taskId: string): void {
  active.delete(taskId);
}

export async function withRenderActivity<T>(
  entry: Omit<RenderActivity, "started_at" | "updated_at">,
  fn: () => Promise<T>
): Promise<T> {
  assertRenderNotPaused();
  beginRenderActivity(entry);
  try {
    return await fn();
  } finally {
    endRenderActivity(entry.task_id);
  }
}
