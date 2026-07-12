/**
 * Detect and strip editor-style checkerboard pixels baked into AI-generated PNGs
 * (ChatGPT/DALL·E often draw gray/white squares instead of a real alpha channel).
 */

/** Common Photoshop/Figma/ChatGPT "transparent" preview swatches (neutral grays + white). */
export const CHECKERBOARD_FILL_RGB: ReadonlyArray<readonly [number, number, number]> = [
  [255, 255, 255],
  [238, 238, 238],
  [204, 204, 204],
  [216, 216, 216],
  [192, 192, 192],
  [187, 187, 187],
  [170, 170, 170],
  [128, 128, 128],
];

export function isNeutralGrayPixel(r: number, g: number, b: number, maxSpread = 15): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) <= maxSpread;
}

export function isCheckerboardFillRgb(r: number, g: number, b: number, tolerance = 14): boolean {
  if (!isNeutralGrayPixel(r, g, b)) return false;
  return CHECKERBOARD_FILL_RGB.some(
    ([cr, cg, cb]) =>
      Math.abs(r - cr) <= tolerance && Math.abs(g - cg) <= tolerance && Math.abs(b - cb) <= tolerance
  );
}

/** True when the inner region looks like a baked checkerboard (not real transparency). */
export function detectFakeTransparencyCheckerboard(
  rgba: Uint8Array | Buffer,
  width: number,
  height: number,
  opts?: { minCenterRatio?: number }
): boolean {
  const minCenterRatio = opts?.minCenterRatio ?? 0.12;
  const x0 = Math.floor(width * 0.18);
  const y0 = Math.floor(height * 0.18);
  const x1 = Math.floor(width * 0.82);
  const y1 = Math.floor(height * 0.82);
  let checker = 0;
  let total = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      if (isCheckerboardFillRgb(r, g, b)) checker++;
      total++;
    }
  }
  return total > 0 && checker / total >= minCenterRatio;
}

/** Mutates RGBA buffer in place — sets alpha=0 for checkerboard fill pixels. Returns count changed. */
export function stripCheckerboardFillFromRgba(
  rgba: Uint8Array | Buffer,
  width: number,
  height: number
): number {
  let changed = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const r = rgba[i]!;
      const g = rgba[i + 1]!;
      const b = rgba[i + 2]!;
      const a = rgba[i + 3]!;
      if (a === 0) continue;
      if (!isCheckerboardFillRgb(r, g, b)) continue;
      rgba[i + 3] = 0;
      changed++;
    }
  }
  return changed;
}
