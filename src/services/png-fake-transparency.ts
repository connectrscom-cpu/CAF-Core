import sharp from "sharp";
import {
  detectFakeTransparencyCheckerboard,
  stripCheckerboardFillFromRgba,
} from "../domain/png-fake-transparency.js";

export type StripFakeTransparencyResult = {
  buffer: Buffer;
  /** Whether checkerboard pixels were removed. */
  stripped: boolean;
  /** Pixels made transparent (0 when not stripped). */
  pixelsChanged: number;
};

/**
 * When an overlay PNG has a baked editor checkerboard instead of alpha, convert those
 * pixels to true transparency so frames/mascots composite correctly on slides.
 */
export async function stripFakeTransparencyFromPng(input: Buffer): Promise<StripFakeTransparencyResult> {
  if (!input.length) return { buffer: input, stripped: false, pixelsChanged: 0 };

  let meta: sharp.Metadata;
  try {
    meta = await sharp(input).metadata();
  } catch {
    return { buffer: input, stripped: false, pixelsChanged: 0 };
  }
  if (meta.format !== "png" || !meta.width || !meta.height) {
    return { buffer: input, stripped: false, pixelsChanged: 0 };
  }

  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  if (info.channels !== 4) return { buffer: input, stripped: false, pixelsChanged: 0 };

  if (!detectFakeTransparencyCheckerboard(data, info.width, info.height)) {
    return { buffer: input, stripped: false, pixelsChanged: 0 };
  }

  const pixelsChanged = stripCheckerboardFillFromRgba(data, info.width, info.height);
  if (pixelsChanged === 0) return { buffer: input, stripped: false, pixelsChanged: 0 };

  const out = await sharp(Buffer.from(data), {
    raw: { width: info.width, height: info.height, channels: 4 },
  })
    .png()
    .toBuffer();

  return { buffer: out, stripped: true, pixelsChanged };
}
