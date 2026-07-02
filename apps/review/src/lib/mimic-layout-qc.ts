/** Client-side helpers for `generation_payload.layout_qc` (mimic carousel). */

export type MimicLayoutSlideBadge = "pass" | "collision" | "overflow" | "missing" | "duplicate" | "contrast";

export type MimicLayoutSlideQcView = {
  slide_index: number;
  pass: boolean;
  score: number;
  badges: MimicLayoutSlideBadge[];
};

export type MimicLayoutQcView = {
  pass: boolean;
  overall_score: number;
  review_attention: boolean;
  block_review: boolean;
  slides: MimicLayoutSlideQcView[];
};

const BADGE_SET = new Set<string>(["pass", "collision", "overflow", "missing", "duplicate", "contrast"]);

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function parseMimicLayoutQcFromPayload(gp: unknown): MimicLayoutQcView | null {
  const root = asRecord(gp);
  const raw = root?.layout_qc;
  const rec = asRecord(raw);
  if (!rec || rec.schema_version !== "layout_qc_v1") return null;
  const slidesRaw = rec.slides;
  if (!slidesRaw || typeof slidesRaw !== "object" || Array.isArray(slidesRaw)) return null;
  const slides: MimicLayoutSlideQcView[] = [];
  for (const [key, row] of Object.entries(slidesRaw as Record<string, unknown>)) {
    const s = asRecord(row);
    if (!s) continue;
    const badges = Array.isArray(s.badges)
      ? s.badges.map((b) => String(b)).filter((b): b is MimicLayoutSlideBadge => BADGE_SET.has(b))
      : s.pass === true
        ? (["pass"] as MimicLayoutSlideBadge[])
        : [];
    slides.push({
      slide_index: Number(s.slide_index ?? key) || Number(key) || 1,
      pass: s.pass === true,
      score: typeof s.score === "number" ? s.score : 0,
      badges,
    });
  }
  slides.sort((a, b) => a.slide_index - b.slide_index);
  return {
    pass: rec.pass === true,
    overall_score: typeof rec.overall_score === "number" ? rec.overall_score : 0,
    review_attention: rec.review_attention === true || rec.block_review === true,
    block_review: rec.block_review === true,
    slides,
  };
}

export function layoutBadgeLabel(badge: MimicLayoutSlideBadge): string {
  switch (badge) {
    case "pass":
      return "Pass";
    case "collision":
      return "Collision";
    case "overflow":
      return "Overflow";
    case "missing":
      return "Missing";
    case "duplicate":
      return "Duplicate";
    case "contrast":
      return "Contrast";
    default:
      return badge;
  }
}

export function layoutBadgeEmoji(badge: MimicLayoutSlideBadge): string {
  switch (badge) {
    case "pass":
      return "✓";
    case "collision":
      return "⚠";
    case "overflow":
      return "⚠";
    case "missing":
      return "⚠";
    case "duplicate":
      return "⚠";
    case "contrast":
      return "⚠";
    default:
      return "·";
  }
}
