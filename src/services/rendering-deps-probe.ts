import type { AppConfig } from "../config.js";

const PROBE_MS = 8000;

export interface DepProbeResult {
  base_url: string;
  ok: boolean;
  http_status?: number;
  error?: string;
  body_preview?: string;
}

async function probeHealthBase(baseUrl: string): Promise<DepProbeResult> {
  const base = baseUrl.replace(/\/$/, "");
  const url = `${base}/health`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), PROBE_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "follow" });
    const text = await res.text();
    return {
      base_url: base,
      ok: res.ok,
      http_status: res.status,
      body_preview: text.slice(0, 400),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { base_url: base, ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

export interface RenderingDepsProbe {
  renderer: DepProbeResult;
  video_assembly: DepProbeResult;
}

export interface RendererQueueProbe {
  base_url: string;
  ok: boolean;
  http_status?: number;
  error?: string;
  queue_depth?: number;
  rendering?: boolean;
  render_count?: number;
  browser_up?: boolean;
}

/** GET /render-queue on the Puppeteer renderer (or media-gateway proxy). */
export async function probeRendererQueue(rendererBaseUrl: string): Promise<RendererQueueProbe> {
  const base = rendererBaseUrl.replace(/\/$/, "");
  const url = `${base}/render-queue`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), PROBE_MS);
  try {
    const res = await fetch(url, { signal: ac.signal, redirect: "follow" });
    const text = await res.text();
    if (!res.ok) {
      return { base_url: base, ok: false, http_status: res.status, error: text.slice(0, 400) };
    }
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return { base_url: base, ok: false, http_status: res.status, error: "invalid_json" };
    }
    return {
      base_url: base,
      ok: Boolean(data.ok),
      http_status: res.status,
      queue_depth: typeof data.queue_depth === "number" ? data.queue_depth : undefined,
      rendering: typeof data.rendering === "boolean" ? data.rendering : undefined,
      render_count: typeof data.render_count === "number" ? data.render_count : undefined,
      browser_up: typeof data.browser_up === "boolean" ? data.browser_up : undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { base_url: base, ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

/** GET /health on RENDERER_BASE_URL and VIDEO_ASSEMBLY_BASE_URL (for /health/rendering). */
export async function probeRenderingDeps(config: AppConfig): Promise<RenderingDepsProbe> {
  const [renderer, video_assembly] = await Promise.all([
    probeHealthBase(config.RENDERER_BASE_URL),
    probeHealthBase(config.VIDEO_ASSEMBLY_BASE_URL),
  ]);
  return { renderer, video_assembly };
}
