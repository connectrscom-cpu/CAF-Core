/**
 * Thin client helpers for the local `services/video-assembly` Node service (ffmpeg wrapper).
 *
 * Extracted from scene-pipeline.ts so other callers (e.g. heygen-renderer.ts post-render subtitle burn)
 * can reuse the same async-poll pattern without creating a circular import via scene-pipeline.
 */

export function parseVideoAssemblyJson(
  text: string,
  status: number,
  label: string,
  url: string
): Record<string, unknown> {
  const t = text.trim();
  if (t.startsWith("<!") || t.startsWith("<html") || t.startsWith("<HTML")) {
    const gatewayHint =
      url.includes("/status/")
        ? " If POST started fine but polling failed, redeploy the Fly **media-gateway** image (services/media-gateway) — it must proxy GET /status to video-assembly. "
        : " ";
    throw new Error(
      `${label}: expected JSON but got HTML (${status}) from ${url}. ` +
        "Point VIDEO_ASSEMBLY_BASE_URL at the Node video-assembly service or media-gateway (not CAF Core / standalone renderer-only app)." +
        gatewayHint +
        `Preview: ${t.slice(0, 200)}`
    );
  }
  try {
    return JSON.parse(t) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${label}: invalid JSON (${status}): ${msg}. Preview: ${t.slice(0, 240)}`);
  }
}

export async function pollVideoAssemblyJob(
  baseUrl: string,
  requestId: string,
  maxMs = 600_000
): Promise<{ public_url?: string; local_path?: string }> {
  const start = Date.now();
  let delay = 2000;
  const statusUrl = `${baseUrl.replace(/\/$/, "")}/status/${requestId}`;
  while (Date.now() - start < maxMs) {
    const pollTimeoutMs = Math.min(30_000, Math.max(5000, Math.floor(delay * 1.2)));
    const r = await fetch(statusUrl, { signal: AbortSignal.timeout(pollTimeoutMs) });
    const raw = await r.text();
    const j = parseVideoAssemblyJson(raw, r.status, "video-assembly status", statusUrl) as {
      status?: string;
      error?: string;
      public_url?: string;
      local_path?: string;
    };
    if (j.status === "done") return { public_url: j.public_url, local_path: j.local_path };
    if (j.status === "error") throw new Error(j.error ?? "video-assembly error");
    await new Promise((x) => setTimeout(x, delay));
    delay = Math.min(delay * 2, 30_000);
  }
  throw new Error("video-assembly async timeout");
}
