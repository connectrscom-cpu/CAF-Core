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

/** GET /health on RENDERER_BASE_URL and VIDEO_ASSEMBLY_BASE_URL (for /health/rendering). */
export async function probeRenderingDeps(config: AppConfig): Promise<RenderingDepsProbe> {
  const [renderer, video_assembly] = await Promise.all([
    probeHealthBase(config.RENDERER_BASE_URL),
    probeHealthBase(config.VIDEO_ASSEMBLY_BASE_URL),
  ]);
  return { renderer, video_assembly };
}
