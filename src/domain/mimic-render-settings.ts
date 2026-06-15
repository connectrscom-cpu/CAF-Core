/** Server + project defaults for top-performer mimic render knobs. */

export const DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT = 70;
export const MIN_MIMIC_VISUAL_SIMILARITY_PCT = 0;
export const MAX_MIMIC_VISUAL_SIMILARITY_PCT = 100;

export function clampMimicVisualSimilarityPct(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT;
  return Math.min(MAX_MIMIC_VISUAL_SIMILARITY_PCT, Math.max(MIN_MIMIC_VISUAL_SIMILARITY_PCT, Math.round(raw)));
}

export function parseProjectMimicVisualSimilarityPct(raw: unknown): number | null {
  if (raw === "" || raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return clampMimicVisualSimilarityPct(n);
}

export function effectiveMimicVisualSimilarityPct(
  projectPct: number | null | undefined,
  envDefault: number
): number {
  if (projectPct != null && Number.isFinite(projectPct)) {
    return clampMimicVisualSimilarityPct(projectPct);
  }
  return clampMimicVisualSimilarityPct(envDefault);
}

/** ≤25% — bold reinterpretation; skip palette/composition lock hints that fight the variant prompt. */
export function isBoldMimicVisualVariant(pct: number): boolean {
  return clampMimicVisualSimilarityPct(pct) <= 25;
}

export function parseProjectMimicCarouselTextViaFlux(raw: unknown): boolean | null {
  if (raw === "" || raw === null || raw === undefined) return null;
  if (raw === true || raw === 1 || raw === "1" || raw === "true") return true;
  if (raw === false || raw === 0 || raw === "0" || raw === "false") return false;
  return null;
}

export function effectiveMimicCarouselTextViaFlux(
  projectValue: boolean | null | undefined,
  envDefault: boolean
): boolean {
  if (projectValue === true || projectValue === false) return projectValue;
  return envDefault;
}

/** Bold variants: new visual plate only — copy is never baked by Flux. */
export const MIMIC_BOLD_VARIANT_SAME_COPY_INSTRUCTION =
  "Generate a new art-only visual plate for this slide; editorial copy is added later via HTML/CSS overlay, never in the image.";

export function buildVisualVariantSimilarityInstruction(pct: number): string {
  const n = clampMimicVisualSimilarityPct(pct);
  if (n <= 25) {
    return (
      `Make a new slide like this reference (~${n}% visual similarity): same slide role, series mood, and general feel — ` +
      "but it does not need to be the same photo, scene, or exact styling. Fresh composition and imagery inspired by the reference, not a reshoot or near-duplicate."
    );
  }
  if (n >= 85) {
    return (
      `Recreate this slide staying very close to the reference (~${n}% visual similarity): ` +
      "match non-text layout structure, composition, palette, and visual elements closely; only subtle art-direction variation so it is not an exact pixel clone. " +
      "Do not reproduce reference typography — all copy is overlaid later."
    );
  }
  return (
    `Recreate this carousel slide as a creative variant (~${n}% visual similarity to the reference): ` +
    "keep the same narrative role and non-text layout structure, but change art direction enough that it reads as a fresh post in the same series — " +
    "alternate composition, palette, or styling; not a pixel-match clone. Do not reproduce reference typography."
  );
}
