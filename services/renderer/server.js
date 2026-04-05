const express = require("express");
const path = require("path");
const fs = require("fs");
const Handlebars = require("handlebars");
const { randomUUID } = require("crypto");

const PORT = parseInt(process.env.PORT || "3333", 10);
const RENDERERS_BEFORE_RESET = parseInt(process.env.RENDERERS_BEFORE_RESET || "12", 10);
const RENDER_TIMEOUT_MS = parseInt(process.env.RENDER_TIMEOUT_MS || "90000", 10);
const CAF_TEMPLATE_API_URL = process.env.CAF_TEMPLATE_API_URL || "";
const SHUTDOWN_SECRET = process.env.RENDERER_SHUTDOWN_SECRET || "";
const OUTPUT_DIR = path.join(__dirname, "output");
const TEMPLATES_DIR = path.join(__dirname, "templates");
const VERSION = "0.1.0";

if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
if (!fs.existsSync(TEMPLATES_DIR)) fs.mkdirSync(TEMPLATES_DIR, { recursive: true });

let browser = null;
let renderCount = 0;
const asyncJobs = new Map();
const renderQueue = [];
let rendering = false;

async function launchBrowser() {
  const puppeteer = require("puppeteer");
  browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });
  console.log("Browser launched");
}

async function resetBrowser() {
  if (browser) { try { await browser.close(); } catch {} }
  browser = null;
  renderCount = 0;
  await launchBrowser();
}

async function ensureBrowser() {
  if (!browser) await launchBrowser();
}

function resolveTemplate(name) {
  const safeName = name.endsWith(".hbs") ? name : `${name}.hbs`;
  const local = path.join(TEMPLATES_DIR, safeName);
  if (fs.existsSync(local)) return fs.readFileSync(local, "utf8");
  return null;
}

async function resolveTemplateRemote(name) {
  if (!CAF_TEMPLATE_API_URL) return null;
  const safeName = name.endsWith(".hbs") ? name : `${name}.hbs`;
  try {
    const res = await fetch(`${CAF_TEMPLATE_API_URL}/api/templates/${encodeURIComponent(safeName)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.source || null;
  } catch { return null; }
}

function normalizeBody(body) {
  let b = body.body ?? body;
  if (typeof b.data === "string") try { b.data = JSON.parse(b.data); } catch {}
  if (b.data && typeof b.data.render === "string") try { b.data.render = JSON.parse(b.data.render); } catch {}
  return b;
}

function getTemplateNameFromBody(b) {
  return b.template || b.data?.render?.html_template_name || b.data?.render?.template_key || "default";
}

async function renderSlide(b, slideIndex) {
  await ensureBrowser();
  const templateName = getTemplateNameFromBody(b);
  let source = resolveTemplate(templateName);
  if (!source) source = await resolveTemplateRemote(templateName);
  if (!source) throw new Error(`Template not found: ${templateName}`);

  const compiled = Handlebars.compile(source);
  const context = b.data?.render ?? b.data ?? b;
  const html = compiled(context);

  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });
  await page.setContent(html, { waitUntil: "networkidle0", timeout: RENDER_TIMEOUT_MS });

  const slides = await page.$$(".slide");
  const idx = (slideIndex ?? 1) - 1;
  if (idx < 0 || idx >= slides.length) {
    await page.close();
    throw new Error(`Slide index ${slideIndex} out of range (${slides.length} slides)`);
  }

  const el = slides[idx];
  const buf = await el.screenshot({ type: "png" });
  await page.close();

  renderCount++;
  if (RENDERERS_BEFORE_RESET > 0 && renderCount >= RENDERERS_BEFORE_RESET) {
    resetBrowser().catch(() => {});
  }

  const runId = b.run_id || b.data?.run_id || "default";
  const taskId = b.task_id || b.data?.task_id || randomUUID();
  const safe = (s) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  const outDir = path.join(OUTPUT_DIR, safe(runId), safe(taskId));
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const filename = `${String(slideIndex || 1).padStart(3, "0")}_slide.png`;
  const outPath = path.join(outDir, filename);
  fs.writeFileSync(outPath, buf);

  const relativePath = path.relative(OUTPUT_DIR, outPath).replace(/\\/g, "/");
  return { relativePath, resultUrl: `/output/${relativePath}` };
}

async function processQueue() {
  if (rendering || renderQueue.length === 0) return;
  rendering = true;
  const { body, slideIndex, resolve, reject } = renderQueue.shift();
  try {
    const result = await renderSlide(body, slideIndex);
    resolve(result);
  } catch (e) {
    reject(e);
  } finally {
    rendering = false;
    processQueue();
  }
}

function enqueue(body, slideIndex) {
  return new Promise((resolve, reject) => {
    renderQueue.push({ body, slideIndex, resolve, reject });
    processQueue();
  });
}

const app = express();
app.use(require("cors")());
app.use(express.json({ limit: "50mb" }));
app.use("/output", express.static(OUTPUT_DIR));

app.get("/health", (_req, res) => res.json({ ok: true, service: "caf-renderer", version: VERSION, uptime_seconds: process.uptime() }));
app.get("/version", (_req, res) => res.json({ version: VERSION }));
app.get("/ready", async (_req, res) => { await ensureBrowser(); res.json({ ok: true }); });
app.get("/warmup", (_req, res) => { ensureBrowser().catch(() => {}); res.json({ ok: true }); });

app.post("/reset", async (_req, res) => { await resetBrowser(); res.json({ ok: true }); });
app.get("/reset", async (_req, res) => { await resetBrowser(); res.json({ ok: true }); });

app.post("/shutdown", (req, res) => {
  const s = req.headers["x-shutdown-secret"] || req.query.secret;
  if (SHUTDOWN_SECRET && s !== SHUTDOWN_SECRET) return res.status(403).json({ ok: false });
  res.json({ ok: true });
  setTimeout(() => process.exit(0), 200);
});

app.get("/templates", async (_req, res) => {
  const local = fs.existsSync(TEMPLATES_DIR) ? fs.readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith(".hbs")) : [];
  let remote = [];
  if (CAF_TEMPLATE_API_URL) {
    try {
      const r = await fetch(`${CAF_TEMPLATE_API_URL}/api/templates`);
      if (r.ok) { const d = await r.json(); remote = d.templates?.map((t) => t.name) ?? []; }
    } catch {}
  }
  const all = [...new Set([...local, ...remote])].sort();
  res.json({ templates: all });
});

app.get("/templates/source/:name", async (req, res) => {
  const name = req.params.name;
  let source = resolveTemplate(name);
  if (!source) source = await resolveTemplateRemote(name);
  if (!source) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ name, source });
});

app.post("/render", async (req, res) => {
  try {
    const b = normalizeBody(req.body);
    const slideIndex = b.slide_index ?? req.body.slide_index ?? 1;
    const isAsync = req.query.async === "1";
    if (isAsync) {
      const requestId = randomUUID();
      asyncJobs.set(requestId, { status: "pending" });
      enqueue(b, slideIndex)
        .then((r) => asyncJobs.set(requestId, { status: "done", ...r }))
        .catch((e) => asyncJobs.set(requestId, { status: "error", error: e.message }));
      setTimeout(() => asyncJobs.delete(requestId), 3600000);
      return res.status(202).json({ ok: true, request_id: requestId, status: "pending" });
    }
    const result = await enqueue(b, slideIndex);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/render-binary", async (req, res) => {
  try {
    const b = normalizeBody(req.body);
    const slideIndex = b.slide_index ?? req.body.slide_index ?? 1;
    const isAsync = req.query.async === "1";
    if (isAsync) {
      const requestId = randomUUID();
      asyncJobs.set(requestId, { status: "pending" });
      enqueue(b, slideIndex)
        .then((r) => asyncJobs.set(requestId, { status: "done", ...r }))
        .catch((e) => asyncJobs.set(requestId, { status: "error", error: e.message }));
      setTimeout(() => asyncJobs.delete(requestId), 3600000);
      return res.status(202).json({ ok: true, request_id: requestId, status: "pending" });
    }
    const result = await enqueue(b, slideIndex);
    const filePath = path.join(OUTPUT_DIR, result.relativePath);
    res.setHeader("Content-Type", "image/png");
    res.send(fs.readFileSync(filePath));
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/render-carousel", async (req, res) => {
  try {
    const b = normalizeBody(req.body);
    await ensureBrowser();
    const templateName = getTemplateNameFromBody(b);
    let source = resolveTemplate(templateName);
    if (!source) source = await resolveTemplateRemote(templateName);
    if (!source) return res.status(404).json({ ok: false, error: `Template not found: ${templateName}` });
    const compiled = Handlebars.compile(source);
    const context = b.data?.render ?? b.data ?? b;
    const html = compiled(context);
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: RENDER_TIMEOUT_MS });
    const slides = await page.$$(".slide");
    const results = [];
    for (let i = 0; i < slides.length; i++) {
      const buf = await slides[i].screenshot({ type: "png" });
      const runId = b.run_id || "default";
      const taskId = b.task_id || randomUUID();
      const safe = (s) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
      const outDir = path.join(OUTPUT_DIR, safe(runId), safe(taskId));
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      const filename = `${String(i + 1).padStart(3, "0")}_slide.png`;
      const outPath = path.join(outDir, filename);
      fs.writeFileSync(outPath, buf);
      const relativePath = path.relative(OUTPUT_DIR, outPath).replace(/\\/g, "/");
      results.push({ slide_index: i + 1, result_url: `/output/${relativePath}` });
    }
    await page.close();
    renderCount += slides.length;
    res.json({ ok: true, slides: results });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post("/preview-template", async (req, res) => {
  try {
    const b = normalizeBody(req.body);
    b.slide_index = 1;
    const result = await enqueue(b, 1);
    res.json({ ok: true, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/render/status/:requestId", (req, res) => {
  const job = asyncJobs.get(req.params.requestId);
  if (!job) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, request_id: req.params.requestId, ...job });
});

app.listen(PORT, () => console.log(`Renderer listening on :${PORT}`));

process.on("SIGTERM", async () => { if (browser) await browser.close(); process.exit(0); });
process.on("SIGINT", async () => { if (browser) await browser.close(); process.exit(0); });
