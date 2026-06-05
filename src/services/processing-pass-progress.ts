/**
 * In-memory progress log for long-running inputs processing passes (admin UI polling).
 * Entries expire after TTL — not persisted across restarts.
 */

export type ProcessingPassProgressLine = {
  at: string;
  message: string;
  stage?: string;
};

export type ProcessingPassProgressSnapshot = {
  pass: string;
  started_at: string;
  finished_at: string | null;
  ok: boolean | null;
  lines: ProcessingPassProgressLine[];
};

const TTL_MS = 60 * 60 * 1000;
const MAX_LINES = 200;

type StoreEntry = ProcessingPassProgressSnapshot & { expires_at: number };

const store = new Map<string, StoreEntry>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [id, entry] of store) {
    if (entry.expires_at <= now) store.delete(id);
  }
}

export function beginProcessingPassProgress(progressId: string, pass: string): void {
  pruneExpired();
  const now = new Date().toISOString();
  store.set(progressId, {
    pass,
    started_at: now,
    finished_at: null,
    ok: null,
    lines: [],
    expires_at: Date.now() + TTL_MS,
  });
}

export function appendProcessingPassProgress(
  progressId: string,
  message: string,
  stage?: string
): void {
  const entry = store.get(progressId);
  if (!entry) return;
  entry.expires_at = Date.now() + TTL_MS;
  entry.lines.push({
    at: new Date().toISOString(),
    message,
    ...(stage ? { stage } : {}),
  });
  if (entry.lines.length > MAX_LINES) {
    entry.lines.splice(0, entry.lines.length - MAX_LINES);
  }
}

export function finishProcessingPassProgress(progressId: string, ok: boolean): void {
  const entry = store.get(progressId);
  if (!entry) return;
  entry.finished_at = new Date().toISOString();
  entry.ok = ok;
  entry.expires_at = Date.now() + TTL_MS;
}

export function getProcessingPassProgress(progressId: string): ProcessingPassProgressSnapshot | null {
  pruneExpired();
  const entry = store.get(progressId);
  if (!entry) return null;
  const { expires_at: _e, ...snap } = entry;
  return snap;
}
