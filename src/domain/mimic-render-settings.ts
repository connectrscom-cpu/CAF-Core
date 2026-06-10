/** Server + project defaults for top-performer mimic render knobs. */

export const DEFAULT_MIMIC_VISUAL_SIMILARITY_PCT = 70;
export const MIN_MIMIC_VISUAL_SIMILARITY_PCT = 50;
export const MAX_MIMIC_VISUAL_SIMILARITY_PCT = 95;

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

export function buildVisualVariantSimilarityInstruction(pct: number): string {
  const n = clampMimicVisualSimilarityPct(pct);
  return (
    `Recreate this carousel slide as a creative variant (~${n}% visual similarity to the reference): ` +
    "keep the same narrative role and layout structure, but change art direction enough that it reads as a fresh post in the same series — " +
    "alternate composition, palette, or styling; not a pixel-match clone."
  );
}
