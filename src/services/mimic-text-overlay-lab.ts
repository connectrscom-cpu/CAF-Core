import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
import { mimicDocAiContrastPageFnSource } from "./mimic-docai-contrast-page.js";
import { mimicDocAiFitPageFnSource } from "./mimic-docai-fit-page.js";
import {
  buildMimicDocAiRenderTextLayers,
  CAROUSEL_RENDER_HEIGHT_PX,
  CAROUSEL_RENDER_WIDTH_PX,
  inferMimicCarouselTheme,
  mimicPayloadHasDocAiTextLayout,
  referenceDocAiLayoutBlocksForMimicSlide,
  type MimicDocAiRenderTextLayer,
} from "./mimic-slide-typography.js";

export type MimicTextOverlayLabFixture = {
  description?: string;
  slide_index?: number;
  background_image_url?: string | null;
  /** Last production render (CAROUSEL_SLIDE) for side-by-side comparison. */
  rendered_slide_url?: string | null;
  llm_slide: Record<string, unknown>;
  mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans">;
  /** Production job source (art-only plates from Supabase storage). */
  task_id?: string;
  run_id?: string;
  /** Project Instagram handle for reference → project substitution at preview time. */
  project_handle?: string | null;
};

export type MimicTextOverlayLabComposeOpts = {
  mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans">;
  slideIndex: number;
  llmSlide: Record<string, unknown>;
  backgroundImageUrl?: string | null;
  projectHandle?: string | null;
};

export type MimicTextOverlayLabComposeResult = {
  slide_index: number;
  has_docai_layout: boolean;
  theme: { ink: string; body: string; paper: string };
  text_layers: MimicDocAiRenderTextLayer[];
  reference_blocks: ReturnType<typeof referenceDocAiLayoutBlocksForMimicSlide>;
  render_context: Record<string, unknown>;
};

/** Build the same renderer context job-pipeline uses for Document AI text layers (no image gen). */
export function composeMimicTextOverlayLabContext(
  opts: MimicTextOverlayLabComposeOpts
): MimicTextOverlayLabComposeResult {
  const slideIndex = Math.max(1, Math.floor(opts.slideIndex));
  const theme = inferMimicCarouselTheme(opts.mimic.visual_guideline ?? {});
  const reference_blocks = referenceDocAiLayoutBlocksForMimicSlide(opts.mimic, slideIndex);
  const text_layers = buildMimicDocAiRenderTextLayers(
    opts.mimic,
    slideIndex,
    opts.llmSlide,
    {
      ink: theme.ink,
      body: theme.body,
    },
    { projectHandle: opts.projectHandle ?? null }
  );

  const bg = (opts.backgroundImageUrl ?? "").trim() || null;
  const render_context: Record<string, unknown> = {
    background_image_url: bg,
    mimic_use_docai_layers: text_layers.length > 0,
    mimic_render_text_layers: text_layers,
    carousel_ink: theme.ink,
    carousel_body: theme.body,
    carousel_paper: theme.paper,
  };

  return {
    slide_index: slideIndex,
    has_docai_layout: mimicPayloadHasDocAiTextLayout(opts.mimic),
    theme,
    text_layers,
    reference_blocks,
    render_context,
  };
}

export function composeMimicTextOverlayLabFromFixture(
  fixture: MimicTextOverlayLabFixture
): MimicTextOverlayLabComposeResult {
  return composeMimicTextOverlayLabContext({
    mimic: fixture.mimic,
    slideIndex: fixture.slide_index ?? 1,
    llmSlide: fixture.llm_slide,
    backgroundImageUrl: fixture.background_image_url,
    projectHandle: fixture.project_handle ?? null,
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const DOC_AI_PREVIEW_CSS = `
  :root {
    --paper: #1a1a2e;
    --ink: #f5f5f7;
    --body: #e8e8ed;
    --text-shadow-headline: 0 1px 12px rgba(0,0,0,0.45);
    --text-shadow-body: 0 1px 10px rgba(0,0,0,0.4);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    background: #0f0f14;
    color: #e8e8ed;
    min-height: 100vh;
  }
  .lab-shell {
    display: flex;
    flex-wrap: wrap;
    gap: 24px;
    padding: 24px;
    align-items: flex-start;
    justify-content: center;
  }
  .lab-panel {
    flex: 0 1 420px;
    max-width: 100%;
    background: #18181f;
    border: 1px solid #2c2c36;
    border-radius: 12px;
    padding: 16px 18px;
    font-size: 13px;
    line-height: 1.45;
  }
  .lab-panel h1 { font-size: 16px; margin-bottom: 8px; }
  .lab-panel h2 { font-size: 13px; margin: 14px 0 6px; color: #a1a1aa; text-transform: uppercase; letter-spacing: 0.04em; }
  .lab-panel label { display: flex; align-items: center; gap: 8px; margin: 6px 0; cursor: pointer; }
  .lab-panel pre {
    background: #0d0d12;
    border-radius: 8px;
    padding: 10px;
    overflow: auto;
    max-height: 220px;
    font-size: 11px;
  }
  .lab-plate-refs {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    margin: 10px 0 4px;
  }
  .lab-plate-refs figure {
    flex: 1 1 140px;
    max-width: 200px;
    margin: 0;
  }
  .lab-plate-refs img {
    display: block;
    width: 100%;
    border-radius: 8px;
    border: 1px solid #3f3f46;
    background: #0d0d12;
  }
  .lab-plate-refs figcaption {
    margin-top: 4px;
    font-size: 11px;
    color: #71717a;
  }
  .lab-plate-refs a { color: #93c5fd; text-decoration: none; }
  .lab-plate-refs a:hover { text-decoration: underline; }
  .lab-canvas-wrap {
    flex: 0 0 auto;
    background: #18181f;
    border: 1px solid #2c2c36;
    border-radius: 12px;
    padding: 16px;
    max-width: 100%;
  }
  .lab-scale-control {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 12px;
    font-size: 12px;
    color: #a1a1aa;
  }
  .lab-scale-control input[type="range"] { flex: 1; max-width: 220px; }
  .lab-canvas-scaler {
    width: calc(${CAROUSEL_RENDER_WIDTH_PX}px * var(--lab-preview-scale, 0.4));
    height: calc(${CAROUSEL_RENDER_HEIGHT_PX}px * var(--lab-preview-scale, 0.4));
    overflow: hidden;
  }
  .lab-canvas-scaler .slide {
    transform: scale(var(--lab-preview-scale, 0.4));
    transform-origin: top left;
  }
  .slide {
    width: ${CAROUSEL_RENDER_WIDTH_PX}px;
    height: ${CAROUSEL_RENDER_HEIGHT_PX}px;
    overflow: hidden;
    position: relative;
    background: var(--paper);
    color: var(--ink);
    -webkit-font-smoothing: antialiased;
  }
  .slide-bg,
  .slide-bg-img {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-color: var(--paper);
  }
  .slide-bg {
    background-size: cover;
    background-position: center;
    background-repeat: no-repeat;
  }
  .slide-bg-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }
  .page.mimic-docai-layers {
    display: block;
    padding: 0;
    width: ${CAROUSEL_RENDER_WIDTH_PX}px;
    height: ${CAROUSEL_RENDER_HEIGHT_PX}px;
    position: relative;
    z-index: 1;
  }
  .mimic-docai-layer {
    position: absolute;
    z-index: 2;
    margin: 0;
    padding: 0;
    box-sizing: border-box;
    text-rendering: geometricPrecision;
    -webkit-font-smoothing: antialiased;
    text-shadow: var(--text-shadow-headline);
  }
  .mimic-docai-layer--single-line { display: flex; align-items: center; justify-content: flex-start; }
  .mimic-docai-layer--multi-line { display: block; }
  .mimic-docai-layer--body,
  .mimic-docai-layer--subtitle,
  .mimic-docai-layer--caption,
  .mimic-docai-layer--paragraph,
  .mimic-docai-layer--sub {
    text-shadow: var(--text-shadow-body);
  }
  .ref-debug-box {
    position: absolute;
    z-index: 3;
    border: 2px dashed rgba(255, 80, 80, 0.85);
    background: rgba(255, 80, 80, 0.06);
    pointer-events: none;
    font-size: 11px;
    color: rgba(255, 120, 120, 0.95);
    padding: 2px 4px;
    overflow: hidden;
  }
  .ref-debug-text {
    position: absolute;
    z-index: 1;
    opacity: 0.42;
    pointer-events: none;
    overflow: hidden;
    color: #ff8a8a;
    text-shadow: none;
    box-sizing: border-box;
    margin: 0;
    padding: 0;
    line-height: 1.1;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .scale-hint {
    margin-top: 10px;
    font-size: 12px;
    color: #71717a;
    text-align: center;
  }
`;

function layerHtml(layer: MimicDocAiRenderTextLayer): string {
  const refFs =
    layer.ref_font_size_px != null && layer.ref_font_size_px > 0
      ? ` data-ref-font-size="${layer.ref_font_size_px}"`
      : "";
  const skipCenter = layer.skip_center_avoid ? ` data-skip-center-avoid="1"` : "";
  const textBack = layer.text_backing ? " mimic-docai-layer--text-back" : "";
  return `<div class="mimic-docai-layer mimic-docai-layer--${escapeHtml(layer.role)} ${layer.layout_class}${textBack}"${refFs}${skipCenter} style="${layer.css_style}">${escapeHtml(layer.text)}</div>`;
}

function referenceBoxHtml(
  block: MimicTextOverlayLabComposeResult["reference_blocks"][number],
  showLabel: boolean
): string {
  const label = showLabel ? escapeHtml(block.text.slice(0, 40)) : "";
  return `<div class="ref-debug-box" style="left:${block.x_px}px;top:${block.y_px}px;width:${block.w_px}px;height:${block.h_px}px">${label}</div>`;
}

function referenceGhostTextHtml(
  block: MimicTextOverlayLabComposeResult["reference_blocks"][number]
): string {
  const fs = block.font_size_px ?? Math.max(12, Math.round(block.h_px * 0.72));
  const align = block.role && /center/i.test(block.role) ? "center" : "left";
  return `<div class="ref-debug-text" style="left:${block.x_px}px;top:${block.y_px}px;width:${block.w_px}px;height:${block.h_px}px;font-size:${fs}px;text-align:${align}">${escapeHtml(block.text)}</div>`;
}

export type MimicTextOverlayLabHtmlOpts = {
  title?: string;
  description?: string;
  /** Apply theme CSS variables from compose result. */
  theme?: MimicTextOverlayLabComposeResult["theme"];
  showDebugBoxes?: boolean;
  showReferenceGhostText?: boolean;
  /** Run shrink-to-fit in browser (matches services/renderer/server.js). */
  interactive?: boolean;
  llmSlide?: Record<string, unknown>;
  taskId?: string;
  runId?: string;
  backgroundImageUrl?: string | null;
  renderedSlideUrl?: string | null;
};

function findReferenceBlockForLayer(
  layer: MimicDocAiRenderTextLayer,
  blocks: MimicTextOverlayLabComposeResult["reference_blocks"]
): MimicTextOverlayLabComposeResult["reference_blocks"][number] | null {
  const exact = blocks.find(
    (b) =>
      b.x_px === layer.x_px &&
      b.y_px === layer.y_px &&
      b.w_px === layer.w_px &&
      b.h_px === layer.h_px
  );
  if (exact) return exact;
  let best: MimicTextOverlayLabComposeResult["reference_blocks"][number] | null = null;
  let bestDist = Infinity;
  for (const b of blocks) {
    const dx = b.x_px - layer.x_px;
    const dy = b.y_px - layer.y_px;
    const dist = dx * dx + dy * dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = b;
    }
  }
  return best;
}

/** Human-readable original-vs-rendered copy log for support / iteration. */
export function buildMimicTextOverlayDebugLog(
  composed: MimicTextOverlayLabComposeResult,
  meta?: {
    description?: string;
    taskId?: string;
    runId?: string;
    llmSlide?: Record<string, unknown>;
  }
): string {
  const lines: string[] = [];
  lines.push("=== Mimic Text Overlay Debug Log ===");
  lines.push(`Generated: ${new Date().toISOString()}`);
  if (meta?.description) lines.push(`Context: ${meta.description}`);
  if (meta?.taskId) lines.push(`Task: ${meta.taskId}`);
  if (meta?.runId) lines.push(`Run: ${meta.runId}`);
  lines.push(`Slide index: ${composed.slide_index}`);
  lines.push(`Canvas: ${CAROUSEL_RENDER_WIDTH_PX}×${CAROUSEL_RENDER_HEIGHT_PX}px`);
  lines.push(`Render layers: ${composed.text_layers.length}`);
  lines.push(`Reference targets: ${composed.reference_blocks.length}`);
  lines.push("");

  if (meta?.llmSlide && Object.keys(meta.llmSlide).length > 0) {
    lines.push("--- LLM slide (source copy) ---");
    lines.push(JSON.stringify(meta.llmSlide, null, 2));
    lines.push("");
  }

  lines.push("--- Copy mapping (reference OCR → rendered) ---");
  if (composed.text_layers.length === 0) {
    lines.push("(no text layers composed)");
  }
  for (let i = 0; i < composed.text_layers.length; i++) {
    const layer = composed.text_layers[i]!;
    const ref = findReferenceBlockForLayer(layer, composed.reference_blocks);
    lines.push("");
    lines.push(`Layer ${i + 1} · ${layer.role ?? "unknown"}`);
    lines.push(
      `  Box: x=${layer.x_px} y=${layer.y_px} w=${layer.w_px} h=${layer.h_px} · font=${layer.font_size_px ?? "?"}px · ${layer.layout_mode}`
    );
    lines.push(`  Original (reference): ${JSON.stringify(ref?.text ?? "(no matched reference block)")}`);
    lines.push(`  Rendered (LLM copy):    ${JSON.stringify(layer.text)}`);
    if (ref && ref.text !== layer.text) {
      lines.push(`  Δ length: ref ${ref.text.length} chars → rendered ${layer.text.length} chars`);
    }
  }

  const mappedRefs = new Set(
    composed.text_layers
      .map((l) => findReferenceBlockForLayer(l, composed.reference_blocks))
      .filter(Boolean)
      .map((b) => b!.text)
  );
  const unmapped = composed.reference_blocks.filter((b) => !mappedRefs.has(b.text));
  if (unmapped.length > 0) {
    lines.push("");
    lines.push("--- Reference targets without rendered layer ---");
    for (const b of unmapped) {
      lines.push(`  · [${b.role ?? "other"}] ${JSON.stringify(b.text)} @ (${b.x_px},${b.y_px})`);
    }
  }

  lines.push("");
  lines.push("--- End ---");
  return lines.join("\n");
}

/** Standalone HTML preview — open in browser without Puppeteer or a full job render. */
export function renderMimicTextOverlayLabHtml(
  composed: MimicTextOverlayLabComposeResult,
  opts: MimicTextOverlayLabHtmlOpts = {}
): string {
  const theme = opts.theme ?? composed.theme;
  const showBoxes = opts.showDebugBoxes !== false;
  const showGhost = opts.showReferenceGhostText === true;
  const interactive = opts.interactive !== false;
  const title = opts.title ?? "Mimic text overlay lab";
  const description = opts.description ?? "";

  const bgRaw = opts.backgroundImageUrl ?? composed.render_context.background_image_url;
  const bg = (typeof bgRaw === "string" ? bgRaw : "").trim() || null;
  const renderedUrl = (opts.renderedSlideUrl ?? "").trim() || null;
  const bgStyle = bg ? `background-image:url('${escapeHtml(bg)}');` : "";
  const bgImg = bg ? `<img class="slide-bg-img" src="${escapeHtml(bg)}" alt="Art-only plate" crossorigin="anonymous" />` : "";
  const plateRefsHtml =
    bg || renderedUrl
      ? `<div class="lab-plate-refs">
  ${
    bg
      ? `<figure><a href="${escapeHtml(bg)}" target="_blank" rel="noopener"><img src="${escapeHtml(bg)}" alt="MIMIC_BACKGROUND plate" crossorigin="anonymous" loading="lazy" /></a><figcaption><a href="${escapeHtml(bg)}" target="_blank" rel="noopener">Art-only plate (Supabase)</a></figcaption></figure>`
      : ""
  }
  ${
    renderedUrl
      ? `<figure><a href="${escapeHtml(renderedUrl)}" target="_blank" rel="noopener"><img src="${escapeHtml(renderedUrl)}" alt="Last rendered slide" crossorigin="anonymous" loading="lazy" /></a><figcaption><a href="${escapeHtml(renderedUrl)}" target="_blank" rel="noopener">Last CAROUSEL_SLIDE render</a></figcaption></figure>`
      : ""
  }
</div>`
      : `<p style="color:#71717a;font-size:12px">No stored plate URL — load a production job with MIMIC_BACKGROUND assets.</p>`;

  const refBoxes = showBoxes
    ? composed.reference_blocks.map((b) => referenceBoxHtml(b, true)).join("\n")
    : "";
  const refGhost = showGhost
    ? composed.reference_blocks.map((b) => referenceGhostTextHtml(b)).join("\n")
    : "";

  const layers = composed.text_layers.map(layerHtml).join("\n");

  const layerJson = JSON.stringify(
    composed.text_layers.map((l) => ({
      role: l.role,
      text: l.text,
      x_px: l.x_px,
      y_px: l.y_px,
      w_px: l.w_px,
      h_px: l.h_px,
      font_size_px: l.font_size_px,
      ref_font_size_px: l.ref_font_size_px,
      layout_mode: l.layout_mode,
    })),
    null,
    2
  );

  const refJson = JSON.stringify(composed.reference_blocks, null, 2);
  const debugLog = buildMimicTextOverlayDebugLog(composed, {
    description,
    taskId: opts.taskId,
    runId: opts.runId,
    llmSlide: opts.llmSlide,
  });

  const fitScript = interactive
    ? `
  function copyLabDebugLog() {
    var ta = document.getElementById("lab-debug-log-text");
    var hint = document.getElementById("lab-copy-debug-hint");
    if (!ta) return;
    var text = ta.value || ta.textContent || "";
    function ok() {
      if (hint) { hint.textContent = "Copied debug log"; setTimeout(function(){ hint.textContent = ""; }, 2500); }
    }
    function fail(e) {
      if (hint) hint.textContent = e && e.message ? e.message : "Copy failed";
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(ok).catch(function(){
        ta.focus(); ta.select();
        try { document.execCommand("copy"); ok(); } catch (e) { fail(e); }
      });
    } else {
      ta.focus(); ta.select();
      try { document.execCommand("copy"); ok(); } catch (e) { fail(e); }
    }
  }
  function applyLabPreviewScale() {
    var scale = Number(document.getElementById("lab-preview-scale")?.value || 40) / 100;
    document.documentElement.style.setProperty("--lab-preview-scale", String(scale));
    var label = document.getElementById("lab-preview-scale-label");
    if (label) label.textContent = Math.round(scale * 100) + "%";
  }
  const fitDocAiTextLayersToBoxesInPage = ${mimicDocAiFitPageFnSource()};
  function fitDocAiTextLayersToBoxes() {
    fitDocAiTextLayersToBoxesInPage(14, 38);
  }
  ${mimicDocAiContrastPageFnSource()}
  async function refitLabLayers() {
    fitDocAiTextLayersToBoxes();
    await adaptMimicDocAiTextContrastInPage();
  }
  applyLabPreviewScale();
  refitLabLayers();
  document.getElementById("lab-preview-scale")?.addEventListener("input", applyLabPreviewScale);
  document.getElementById("btn-refit")?.addEventListener("click", () => { refitLabLayers(); });
  document.getElementById("btn-copy-debug-log")?.addEventListener("click", copyLabDebugLog);
  document.getElementById("chk-boxes")?.addEventListener("change", (e) => {
    document.querySelectorAll(".ref-debug-box").forEach((n) => {
      n.style.display = e.target.checked ? "" : "none";
    });
  });
  document.getElementById("chk-ghost")?.addEventListener("change", (e) => {
    document.querySelectorAll(".ref-debug-text").forEach((n) => {
      n.style.display = e.target.checked ? "" : "none";
    });
  });
`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    ${DOC_AI_PREVIEW_CSS}
    :root {
      --paper: ${theme.paper};
      --ink: ${theme.ink};
      --body: ${theme.body};
    }
  </style>
</head>
<body>
  <div class="lab-shell">
    <aside class="lab-panel">
      <h1>${escapeHtml(title)}</h1>
      ${description ? `<p>${escapeHtml(description)}</p>` : ""}
      <p>Canvas ${CAROUSEL_RENDER_WIDTH_PX}×${CAROUSEL_RENDER_HEIGHT_PX}px — same as carousel renderer.</p>
      <h2>Stored images</h2>
      ${plateRefsHtml}
      <h2>Debug</h2>
      <label><input type="checkbox" id="chk-boxes"${showBoxes ? " checked" : ""}> Render target boxes (red)</label>
      <label><input type="checkbox" id="chk-ghost"${showGhost ? " checked" : ""}> Reference text ghost (faded original OCR)</label>
      <div class="lab-scale-control">
        <label for="lab-preview-scale">Preview zoom</label>
        <input type="range" id="lab-preview-scale" min="25" max="100" value="40" step="5">
        <span id="lab-preview-scale-label">40%</span>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:8px">
        <button type="button" id="btn-refit" style="padding:6px 12px;border-radius:6px;border:1px solid #3f3f46;background:#27272a;color:#fafafa;cursor:pointer">Re-run shrink-to-fit</button>
        <button type="button" id="btn-copy-debug-log" style="padding:6px 12px;border-radius:6px;border:1px solid #3f3f46;background:#1e3a5f;color:#e0f2fe;cursor:pointer">Copy debug log</button>
        <span id="lab-copy-debug-hint" style="font-size:12px;color:#71717a"></span>
      </div>
      <textarea id="lab-debug-log-text" readonly style="position:absolute;left:-9999px;width:1px;height:1px;opacity:0" aria-hidden="true">${escapeHtml(debugLog)}</textarea>
      <h2>Copy mapping summary</h2>
      <pre style="max-height:180px">${escapeHtml(
        composed.text_layers
          .map((layer, i) => {
            const ref = findReferenceBlockForLayer(layer, composed.reference_blocks);
            return `${i + 1}. [${layer.role}] ${JSON.stringify(ref?.text ?? "?")} → ${JSON.stringify(layer.text)}`;
          })
          .join("\n") || "(no layers)"
      )}</pre>
      <h2>LLM layers (${composed.text_layers.length})</h2>
      <pre>${escapeHtml(layerJson)}</pre>
      <h2>Reference blocks (${composed.reference_blocks.length})</h2>
      <pre>${escapeHtml(refJson)}</pre>
    </aside>
    <div class="lab-canvas-wrap">
      <div class="lab-canvas-scaler">
        <div class="slide mimic-docai-slide">
          ${bgImg || (bgStyle ? `<div class="slide-bg" style="${bgStyle}"></div>` : `<div class="slide-bg"></div>`)}
          <div class="page mimic-docai-layers${composed.render_context.mimic_avoid_center_subject ? " mimic-docai-avoid-center" : ""}">
            ${refGhost}
            ${refBoxes}
            ${layers}
          </div>
        </div>
      </div>
      <p class="scale-hint">Canvas is 1080×1350 at 100% — use preview zoom to fit your screen</p>
    </div>
  </div>
  <script>${fitScript}</script>
</body>
</html>`;
}
