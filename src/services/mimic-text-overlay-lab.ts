import type { MimicPayloadV1 } from "../domain/mimic-payload.js";
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
  llm_slide: Record<string, unknown>;
  mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans">;
};

export type MimicTextOverlayLabComposeOpts = {
  mimic: Pick<MimicPayloadV1, "visual_guideline" | "reference_items" | "slide_plans">;
  slideIndex: number;
  llmSlide: Record<string, unknown>;
  backgroundImageUrl?: string | null;
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
  const text_layers = buildMimicDocAiRenderTextLayers(opts.mimic, slideIndex, opts.llmSlide, {
    ink: theme.ink,
    body: theme.body,
  });

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
  .lab-canvas-wrap {
    flex: 0 0 auto;
    background: #18181f;
    border: 1px solid #2c2c36;
    border-radius: 12px;
    padding: 16px;
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
  .slide-bg {
    position: absolute;
    inset: 0;
    z-index: 0;
    background-color: var(--paper);
    background-size: 100% 100%;
    background-position: top left;
    background-repeat: no-repeat;
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
  .mimic-docai-layer--single-line { display: flex; align-items: center; }
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
    opacity: 0.35;
    pointer-events: none;
    overflow: hidden;
    color: #ff6b6b;
    text-shadow: none;
  }
  .scale-hint {
    margin-top: 10px;
    font-size: 12px;
    color: #71717a;
    text-align: center;
  }
`;

function layerHtml(layer: MimicDocAiRenderTextLayer): string {
  return `<div class="mimic-docai-layer mimic-docai-layer--${escapeHtml(layer.role)} ${layer.layout_class}" style="${layer.css_style}">${escapeHtml(layer.text)}</div>`;
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
  const fs = block.font_size_px ?? Math.max(12, Math.round(block.h_px * 0.75));
  return `<div class="ref-debug-text" style="left:${block.x_px}px;top:${block.y_px}px;width:${block.w_px}px;height:${block.h_px}px;font-size:${fs}px;color:${block.color_hex ?? "#ff6b6b"}">${escapeHtml(block.text)}</div>`;
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
};

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

  const bg = composed.render_context.background_image_url;
  const bgStyle = typeof bg === "string" && bg.trim() ? `background-image:url('${escapeHtml(bg.trim())}');` : "";

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
      layout_mode: l.layout_mode,
    })),
    null,
    2
  );

  const refJson = JSON.stringify(composed.reference_blocks, null, 2);

  const fitScript = interactive
    ? `
  function fitDocAiTextLayersToBoxes() {
    const layers = document.querySelectorAll(".mimic-docai-layer");
    for (const el of layers) {
      const style = el.style;
      const maxH = parseFloat(style.height);
      const maxW = parseFloat(style.width);
      if (!Number.isFinite(maxH) || !Number.isFinite(maxW) || maxH <= 0 || maxW <= 0) continue;
      let fs = parseFloat(getComputedStyle(el).fontSize);
      if (!Number.isFinite(fs) || fs <= 0) continue;
      const minFs = 10;
      let guard = 0;
      while (guard++ < 140 && fs > minFs && (el.scrollHeight > maxH + 2 || el.scrollWidth > maxW + 2)) {
        fs -= 1;
        style.fontSize = fs + "px";
      }
    }
  }
  fitDocAiTextLayersToBoxes();
  document.getElementById("btn-refit")?.addEventListener("click", fitDocAiTextLayersToBoxes);
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
      <h2>Debug</h2>
      <label><input type="checkbox" id="chk-boxes" checked> Reference OCR boxes (red)</label>
      <label><input type="checkbox" id="chk-ghost"> Reference text ghost (faded)</label>
      <button type="button" id="btn-refit" style="margin-top:8px;padding:6px 12px;border-radius:6px;border:1px solid #3f3f46;background:#27272a;color:#fafafa;cursor:pointer">Re-run shrink-to-fit</button>
      <h2>LLM layers (${composed.text_layers.length})</h2>
      <pre>${escapeHtml(layerJson)}</pre>
      <h2>Reference blocks (${composed.reference_blocks.length})</h2>
      <pre>${escapeHtml(refJson)}</pre>
    </aside>
    <div class="lab-canvas-wrap">
      <div class="slide mimic-docai-slide">
        ${bgStyle ? `<div class="slide-bg" style="${bgStyle}"></div>` : `<div class="slide-bg"></div>`}
        <div class="page mimic-docai-layers">
          ${refGhost}
          ${refBoxes}
          ${layers}
        </div>
      </div>
      <p class="scale-hint">1:1 render size — zoom browser to inspect pixel alignment</p>
    </div>
  </div>
  <script>${fitScript}</script>
</body>
</html>`;
}
