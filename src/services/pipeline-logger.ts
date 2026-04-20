/**
 * Pipeline logger.
 *
 * CAF Core today logs via scattered `console.warn` / `console.error` calls with
 * ad-hoc prefixes like `[job-pipeline]`. That is enough when staring at one
 * container, but it makes correlating a single job's journey across generate →
 * QC → render → review difficult without reading the DB.
 *
 * This module is a **tiny, opt-in** replacement. It writes a single JSON line
 * per event to `stderr` with a stable shape. Nothing is forced: existing
 * `console.*` call sites keep working, and new code (or code you happen to be
 * editing) can adopt this helper for events that benefit from correlation
 * (`run_id`, `task_id`, `job_id`, `stage`).
 *
 * Why stderr-only JSON lines (and not pino/winston):
 *   - zero dependencies
 *   - already structured for container log collectors
 *   - trivial to grep/jq locally
 *   - easy to replace with a real logger later without changing call sites
 */

export type PipelineLogLevel = "debug" | "info" | "warn" | "error";

export type PipelineStage =
  | "plan"
  | "generate"
  | "qc"
  | "diagnostic"
  | "render"
  | "review"
  | "publish"
  | "learn"
  | "other";

export interface PipelineLogContext {
  project_id?: string | null;
  project_slug?: string | null;
  run_id?: string | null;
  task_id?: string | null;
  job_id?: string | null;
  flow_type?: string | null;
  /** Free-form additional fields. Stringified verbatim; keep it small. */
  data?: Record<string, unknown>;
}

export interface PipelineLogEvent extends PipelineLogContext {
  ts: string;
  level: PipelineLogLevel;
  stage: PipelineStage;
  message: string;
}

/**
 * Swap this out for tests that don't want lines on stderr.
 * The default is `process.stderr.write`.
 */
export interface PipelineLogSink {
  (line: string): void;
}

let activeSink: PipelineLogSink = (line) => {
  // Avoid `console.*` so Fastify / Vitest output is not mixed with our JSON.
  process.stderr.write(line);
};

/** Replace the sink (useful in tests). Returns the previous sink. */
export function setPipelineLogSink(sink: PipelineLogSink): PipelineLogSink {
  const prev = activeSink;
  activeSink = sink;
  return prev;
}

/**
 * Build a structured pipeline-log event without writing it. Exposed so
 * callers who want to log through a different transport (or assert in a
 * test) can still get the canonical shape.
 */
export function buildPipelineLogEvent(
  level: PipelineLogLevel,
  stage: PipelineStage,
  message: string,
  ctx?: PipelineLogContext
): PipelineLogEvent {
  return {
    ts: new Date().toISOString(),
    level,
    stage,
    message,
    ...(ctx ?? {}),
  };
}

/** Emit a single JSON line to the active sink. Never throws. */
export function logPipelineEvent(
  level: PipelineLogLevel,
  stage: PipelineStage,
  message: string,
  ctx?: PipelineLogContext
): void {
  try {
    const evt = buildPipelineLogEvent(level, stage, message, ctx);
    activeSink(JSON.stringify(evt) + "\n");
  } catch {
    // Logging must never break the pipeline.
  }
}
