/**
 * Carousel body copy length targets from `caf_core.platform_constraints` (`slide_min_chars` / `slide_max_chars`)
 * with optional multipliers for editorial rework (e.g. 2× depth or tighter short-form).
 */

/** When `platform_constraints.slide_*_chars` are unset — ~1.5× prior defaults (editorial depth bar). */
export const DEFAULT_CAROUSEL_SLIDE_BODY_MIN_CHARS = 240;
export const DEFAULT_CAROUSEL_SLIDE_BODY_MAX_CHARS = 780;

export type CarouselBodyCharTargets = {
  /** Multiplier applied to base min/max (1 = use platform row as-is). */
  scale: number;
  /** After scaling (rounded). */
  effective_min_chars: number;
  effective_max_chars: number;
  /** Raw platform row values before scaling (null = default fallback used). */
  base_slide_min_chars: number | null;
  base_slide_max_chars: number | null;
  slide_min: number | null;
  slide_max: number | null;
};

function clampInt(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, Math.round(n)));
}

/**
 * Accepts rework overrides: `2`, `"2"`, `"2x"`, `0.5`, `"half"`, `"0.5x"`.
 * Returns a positive finite multiplier; invalid → 1.
 */
export function parseCarouselBodyCharScale(raw: unknown): number {
  if (raw === undefined || raw === null || raw === "") return 1;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) return raw;
  const s = String(raw).trim().toLowerCase();
  if (!s) return 1;
  if (s === "half" || s === "½") return 0.5;
  const m = s.match(/^([\d.]+)\s*x$/);
  if (m?.[1]) {
    const v = Number(m[1]);
    return Number.isFinite(v) && v > 0 ? v : 1;
  }
  const n = Number(s.replace(/x$/i, "").trim());
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function pickInt(pc: Record<string, unknown>, key: string): number | null {
  const v = pc[key];
  if (v === undefined || v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/**
 * Resolve per-slide body character targets from merged `platform_constraints` plus scale.
 * Uses `slide_min_chars` / `slide_max_chars`; when missing, falls back to defaults above.
 */
export function resolveCarouselBodyCharTargets(
  platformConstraints: unknown,
  scaleRaw: number
): CarouselBodyCharTargets {
  const pc =
    platformConstraints && typeof platformConstraints === "object" && !Array.isArray(platformConstraints)
      ? (platformConstraints as Record<string, unknown>)
      : {};

  const scale = Number.isFinite(scaleRaw) && scaleRaw > 0 ? scaleRaw : 1;

  let baseMin = pickInt(pc, "slide_min_chars");
  let baseMax = pickInt(pc, "slide_max_chars");

  if (baseMin != null && baseMax != null && baseMin > baseMax) {
    const t = baseMin;
    baseMin = baseMax;
    baseMax = t;
  }

  const effMinRaw =
    baseMin != null ? baseMin * scale : DEFAULT_CAROUSEL_SLIDE_BODY_MIN_CHARS * scale;
  const effMaxRaw =
    baseMax != null ? baseMax * scale : DEFAULT_CAROUSEL_SLIDE_BODY_MAX_CHARS * scale;

  let effective_min_chars = clampInt(effMinRaw, 40, 4000);
  let effective_max_chars = clampInt(effMaxRaw, 60, 8000);
  if (effective_min_chars > effective_max_chars) {
    const mid = Math.round((effective_min_chars + effective_max_chars) / 2);
    effective_min_chars = clampInt(mid - 40, 40, effective_max_chars);
    effective_max_chars = clampInt(mid + 40, effective_min_chars, 8000);
  }

  return {
    scale,
    effective_min_chars,
    effective_max_chars,
    base_slide_min_chars: baseMin,
    base_slide_max_chars: baseMax,
    slide_min: pickInt(pc, "slide_min"),
    slide_max: pickInt(pc, "slide_max"),
  };
}

export function buildCarouselBodyLengthSystemBlock(targets: CarouselBodyCharTargets): string {
  const lines = [
    "Carousel body copy length (platform + rework scale):",
    `- **Applied scale:** ${targets.scale === 1 ? "1× (platform defaults as configured)" : `${targets.scale}×`} vs platform \`slide_min_chars\` / \`slide_max_chars\`.`,
    `- **Target body slide length (characters per slide \`body\` field, excluding headline):** aim for **${targets.effective_min_chars}–${targets.effective_max_chars}** chars.`,
    `- **Cover subtitle length:** cover \`body\` / \`cover_subtitle\` must be **1–2 sentences**, not a paragraph. Rewrite shorter if needed; do not truncate mid-thought.`,
    `- **Slide deck size:** obey \`platform_constraints.slide_min\` / \`slide_max\` when set (merged into your creation_pack as \`platform_constraints\`).`,
    `- **Horoscope / sign lists:** pick a **deliberate structure** (e.g. full wheel order, one sign per slide, or a stated subset); do not randomize signs unless the brief asks for variety.`,
    `- **Campaign fit:** do **not** frame content as an app/product launch unless the candidate or signal_pack explicitly describes that campaign. Non-product editorial runs must not invent “download the app”, “sign up”, or similar unless real.`,
    `- **Single visible @handle on the CTA slide:** put the project @handle in **one** place only—either the dedicated handle field **or** the final CTA body line—not duplicated.`,
  ];
  return lines.join("\n");
}
