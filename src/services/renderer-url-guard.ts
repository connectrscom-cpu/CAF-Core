/**
 * Log warnings for common RENDERER_BASE_URL / VIDEO_ASSEMBLY_BASE_URL mistakes at startup and in the job pipeline.
 */

function trimmedBase(url: string): string {
  return url.replace(/\/$/, "");
}

function tryParseUrl(url: string): URL | null {
  try {
    return new URL(trimmedBase(url));
  } catch {
    return null;
  }
}

function effectivePort(u: URL): string {
  if (u.port) return u.port;
  if (u.protocol === "https:") return "443";
  if (u.protocol === "http:") return "80";
  return "";
}

/** Warn when RENDERER_BASE_URL points at this API's listen port (carousel calls would hit Core, not Puppeteer). */
export async function warnIfRendererBaseUrlIsCafCore(
  rendererBaseUrl: string,
  warn: (msg: string) => void
): Promise<void> {
  const u = tryParseUrl(rendererBaseUrl);
  if (!u) return;
  const corePort = String(process.env.PORT || "3847");
  if (effectivePort(u) === corePort) {
    warn(
      `[CAF Core] RENDERER_BASE_URL (${rendererBaseUrl}) uses port ${corePort}, same as this API. Point it at the carousel renderer or media-gateway, not CAF Core.`
    );
  }
}

/**
 * Warn when VIDEO_ASSEMBLY_BASE_URL looks like the standalone local carousel renderer (:3333),
 * which does not serve stitch/mux unless you use a gateway on that port.
 */
export async function warnIfVideoAssemblyIsStandaloneRenderer(
  videoAssemblyBaseUrl: string,
  warn: (msg: string) => void
): Promise<void> {
  const u = tryParseUrl(videoAssemblyBaseUrl);
  if (!u) return;
  const port = effectivePort(u);
  const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
  if (local && port === "3333") {
    warn(
      `[CAF Core] VIDEO_ASSEMBLY_BASE_URL (${videoAssemblyBaseUrl}) is localhost:3333 (typical standalone carousel renderer). Confirm this host exposes POST /stitch and POST /mux (or use :3334 / a combined gateway).`
    );
  }
}
