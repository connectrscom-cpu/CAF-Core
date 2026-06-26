import type { FormatIntelligence, HashtagInsight, MarketInsight, MarketInsightCategory } from "./types";
import { INSIGHT_CATEGORY_LABELS, INSIGHT_CATEGORY_ORDER, toMarketInsights } from "./intelligence-adapters";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

const FORMAT_LABEL: Record<string, string> = {
  carousel: "Carousel",
  video: "Video",
  reel: "Reel",
  image: "Image",
  post: "Post",
};

function humanFormat(key: string): string {
  const k = key.toLowerCase();
  return FORMAT_LABEL[k] ?? key.replace(/_/g, " ");
}

export function parseFormatIntelligence(
  signalPack: Record<string, unknown> | null | undefined
): FormatIntelligence[] {
  const derived = asRecord(signalPack?.derived_globals_json);
  const vg = asRecord(derived?.visual_guidelines_pack_v1);
  const byFormat = asArray(vg?.visual_guideline_cues_by_format);
  const out: FormatIntelligence[] = [];

  for (const raw of byFormat) {
    const g = asRecord(raw);
    if (!g) continue;
    const formatKey = str(g.format_key) || str(g.format_pattern) || "unknown";
    const cues = asArray(g.cues).map((x) => str(x)).filter(Boolean);
    if (!cues.length) continue;
    out.push({
      formatKey,
      label: humanFormat(formatKey),
      cues: cues.slice(0, 8),
      platform: str(g.platform) || null,
    });
  }

  const globalCues = asArray(vg?.visual_guideline_cues).map((x) => str(x)).filter(Boolean);
  if (globalCues.length && !out.length) {
    out.push({
      formatKey: "all",
      label: "All formats",
      cues: globalCues.slice(0, 10),
      platform: null,
    });
  }

  const stylingCues = asArray(derived?.top_performer_styling_cues_v1).map((x) => str(x)).filter(Boolean);
  if (stylingCues.length) {
    out.push({
      formatKey: "top_performer",
      label: "Top performer styling",
      cues: stylingCues.slice(0, 10),
      platform: null,
    });
  }

  return out;
}

export function hashtagsToInsights(tags: HashtagInsight[]): MarketInsight[] {
  return tags.slice(0, 12).map((t, i) => ({
    id: `hashtag_${i}_${t.hashtag}`,
    category: "winning_pattern" as MarketInsightCategory,
    title: t.hashtag,
    summary:
      t.avgScore != null
        ? `Used ${t.count}× in research · avg score ${Math.round(t.avgScore * 100) / 100}`
        : `Used ${t.count}× in your research window`,
    evidenceCount: t.count,
    confidence: t.avgScore,
  }));
}

export function formatCuesToInsights(formats: FormatIntelligence[]): MarketInsight[] {
  const out: MarketInsight[] = [];
  for (const f of formats) {
    for (const cue of f.cues.slice(0, 4)) {
      let category: MarketInsightCategory = "winning_format";
      if (/hook|opening|first/i.test(cue)) category = "strong_hook";
      else if (/trend|rising|emerging/i.test(cue)) category = "emerging_trend";
      else if (/controvers|polariz|debate/i.test(cue)) category = "saturated_angle";
      else if (/structure|layout|slide/i.test(cue)) category = "winning_pattern";
      out.push({
        id: `fmt_${f.formatKey}_${out.length}`,
        category,
        title: `${f.label}: ${cue.slice(0, 80)}`,
        summary: f.platform ? `Platform: ${f.platform}` : "From visual guidelines in your research brief",
        evidenceCount: 0,
        confidence: null,
      });
    }
  }
  return out;
}

export function mergeIntelligenceSources(
  learningRows: Record<string, unknown>[],
  signalPack: Record<string, unknown> | null | undefined,
  hashtags: HashtagInsight[]
): MarketInsight[] {
  const fromLearning = toMarketInsights(learningRows);
  const fromFormats = formatCuesToInsights(parseFormatIntelligence(signalPack));
  const fromTags = hashtagsToInsights(hashtags);

  const seen = new Set<string>();
  const merged: MarketInsight[] = [];
  for (const ins of [...fromLearning, ...fromFormats, ...fromTags]) {
    const key = `${ins.category}:${ins.title}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(ins);
  }
  return merged;
}

export { INSIGHT_CATEGORY_LABELS, INSIGHT_CATEGORY_ORDER };
