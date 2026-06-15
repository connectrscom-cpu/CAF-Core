/**
 * Browser-only contrast pass for mimic Document AI layers (lab preview iframe).
 * Self-contained — embedded via .toString() in lab HTML (no imports in the function body).
 * Renderer twin: services/renderer/mimic-docai-contrast.js
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function adaptMimicDocAiTextContrastInPage(): Promise<void> {
  const CANVAS_W = 1080;
  const CANVAS_H = 1350;
  const LUM_THRESHOLD = 0.56;

  function relativeLuminance(r: number, g: number, b: number): number {
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

  function parseCssColor(raw: string): { r: number; g: number; b: number } | null {
    const s = String(raw ?? "").trim();
    if (!s) return null;
    const hex = s.match(/^#([0-9a-f]{3,8})$/i);
    if (hex) {
      let h = hex[1]!;
      if (h.length === 3) h = h.split("").map((c) => c + c).join("");
      const n = parseInt(h.slice(0, 6), 16);
      return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
    }
    const rgb = s.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (rgb) {
      return { r: Number(rgb[1]) / 255, g: Number(rgb[2]) / 255, b: Number(rgb[3]) / 255 };
    }
    return null;
  }

  function contrastStyleForLuminance(lum: number): { color: string; textShadow: string } {
    if (lum >= LUM_THRESHOLD) {
      return {
        color: "#1c1c1e",
        textShadow: "0 1px 8px rgba(255,255,255,0.55), 0 0 2px rgba(255,255,255,0.45)",
      };
    }
    return {
      color: "#ffffff",
      textShadow: "0 1px 10px rgba(0,0,0,0.52), 0 0 2px rgba(0,0,0,0.4)",
    };
  }

  function parseBackgroundImageUrl(bgImageCss: string): string | null {
    const m = /url\(["']?([^"')]+)["']?\)/i.exec(String(bgImageCss ?? ""));
    return m ? m[1]! : null;
  }

  function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("background load failed"));
      img.src = url;
    });
  }

  function avgLuminanceInRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number
  ): number | null {
    const ix = Math.max(0, Math.floor(x));
    const iy = Math.max(0, Math.floor(y));
    const iw = Math.max(1, Math.min(CANVAS_W - ix, Math.floor(w)));
    const ih = Math.max(1, Math.min(CANVAS_H - iy, Math.floor(h)));
    const stepsX = Math.min(12, Math.max(3, Math.floor(iw / 20)));
    const stepsY = Math.min(12, Math.max(3, Math.floor(ih / 20)));
    let sum = 0;
    let count = 0;
    for (let si = 0; si < stepsX; si++) {
      for (let sj = 0; sj < stepsY; sj++) {
        const px = Math.min(CANVAS_W - 1, ix + Math.floor(((si + 0.5) / stepsX) * iw));
        const py = Math.min(CANVAS_H - 1, iy + Math.floor(((sj + 0.5) / stepsY) * ih));
        const data = ctx.getImageData(px, py, 1, 1).data;
        const a = data[3]! / 255;
        if (a < 0.08) continue;
        sum += relativeLuminance(data[0]! / 255, data[1]! / 255, data[2]! / 255);
        count++;
      }
    }
    return count > 0 ? sum / count : null;
  }

  async function buildBackgroundSampler(
    slideEl: Element
  ): Promise<((x: number, y: number, w: number, h: number) => number | null) | null> {
    const bgEl = slideEl.querySelector(".slide-bg");
    const url =
      bgEl &&
      parseBackgroundImageUrl(
        (bgEl as HTMLElement).style.backgroundImage ||
          getComputedStyle(bgEl).backgroundImage
      );

    if (url) {
      try {
        const img = await loadImage(url);
        const canvas = document.createElement("canvas");
        canvas.width = CANVAS_W;
        canvas.height = CANVAS_H;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.drawImage(img, 0, 0, CANVAS_W, CANVAS_H);
        return (x, y, w, h) => avgLuminanceInRect(ctx, x, y, w, h);
      } catch {
        /* fall through to flat color */
      }
    }

    const slideBg = parseCssColor(getComputedStyle(slideEl as HTMLElement).backgroundColor);
    const pageBg = parseCssColor(
      getComputedStyle(slideEl.querySelector(".page") || slideEl).backgroundColor
    );
    const paper = parseCssColor(
      getComputedStyle(document.documentElement).getPropertyValue("--paper")
    );
    const rgb = slideBg || pageBg || paper;
    if (!rgb) return null;
    const lum = relativeLuminance(rgb.r, rgb.g, rgb.b);
    return () => lum;
  }

  const slides = document.querySelectorAll(".slide.mimic-docai-slide, .slide");
  for (const slideEl of slides) {
    const layers = slideEl.querySelectorAll(".mimic-docai-layer");
    if (layers.length === 0) continue;

    const sample = await buildBackgroundSampler(slideEl);
    if (!sample) continue;

    for (const el of layers) {
      const style = (el as HTMLElement).style;
      const x = parseFloat(style.left);
      const y = parseFloat(style.top);
      const w = parseFloat(style.width);
      const h = parseFloat(style.height);
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(w) || !Number.isFinite(h)) continue;

      const lum = sample(x, y, w, h);
      if (lum == null || !Number.isFinite(lum)) continue;

      const picked = contrastStyleForLuminance(lum);
      style.color = picked.color;
      style.textShadow = picked.textShadow;
      el.classList.add("mimic-docai-layer--contrast-adapted");
    }
  }
}

/** Serialized for inline <script> in lab preview HTML. */
export function mimicDocAiContrastPageFnSource(): string {
  return adaptMimicDocAiTextContrastInPage.toString();
}
