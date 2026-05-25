import sharp from "sharp";
import type { AppConfig } from "../config.js";
import type { CarouselCompositeBackgroundPlate } from "../domain/carousel-composite-template.js";
import type {
  CarouselCompositeLayoutSpec,
  CarouselCompositeSlideRole,
  CarouselCompositeTheme,
} from "../domain/carousel-composite-layout.js";
import { downloadBufferFromUrl } from "./supabase-storage.js";
import {
  buildCompositeSlideSvgOverlay,
  type CompositeSlideTextInput,
} from "./carousel-composite-text.js";

async function loadBackgroundBuffer(
  config: AppConfig,
  plate: CarouselCompositeBackgroundPlate | null | undefined,
  theme: CarouselCompositeTheme,
  width: number,
  height: number
): Promise<Buffer> {
  const url = plate?.public_url?.trim();
  if (url) {
    try {
      const buf = await downloadBufferFromUrl(config, url);
      return sharp(buf).resize(width, height, { fit: "cover", position: "centre" }).png().toBuffer();
    } catch {
      /* fall through to solid */
    }
  }
  const paper = theme.paper.replace("#", "");
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: `#${paper}`,
    },
  })
    .png()
    .toBuffer();
}

export async function renderCompositeCarouselSlide(
  config: AppConfig,
  opts: {
    layout: CarouselCompositeLayoutSpec;
    theme: CarouselCompositeTheme;
    role: CarouselCompositeSlideRole;
    backgroundPlate?: CarouselCompositeBackgroundPlate | null;
    text: CompositeSlideTextInput;
  }
): Promise<{ buffer: Buffer; mimeType: string }> {
  const { layout, theme, role, backgroundPlate, text } = opts;
  const w = layout.canvas_width;
  const h = layout.canvas_height;

  const bg = await loadBackgroundBuffer(config, backgroundPlate, theme, w, h);
  const svg = buildCompositeSlideSvgOverlay(layout, theme, { ...text, role });
  const svgBuf = Buffer.from(svg);

  const buffer = await sharp(bg)
    .composite([{ input: svgBuf, top: 0, left: 0 }])
    .png()
    .toBuffer();

  return { buffer, mimeType: "image/png" };
}

export function pickBackgroundPlateForRole(
  plates: Partial<Record<CarouselCompositeSlideRole, CarouselCompositeBackgroundPlate>>,
  role: CarouselCompositeSlideRole
): CarouselCompositeBackgroundPlate | null {
  if (plates[role]) return plates[role]!;
  if (role === "body" && plates.cover) return plates.cover!;
  if (role === "cta" && plates.body) return plates.body!;
  if (plates.cover) return plates.cover!;
  return null;
}
