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
const VERSION = "0.1.0";

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
