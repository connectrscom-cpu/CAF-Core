/**
 * Minimal Apify REST client for running actors and fetching dataset items.
 * Requires APIFY_API_TOKEN in env (same token used by n8n Apify credentials).
 */

const APIFY_BASE = "https://api.apify.com/v2";

/** Apify Console — all actor runs (operator inspect link). */
export const APIFY_CONSOLE_RUNS_URL = "https://console.apify.com/actors/runs";

export function apifyConsoleRunUrl(runId: string): string {
  return `${APIFY_CONSOLE_RUNS_URL}/${encodeURIComponent(runId)}`;
}

export class ApifyError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly body?: string
  ) {
    super(message);
    this.name = "ApifyError";
  }
}

async function apifyFetch(
  token: string,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const sep = path.includes("?") ? "&" : "?";
  const url = `${APIFY_BASE}${path}${sep}token=${encodeURIComponent(token)}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  return res;
}

export interface ApifyRunResult {
  id: string;
  status: string;
  defaultDatasetId: string;
}

export async function abortApifyRun(token: string, runId: string): Promise<void> {
  const res = await apifyFetch(token, `/actor-runs/${encodeURIComponent(runId)}/abort`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApifyError(`Apify abort failed: HTTP ${res.status}`, res.status, body);
  }
}

const APIFY_TERMINAL_STATUSES = ["SUCCEEDED", "FAILED", "ABORTED", "TIMED-OUT"] as const;

export async function runApifyActor(
  token: string,
  actorId: string,
  input: Record<string, unknown>,
  opts?: {
    waitForFinishSec?: number;
    /** Hard ceiling for polling (defaults to max(wait, 3600)). */
    maxWaitSec?: number;
    shouldAbort?: () => boolean;
    onRunStarted?: (run: ApifyRunResult) => void;
  }
): Promise<ApifyRunResult> {
  const wait = opts?.waitForFinishSec ?? 300;
  const res = await apifyFetch(token, `/acts/${encodeURIComponent(actorId)}/runs`, {
    method: "POST",
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new ApifyError(`Apify run failed: HTTP ${res.status}`, res.status, body);
  }
  const data = (await res.json()) as { data?: ApifyRunResult };
  const run = data.data;
  if (!run?.id) throw new ApifyError("Apify run response missing id");
  opts?.onRunStarted?.(run);

  if (wait <= 0) return run;

  const maxWait = opts?.maxWaitSec ?? Math.max(wait, 3600);
  const deadline = Date.now() + maxWait * 1000;
  let current = run;
  while (Date.now() < deadline) {
    if (opts?.shouldAbort?.()) {
      try {
        await abortApifyRun(token, current.id);
      } catch {
        /* best-effort */
      }
      throw new ApifyError("Apify run aborted by operator", undefined, current.id);
    }
    if (APIFY_TERMINAL_STATUSES.includes(current.status as (typeof APIFY_TERMINAL_STATUSES)[number])) {
      break;
    }
    await sleep(3000);
    current = await getApifyRun(token, current.id);
  }
  if (current.status !== "SUCCEEDED") {
    throw new ApifyError(`Apify run ended with status ${current.status}`, undefined, current.id);
  }
  return current;
}

export async function getApifyRun(token: string, runId: string): Promise<ApifyRunResult> {
  const res = await apifyFetch(token, `/actor-runs/${encodeURIComponent(runId)}`);
  if (!res.ok) {
    const body = await res.text();
    throw new ApifyError(`Apify get run failed: HTTP ${res.status}`, res.status, body);
  }
  const data = (await res.json()) as { data?: ApifyRunResult };
  if (!data.data?.id) throw new ApifyError("Apify run not found");
  return data.data;
}

const APIFY_DATASET_PAGE_SIZE = 1000;

export async function getApifyDatasetItems<T = Record<string, unknown>>(
  token: string,
  datasetId: string,
  opts?: { limit?: number; offset?: number }
): Promise<T[]> {
  const limit = opts?.limit ?? 1000;
  const offset = opts?.offset ?? 0;
  const res = await apifyFetch(
    token,
    `/datasets/${encodeURIComponent(datasetId)}/items?limit=${limit}&offset=${offset}&format=json`
  );
  if (!res.ok) {
    const body = await res.text();
    throw new ApifyError(`Apify dataset fetch failed: HTTP ${res.status}`, res.status, body);
  }
  const items = (await res.json()) as T[];
  return Array.isArray(items) ? items : [];
}

/** Fetch dataset items with offset pagination up to `maxItems`. */
export async function getAllApifyDatasetItems<T = Record<string, unknown>>(
  token: string,
  datasetId: string,
  opts?: { maxItems?: number }
): Promise<T[]> {
  const maxItems = Math.min(Math.max(opts?.maxItems ?? 20_000, 1), 20_000);
  const out: T[] = [];
  let offset = 0;
  while (out.length < maxItems) {
    const pageSize = Math.min(APIFY_DATASET_PAGE_SIZE, maxItems - out.length);
    const page = await getApifyDatasetItems<T>(token, datasetId, {
      limit: pageSize,
      offset,
    });
    if (page.length === 0) break;
    out.push(...page);
    if (page.length < pageSize) break;
    offset += page.length;
  }
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function hasApifyToken(token: string | undefined | null): boolean {
  return Boolean(token?.trim());
}
