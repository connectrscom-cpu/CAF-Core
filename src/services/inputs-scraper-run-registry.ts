/**
 * In-process registry for active INPUTS scraper runs (abort + Apify run tracking).
 * Single Fly machine: sufficient for operator abort from Admin.
 */

export class ScraperRunAbortedError extends Error {
  constructor(message = "Scraper run aborted") {
    super(message);
    this.name = "ScraperRunAbortedError";
  }
}

interface ActiveScraperRun {
  projectId: string;
  runId: string;
  aborted: boolean;
  apifyRunIds: string[];
}

const active = new Map<string, ActiveScraperRun>();

function key(projectId: string, runId: string): string {
  return `${projectId}:${runId}`;
}

export function registerScraperRun(projectId: string, runId: string): void {
  active.set(key(projectId, runId), {
    projectId,
    runId,
    aborted: false,
    apifyRunIds: [],
  });
}

export function trackApifyRun(projectId: string, runId: string, apifyRunId: string): void {
  const row = active.get(key(projectId, runId));
  if (!row || !apifyRunId) return;
  if (!row.apifyRunIds.includes(apifyRunId)) row.apifyRunIds.push(apifyRunId);
}

export function isScraperRunAborted(projectId: string, runId: string): boolean {
  return active.get(key(projectId, runId))?.aborted === true;
}

export function assertScraperRunNotAborted(projectId: string, runId: string): void {
  if (isScraperRunAborted(projectId, runId)) {
    throw new ScraperRunAbortedError();
  }
}

/** Mark aborted and return Apify run ids to stop on Apify. */
export function requestScraperRunAbort(projectId: string, runId: string): string[] {
  const row = active.get(key(projectId, runId));
  if (!row) return [];
  row.aborted = true;
  return [...row.apifyRunIds];
}

export function clearScraperRun(projectId: string, runId: string): void {
  active.delete(key(projectId, runId));
}

export function isScraperRunActive(projectId: string, runId: string): boolean {
  return active.has(key(projectId, runId));
}
