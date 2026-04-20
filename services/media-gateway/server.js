const express = require("express");
const cors = require("cors");
/** v3 removed req.url patching when mounted on a path — without legacy adapter, POST /render-binary hits upstream as POST /. */
const { legacyCreateProxyMiddleware: createProxyMiddleware } = require("http-proxy-middleware");
const { spawn } = require("child_process");
const path = require("path");

const PORT = parseInt(process.env.PORT || "3300", 10);
const RENDERER_PORT = parseInt(process.env.RENDERER_PORT || "3333", 10);
const VIDEO_PORT = parseInt(process.env.VIDEO_PORT || "3334", 10);
const SPAWN_CHILDREN = process.env.SPAWN_CHILDREN !== "false";
const VERSION = "0.1.1";

const children = [];

function spawnChild(name, script, port) {
  const cwd = path.join(__dirname, "..", name);
  console.log(`Spawning ${name} on :${port}...`);
  const child = spawn("node", [script], {
    cwd,
    env: { ...process.env, PORT: String(port) },
    stdio: "pipe",
  });
  child.stdout.on("data", (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[${name}] ${d}`));
  child.on("exit", (code) => console.log(`[${name}] exited (${code})`));
  children.push(child);
  return child;
}

if (SPAWN_CHILDREN) {
  spawnChild("renderer", "server.js", RENDERER_PORT);
  spawnChild("video-assembly", "server.js", VIDEO_PORT);
}

const app = express();
app.use(cors());

app.get("/health", (_req, res) =>
  res.json({
    ok: true,
    service: "caf-media-gateway",
    version: VERSION,
    children: { renderer: RENDERER_PORT, video_assembly: VIDEO_PORT },
  })
);

async function tryGet(url, timeoutMs) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Readiness: confirms the renderer can launch Chromium and video-assembly sees ffmpeg.
 * This is a better Fly check than /health (liveness only).
 */
app.get("/ready", async (_req, res) => {
  const timeoutMs = parseInt(process.env.MEDIA_GATEWAY_READY_TIMEOUT_MS || "8000", 10);
  const rendererOk = await tryGet(`http://127.0.0.1:${RENDERER_PORT}/ready`, timeoutMs);
  const videoOk = await tryGet(`http://127.0.0.1:${VIDEO_PORT}/ready`, timeoutMs);
  const ok = Boolean(rendererOk && videoOk);
  res.status(ok ? 200 : 503).json({
    ok,
    service: "caf-media-gateway",
    version: VERSION,
    renderer_ready: rendererOk,
    video_assembly_ready: videoOk,
  });
});

app.use(
  "/render",
  createProxyMiddleware({
    target: `http://127.0.0.1:${RENDERER_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/render": "/render" },
  })
);

app.use(
  "/render-carousel",
  createProxyMiddleware({
    target: `http://127.0.0.1:${RENDERER_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/render-carousel": "/render-carousel" },
  })
);

app.use(
  "/render-binary",
  createProxyMiddleware({
    target: `http://127.0.0.1:${RENDERER_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/render-binary": "/render-binary" },
  })
);

app.use(
  "/preview-template",
  createProxyMiddleware({
    target: `http://127.0.0.1:${RENDERER_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/preview-template": "/preview-template" },
  })
);

app.use(
  "/templates",
  createProxyMiddleware({
    target: `http://127.0.0.1:${RENDERER_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/templates": "/templates" },
  })
);

/**
 * Static rendered slides served by the renderer (express.static at /output).
 * CAF Core preview/render flow: POST /preview-template returns `result_url: /output/...png`,
 * then CAF Core fetches `${RENDERER_BASE_URL}${result_url}`. Without this proxy that GET
 * lands on the gateway (no /output route) and 404s, which CAF Core turns into a 502 with
 * `renderer_image_fetch_failed` — visible as "Render failed" tiles in the admin Carousel
 * Templates page even though the slide actually rendered fine on disk.
 */
app.use(
  "/output",
  createProxyMiddleware({
    target: `http://127.0.0.1:${RENDERER_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/output": "/output" },
  })
);

app.use(
  "/renderer",
  createProxyMiddleware({
    target: `http://127.0.0.1:${RENDERER_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/renderer": "" },
  })
);

app.use(
  "/stitch",
  createProxyMiddleware({
    target: `http://127.0.0.1:${VIDEO_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/stitch": "/stitch" },
  })
);

app.use(
  "/mux",
  createProxyMiddleware({
    target: `http://127.0.0.1:${VIDEO_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/mux": "/mux" },
  })
);

app.use(
  "/concat-videos",
  createProxyMiddleware({
    target: `http://127.0.0.1:${VIDEO_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/concat-videos": "/concat-videos" },
  })
);

/** HeyGen v3 script-led burn pipeline: CAF Core posts SRT + MP4 here, then polls /status/:requestId. */
app.use(
  "/burn-subtitles",
  createProxyMiddleware({
    target: `http://127.0.0.1:${VIDEO_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/burn-subtitles": "/burn-subtitles" },
  })
);

/** Async jobs (stitch / concat-videos / mux) poll GET /status/:requestId on video-assembly — must be proxied like POST routes. */
app.use(
  "/status",
  createProxyMiddleware({
    target: `http://127.0.0.1:${VIDEO_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/status": "/status" },
  })
);

app.use(
  "/full-pipeline",
  createProxyMiddleware({
    target: `http://127.0.0.1:${VIDEO_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/full-pipeline": "/full-pipeline" },
  })
);

app.use(
  "/video",
  createProxyMiddleware({
    target: `http://127.0.0.1:${VIDEO_PORT}`,
    changeOrigin: true,
    pathRewrite: { "^/video": "" },
  })
);

app.listen(PORT, () => {
  console.log(`Media Gateway listening on :${PORT}`);
  console.log(`  Renderer  -> :${RENDERER_PORT}`);
  console.log(`  Video     -> :${VIDEO_PORT}`);
});

function shutdown() {
  children.forEach((c) => { try { c.kill(); } catch {} });
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
