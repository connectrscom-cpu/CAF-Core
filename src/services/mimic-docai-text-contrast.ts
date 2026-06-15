/** Shared contrast math for mimic Document AI overlays (tested; renderer mirrors in mimic-docai-contrast.js). */

export const MIMIC_DOCAI_CONTRAST_LUMINANCE_THRESHOLD = 0.56;

export function relativeLuminance01(r: number, g: number, b: number): number {
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrastingTextStyleForLuminance(lum: number): {
  color: string;
  textShadow: string;
} {
  if (lum >= MIMIC_DOCAI_CONTRAST_LUMINANCE_THRESHOLD) {
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
