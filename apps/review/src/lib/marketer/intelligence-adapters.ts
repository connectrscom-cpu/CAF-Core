import type { MarketInsight, MarketInsightCategory } from "./types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

const KEYWORD_CATEGORY: Array<[RegExp, MarketInsightCategory]> = [
  [/hook|opening|first line/i, "strong_hook"],
  [/format|carousel|video|reel|thread/i, "winning_format"],
  [/visual|design|color|layout|aesthetic/i, "visual_pattern"],
  [/trend|emerging|rising|new/i, "emerging_trend"],
  [/opportunity|underused|gap|whitespace/i, "opportunity"],
  [/saturated|overused|crowded|fatigue/i, "saturated_angle"],
  [/recommend|should|direction|next/i, "recommended_direction"],
];

function categorize(title: string, body: string): MarketInsightCategory {
  const text = `${title} ${body}`;
  for (const [re, cat] of KEYWORD_CATEGORY) {
    if (re.test(text)) return cat;
  }
  return "winning_pattern";
}

export const INSIGHT_CATEGORY_LABELS: Record<MarketInsightCategory, string> = {
  winning_pattern: "Winning patterns",
  winning_format: "Winning formats",
  strong_hook: "Strong hooks",
  visual_pattern: "Visual patterns",
  emerging_trend: "Emerging trends",
  opportunity: "Underused opportunities",
  saturated_angle: "Saturated angles",
  recommended_direction: "Recommended directions",
};

export const INSIGHT_CATEGORY_ORDER: MarketInsightCategory[] = [
  "recommended_direction",
  "winning_pattern",
  "winning_format",
  "strong_hook",
  "visual_pattern",
  "emerging_trend",
  "opportunity",
  "saturated_angle",
];

export function toMarketInsight(row: Record<string, unknown>, index: number): MarketInsight {
  const title = str(row.title) || str(row.insight_id) || "Insight";
  const body = str(row.body) || str(row.summary);
  const derived = Array.isArray(row.derived_from_observation_ids)
    ? row.derived_from_observation_ids.length
    : 0;
  return {
    id: str(row.insight_id) || str(row.id) || `insight_${index}`,
    category: categorize(title, body),
    title,
    summary: body,
    evidenceCount: derived,
    confidence: num(row.confidence),
  };
}

export function toMarketInsights(rows: Record<string, unknown>[]): MarketInsight[] {
  return rows
    .filter((r) => !!r && typeof r === "object")
    .map((r, i) => toMarketInsight(r, i));
}

export function groupInsights(insights: MarketInsight[]): Array<{
  category: MarketInsightCategory;
  label: string;
  items: MarketInsight[];
}> {
  const byCat = new Map<MarketInsightCategory, MarketInsight[]>();
  for (const ins of insights) {
    if (!byCat.has(ins.category)) byCat.set(ins.category, []);
    byCat.get(ins.category)!.push(ins);
  }
  return INSIGHT_CATEGORY_ORDER.filter((c) => byCat.has(c)).map((category) => ({
    category,
    label: INSIGHT_CATEGORY_LABELS[category],
    items: byCat.get(category)!,
  }));
}
