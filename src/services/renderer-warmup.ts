/**
 * Best-effort Puppeteer warm-up before carousel renders.
 * Direct renderer: GET /ready, /warmup. Media gateway: GET /renderer/ready, /renderer/warmup.
 */
async function tryGet(url: string, timeoutMs: number): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal });
    clearTimeout(t);
    return r.ok;
  } catch {
    return false;
  }
}

export async function warmupRenderer(rendererBaseUrl: string, timeoutMs = 120_000): Promise<void> {
  const base = rendererBaseUrl.replace(/\/$/, "");
  const paths = ["/ready", "/renderer/ready", "/warmup", "/renderer/warmup"];
  for (const p of paths) {
    if (await tryGet(`${base}${p}`, timeoutMs)) return;
  }
}
