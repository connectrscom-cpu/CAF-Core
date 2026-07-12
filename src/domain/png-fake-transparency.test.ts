import { describe, expect, it } from "vitest";
import {
  detectFakeTransparencyCheckerboard,
  isCheckerboardFillRgb,
  stripCheckerboardFillFromRgba,
} from "./png-fake-transparency.js";

describe("png-fake-transparency", () => {
  it("detects common checkerboard fill colors", () => {
    expect(isCheckerboardFillRgb(255, 255, 255)).toBe(true);
    expect(isCheckerboardFillRgb(204, 204, 204)).toBe(true);
    expect(isCheckerboardFillRgb(0, 180, 90)).toBe(false);
  });

  it("detects baked checkerboard in center region", () => {
    const w = 100;
    const h = 100;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const light = (x + y) % 2 === 0;
        rgba[i] = light ? 255 : 204;
        rgba[i + 1] = light ? 255 : 204;
        rgba[i + 2] = light ? 255 : 204;
        rgba[i + 3] = 255;
      }
    }
    expect(detectFakeTransparencyCheckerboard(rgba, w, h)).toBe(true);
  });

  it("strips checkerboard fill to alpha 0", () => {
    const w = 4;
    const h = 4;
    const rgba = new Uint8Array([
      255, 255, 255, 255, 204, 204, 204, 255, 255, 255, 255, 255, 204, 204, 204, 255,
      204, 204, 204, 255, 255, 255, 255, 255, 204, 204, 204, 255, 255, 255, 255, 255,
      255, 255, 255, 255, 204, 204, 204, 255, 255, 255, 255, 255, 204, 204, 204, 255,
      204, 204, 204, 255, 255, 255, 255, 255, 204, 204, 204, 255, 255, 255, 255, 255,
    ]);
    const changed = stripCheckerboardFillFromRgba(rgba, w, h);
    expect(changed).toBe(16);
    expect(rgba.every((_, idx) => idx % 4 !== 3 || rgba[idx] === 0)).toBe(true);
  });

  it("does not flag solid decorative border colors as checkerboard", () => {
    const w = 20;
    const h = 20;
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        rgba[i] = 155;
        rgba[i + 1] = 200;
        rgba[i + 2] = 80;
        rgba[i + 3] = 255;
      }
    }
    expect(detectFakeTransparencyCheckerboard(rgba, w, h)).toBe(false);
  });
});
