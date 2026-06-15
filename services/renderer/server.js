const express = require("express");
const path = require("path");
const fs = require("fs");
const Handlebars = require("handlebars");
const { randomUUID } = require("crypto");
const { joinEmojiOrphanLines } = require("./join-emoji-orphans.js");
const { adaptMimicDocAiTextContrast } = require("./mimic-docai-contrast.js");
const { fitDocAiTextLayersToBoxes } = require("./mimic-docai-fit.js");

Handlebars.registerHelper("joinEmojiOrphans", (v) => joinEmojiOrphanLines(v));

const PORT = parseInt(process.env.PORT || "3333", 10);
const HOST = (process.env.HOST || "0.0.0.0").trim();
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
let browserLaunchPromise = null;
let browserResetPromise = null;

const TRANSIENT_PUPPETEER_ERR =
  /Target closed|createTarget|Failed to open a new tab|Protocol error|Browser disconnected|Session closed|ECONNRESET|socket hang up|Navigation failed/i;

async function launchBrowser() {
  const puppeteer = require("puppeteer");
  const launchTimeoutMs = parseInt(process.env.PUPPETEER_LAUNCH_TIMEOUT_MS || "120000", 10);
  browser = await puppeteer.launch({
    headless: "new",
    timeout: launchTimeoutMs,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
      "--no-zygote",
    ],
  });
  console.log("Browser launched");
}

async function resetBrowser() {
  if (browserResetPromise) return browserResetPromise;
  browserResetPromise = (async () => {
    if (browser) {
      try {
        await browser.close();
      } catch {}
    }
    browser = null;
    renderCount = 0;
    // Ensure only one launch happens during reset storms.
    await ensureBrowser();
  })()
    .finally(() => {
      browserResetPromise = null;
    });
  return browserResetPromise;
}

async function ensureBrowser() {
  if (browser) return;
  if (browserLaunchPromise) return browserLaunchPromise;
  browserLaunchPromise = (async () => {
    try {
      await launchBrowser();
    } catch (e) {
      // Never crash the whole server on Chromium launch flakiness.
      browser = null;
      const msg = e?.message ? String(e.message) : String(e);
      console.error("Browser launch failed:", msg);
      throw e;
    }
  })().finally(() => {
    browserLaunchPromise = null;
  });
  return browserLaunchPromise;
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

function pTimeout(promise, ms, label) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise
      .then((v) => { clearTimeout(t); resolve(v); })
      .catch((e) => { clearTimeout(t); reject(e); });
  });
}

/** Reviewer-tunable sizes from CAF Core `generated_output.render` → CSS variables for templates. */
const CAROUSEL_TYPO_CONTEXT_TO_CSS = {
  carousel_headline_font_px: "--caf-carousel-headline-size",
  carousel_body_font_px: "--caf-carousel-body-size",
  carousel_kicker_font_px: "--caf-carousel-kicker-size",
  carousel_cta_font_px: "--caf-carousel-cta-size",
  carousel_handle_font_px: "--caf-carousel-handle-size",
};

const CAROUSEL_LAYOUT_CONTEXT_TO_CSS = {
  mimic_page_justify: "--caf-page-justify",
  mimic_page_align: "--caf-page-align",
  mimic_text_align: "--caf-text-align",
};

/** Nemotron normalized 0–1 text region for absolute mimic overlay. */
const CAROUSEL_BLOCK_POSITION_TO_CSS = {
  mimic_text_x: "--caf-text-x",
  mimic_text_y: "--caf-text-y",
  mimic_text_w: "--caf-text-w",
};

const CAROUSEL_THEME_CONTEXT_TO_CSS = {
  carousel_paper: "--paper",
  carousel_ink: "--ink",
  carousel_body: "--body",
  carousel_text_shadow_headline: "--text-shadow-headline",
  carousel_text_shadow_body: "--text-shadow-body",
};

function cafCarouselTypographyStyleTag(context) {
  const ctx = context && typeof context === "object" && !Array.isArray(context) ? context : {};
  const inner = ctx.render && typeof ctx.render === "object" && !Array.isArray(ctx.render) ? ctx.render : {};
  const parts = [];
  for (const [key, cssVar] of Object.entries(CAROUSEL_TYPO_CONTEXT_TO_CSS)) {
    const raw = ctx[key] ?? inner[key];
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 512) continue;
    parts.push(`${cssVar}:${Math.round(n)}px`);
  }
  for (const [key, cssVar] of Object.entries(CAROUSEL_LAYOUT_CONTEXT_TO_CSS)) {
    const raw = ctx[key] ?? inner[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    parts.push(`${cssVar}:${raw.trim()}`);
  }
  for (const [key, cssVar] of Object.entries(CAROUSEL_BLOCK_POSITION_TO_CSS)) {
    const raw = ctx[key] ?? inner[key];
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 1) continue;
    parts.push(`${cssVar}:${n}`);
  }
  for (const [key, cssVar] of Object.entries(CAROUSEL_THEME_CONTEXT_TO_CSS)) {
    const raw = ctx[key] ?? inner[key];
    if (typeof raw !== "string" || !raw.trim()) continue;
    parts.push(`${cssVar}:${raw.trim()}`);
  }
  if (parts.length === 0) return "";
  return `<style id="caf-carousel-typography">:root{${parts.join(";")}}</style>`;
}

async function hardenPageForFastRendering(page) {
  // Many templates are fully self-contained; when they are not, external resources can cause long hangs.
  // Block http(s) requests to keep render time bounded and reduce Chromium flakiness.
  try {
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      const url = req.url();
      if (url.startsWith("data:") || url.startsWith("blob:") || url.startsWith("file:")) return req.continue();
      // Allow Supabase/CDN background plates for mimic carousel templates (carousel_mimic_bg.hbs).
      if (
        (url.startsWith("http://") || url.startsWith("https://")) &&
        (req.resourceType() === "image" || req.resourceType() === "media")
      ) {
        return req.continue();
      }
      if (url.startsWith("http://") || url.startsWith("https://")) return req.abort("blockedbyclient");
      return req.continue();
    });
  } catch {
    // ignore (some puppeteer builds disallow interception in rare cases)
  }
  page.setDefaultTimeout(RENDER_TIMEOUT_MS);
  page.setDefaultNavigationTimeout(RENDER_TIMEOUT_MS);
}

async function renderSlide(b, slideIndex) {
  let lastErr = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    let page = null;
    try {
      await ensureBrowser();
      const templateName = getTemplateNameFromBody(b);
      let source = resolveTemplate(templateName);
      if (!source) source = await resolveTemplateRemote(templateName);
      if (!source) throw new Error(`Template not found: ${templateName}`);

      const compiled = Handlebars.compile(source);
      const context = b.data?.render ?? b.data ?? b;
      const fontScaleRaw = context?.font_scale ?? context?.render?.font_scale ?? b?.font_scale ?? b?.data?.font_scale;
      const fontScaleNum = Number(fontScaleRaw);
      const fontScale =
        Number.isFinite(fontScaleNum) && fontScaleNum > 0 ? Math.min(1.25, Math.max(0.75, fontScaleNum)) : 1;
      // Zoom each `.slide` (not `body`): Puppeteer screenshots a `.slide` node; body zoom can fail to
      // scale the subtree consistently for element captures — cover + inner slides then track the slider.
      const zoomStyle = `<style id="caf-font-scale">:root{--font_scale:${fontScale};}.slide{zoom:var(--font_scale);}</style>`;
      const typoStyle = cafCarouselTypographyStyleTag(context);
      // After compiled HTML so :root defaults in templates do not override Review px overrides.
      const html = zoomStyle + compiled(context) + typoStyle;

      page = await browser.newPage();
      await hardenPageForFastRendering(page);
      await page.setViewport({ width: 1080, height: 1350, deviceScaleFactor: 2 });

      // `networkidle0` is fragile (fonts/images/analytics). `domcontentloaded` keeps this bounded.
      await pTimeout(
        page.setContent(html, { waitUntil: "domcontentloaded", timeout: RENDER_TIMEOUT_MS }),
        RENDER_TIMEOUT_MS + 5_000,
        "page.setContent"
      );

      const renderCtx =
        context?.render && typeof context.render === "object" && !Array.isArray(context.render)
          ? context.render
          : {};
      const useDocAiLayers = Boolean(context?.mimic_use_docai_layers ?? renderCtx.mimic_use_docai_layers);
      if (useDocAiLayers) {
        try {
          await fitDocAiTextLayersToBoxes(page);
        } catch (fitErr) {
          console.warn("fitDocAiTextLayersToBoxes failed — continuing with pre-fit layout", fitErr);
        }
        await adaptMimicDocAiTextContrast(page);
      }

      const slides = await page.$$(".slide");
      const idx = (slideIndex ?? 1) - 1;
      if (idx < 0 || idx >= slides.length) {
        throw new Error(`Slide index ${slideIndex} out of range (${slides.length} slides)`);
      }

      const el = slides[idx];
      const buf = await pTimeout(el.screenshot({ type: "png" }), RENDER_TIMEOUT_MS, "element.screenshot");

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
    } catch (e) {
      lastErr = e;
      const msg = e?.message ? String(e.message) : String(e);
      if (TRANSIENT_PUPPETEER_ERR.test(msg) && attempt === 0) {
        // Chromium occasionally dies under memory pressure; reset and retry once.
        try { await resetBrowser(); } catch {}
        continue;
      }
      throw e;
    } finally {
      if (page) { try { await page.close(); } catch {} }
    }
  }
  throw lastErr || new Error("render failed");
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
app.get("/ready", async (_req, res) => {
  try {
    await ensureBrowser();
    res.json({ ok: true });
  } catch (e) {
    const msg = e?.message ? String(e.message) : String(e);
    res.status(503).json({ ok: false, error: msg });
  }
});
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
    const fontScaleRaw = context?.font_scale ?? context?.render?.font_scale ?? b?.font_scale ?? b?.data?.font_scale;
    const fontScaleNum = Number(fontScaleRaw);
    const fontScale =
      Number.isFinite(fontScaleNum) && fontScaleNum > 0 ? Math.min(1.25, Math.max(0.75, fontScaleNum)) : 1;
    const zoomStyle = `<style id="caf-font-scale">:root{--font_scale:${fontScale};}.slide{zoom:var(--font_scale);}</style>`;
    const typoStyle = cafCarouselTypographyStyleTag(context);
    // After compiled HTML so :root defaults in templates do not override Review px overrides.
    const html = zoomStyle + compiled(context) + typoStyle;
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
    const rawIdx = Number(req.body?.slide_index ?? b.slide_index ?? 1);
    const slideIndex = Number.isFinite(rawIdx) && rawIdx > 0 ? Math.floor(rawIdx) : 1;
    b.slide_index = slideIndex;
    const force = req.query?.force === "1" || req.body?.force === true;
    // Deterministic cache path: same template + slide_index always lands on the same file.
    // The disk is ephemeral per machine, so a fresh deploy (= new template/.hbs source) wipes it naturally.
    const tplName = String(getTemplateNameFromBody(b) || "").replace(/\.hbs$/i, "");
    const safeTpl = tplName.replace(/[^a-zA-Z0-9_-]/g, "_") || "preview";
    b.run_id = "__previews__";
    b.task_id = safeTpl;
    const filename = `${String(slideIndex).padStart(3, "0")}_slide.png`;
    const cachedRel = `__previews__/${safeTpl}/${filename}`;
    const cachedFull = path.join(OUTPUT_DIR, cachedRel);
    if (!force && fs.existsSync(cachedFull)) {
      return res.json({
        ok: true,
        slide_index: slideIndex,
        cached: true,
        relativePath: cachedRel,
        resultUrl: `/output/${cachedRel}`,
        result_url: `/output/${cachedRel}`,
      });
    }
    const result = await enqueue(b, slideIndex);
    res.json({
      ok: true,
      slide_index: slideIndex,
      cached: false,
      result_url: result.resultUrl,
      ...result,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get("/render/status/:requestId", (req, res) => {
  const job = asyncJobs.get(req.params.requestId);
  if (!job) return res.status(404).json({ ok: false, error: "not found" });
  res.json({ ok: true, request_id: req.params.requestId, ...job });
});

app.listen(PORT, HOST, () => console.log(`Renderer listening on ${HOST}:${PORT}`));

process.on("SIGTERM", async () => { if (browser) await browser.close(); process.exit(0); });
process.on("SIGINT", async () => { if (browser) await browser.close(); process.exit(0); });
process.on("unhandledRejection", (e) => {
  const msg = e?.message ? String(e.message) : String(e);
  console.error("unhandledRejection:", msg);
});
process.on("uncaughtException", (e) => {
  const msg = e?.message ? String(e.message) : String(e);
  console.error("uncaughtException:", msg);
});
