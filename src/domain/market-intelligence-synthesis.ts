/**
 * Aggregates row-level evidence insights into marketer-facing market intelligence
 * (patterns across multiple posts, not one card per scraped row).
 */
import { buildInsightReadModelItem, type InsightReadModelItem, type InsightReadType } from "./insights-read-model.js";
import { normalizeHookType } from "./hook-type-normalize.js";
import { pickTopPerformerKnowledgeFromDerivedGlobals } from "./signal-pack-top-performer-knowledge.js";

export const MARKET_INTELLIGENCE_V1_KEY = "market_intelligence_v1";

export type MarketIntelligencePatternCategory =
  | "winning_pattern"
  | "winning_format"
  | "strong_hook"
  | "emotional_pattern"
  | "visual_pattern"
  | "opportunity"
  | "saturated_angle";

export interface MarketIntelligencePatternV1 {
  id: string;
  category: MarketIntelligencePatternCategory;
  title: string;
  summary: string;
  evidence_count: number;
  /** Pattern strength 0–1 (cluster size + scores), not raw pre-LLM rank alone. */
  confidence: number | null;
  source_insight_ids: string[];
  formats: string[];
}

export interface MediaLaneSynthesisV1 {
  lane: "carousel" | "video" | "image";
  label: string;
  overview: string;
  format_groups: Array<{ format_key: string; label: string; takeaways: string[] }>;
}

export interface TopicDeepDiveV1 {
  topic: string;
  items: MarketIntelligencePatternV1[];
}

export interface MarketIntelligenceV1 {
  schema_version: 1;
  generated_at: string;
  executive_summary: string[];
  winning_patterns: MarketIntelligencePatternV1[];
  hooks: MarketIntelligencePatternV1[];
  emotions: MarketIntelligencePatternV1[];
  visual_patterns: MarketIntelligencePatternV1[];
  opportunities: MarketIntelligencePatternV1[];
  avoid: MarketIntelligencePatternV1[];
  media_lanes: MediaLaneSynthesisV1[];
  deep_dive: TopicDeepDiveV1[];
  total_patterns: number;
  rows_analyzed: number;
}

export interface SynthesisInsightRowInput {
  project_slug: string;
  inputs_import_id: string;
  signal_pack_id?: string | null;
  run_id?: string | null;
  evidence_post_format?: string | null;
  id: string;
  insights_id: string;
  analysis_tier: "broad_llm" | "top_performer_deep" | "top_performer_video" | "top_performer_carousel";
  source_evidence_row_id: string;
  evidence_kind: string;
  pre_llm_score: string | null;
  why_it_worked: string | null;
  primary_emotion: string | null;
  secondary_emotion: string | null;
  hook_type: string | null;
  hook_text: string | null;
  hashtags: string | null;
  caption_style: string | null;
  cta_type: string | null;
  custom_label_1: string | null;
  custom_label_2: string | null;
  custom_label_3: string | null;
  aesthetic_analysis_json: unknown;
  risk_flags_json: unknown;
  created_at: string;
}

function nonEmpty(s: unknown): string | null {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t : null;
}

function riskFlags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((x) => String(x).trim()).filter(Boolean);
}

function normalizeKey(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function avg(nums: number[]): number | null {
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function patternStrength(count: number, scores: number[]): number {
  const sizeFactor = Math.min(1, count / 5);
  const scoreAvg = avg(scores) ?? 0.45;
  return Math.round(Math.min(1, sizeFactor * 0.55 + scoreAvg * 0.45) * 100) / 100;
}

function readTypeToCategory(type: InsightReadType): MarketIntelligencePatternCategory {
  switch (type) {
    case "hook_pattern":
      return "strong_hook";
    case "emotional_pattern":
      return "emotional_pattern";
    case "format_pattern":
    case "top_performer":
      return "winning_format";
    case "visual_pattern":
      return "visual_pattern";
    case "strategic_opportunity":
      return "opportunity";
    case "risk_or_warning":
      return "saturated_angle";
    default:
      return "winning_pattern";
  }
}

function clusterKey(item: InsightReadModelItem, raw: SynthesisInsightRowInput): string {
  if (item.type === "risk_or_warning") {
    const flags = riskFlags(raw.risk_flags_json);
    return `risk:${normalizeKey(flags[0] ?? "unknown")}`;
  }
  if (item.type === "hook_pattern") {
    const ht =
      normalizeKey(normalizeHookType(raw.hook_type) ?? "") ||
      normalizeKey(nonEmpty(raw.primary_emotion) ?? "hook");
    return `hook:${ht}:${normalizeKey(raw.primary_emotion ?? "any")}`;
  }
  if (item.type === "emotional_pattern") {
    return `emotion:${normalizeKey(raw.primary_emotion ?? "unknown")}`;
  }
  if (item.type === "top_performer") {
    const fmt = item.formats[0] ?? "any";
    const topic =
      normalizeKey(nonEmpty(raw.custom_label_1) ?? "") ||
      normalizeKey(nonEmpty(raw.hook_text) ?? "") ||
      normalizeKey(truncate(nonEmpty(raw.why_it_worked) ?? "", 60));
    return `tp:${fmt}:${topic || "pattern"}`;
  }
  if (item.type === "visual_pattern") {
    return `visual:${normalizeKey(truncate(item.summary, 60))}`;
  }
  if (item.type === "hashtag_cluster") {
    return `tag:${normalizeKey(nonEmpty(raw.hashtags) ?? item.title)}`;
  }
  return `row:${item.id}`;
}

function pickBestSummary(members: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>): string {
  const candidates = members
    .map((m) => m.item.summary.trim())
    .filter((s) => s.length >= 12)
    .sort((a, b) => b.length - a.length);
  const best = candidates[0] ?? members[0]?.item.summary ?? "";
  const count = new Set(members.flatMap((m) => m.item.supporting_evidence_ids)).size;
  if (count <= 1) return best;
  const suffix = ` Seen across ${count} posts in this research brief.`;
  if (best.toLowerCase().includes("seen across")) return best;
  return truncate(`${best}${suffix}`, 420);
}

function pickBestTitle(members: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>): string {
  const titles = members.map((m) => m.item.title.trim()).filter(Boolean);
  const generic = /^top performer|^hook pattern:|^emotional signal:|^risk or weak|^market row/i;
  const specific = titles.find((t) => !generic.test(t));
  if (specific) return truncate(specific, 100);
  if (members[0]?.item.type === "hook_pattern") {
    const hook = members.map((m) => nonEmpty(m.raw.hook_text)).find(Boolean);
    if (hook) return truncate(`Hook: ${hook}`, 100);
    const ht = members.map((m) => normalizeHookType(m.raw.hook_type)).find(Boolean);
    if (ht) return truncate(`Hook style: ${ht}`, 100);
  }
  return truncate(titles[0] ?? "Pattern", 100);
}

function isNearDuplicate(a: string, b: string): boolean {
  const na = normalizeKey(a);
  const nb = normalizeKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.length > 24 && nb.length > 24 && (na.includes(nb) || nb.includes(na))) return true;
  return false;
}

function dedupePatterns(patterns: MarketIntelligencePatternV1[]): MarketIntelligencePatternV1[] {
  const out: MarketIntelligencePatternV1[] = [];
  for (const p of patterns) {
    if (out.some((x) => isNearDuplicate(x.summary, p.summary) || isNearDuplicate(x.title, p.title))) continue;
    out.push(p);
  }
  return out;
}

function aggregateCluster(
  key: string,
  members: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>
): MarketIntelligencePatternV1 {
  const evidenceIds = [...new Set(members.flatMap((m) => m.item.supporting_evidence_ids))];
  const insightIds = [...new Set(members.map((m) => m.item.insights_id))];
  const scores = members
    .map((m) => m.item.confidence)
    .filter((c): c is number => c != null && Number.isFinite(c));
  const formats = [...new Set(members.flatMap((m) => m.item.formats))].filter(Boolean);
  const type = members[0]!.item.type;

  return {
    id: `pat_${normalizeKey(key).replace(/\s+/g, "_").slice(0, 48)}_${evidenceIds.length}`,
    category: readTypeToCategory(type),
    title: pickBestTitle(members),
    summary: pickBestSummary(members),
    evidence_count: evidenceIds.length,
    confidence: patternStrength(evidenceIds.length, scores),
    source_insight_ids: insightIds,
    formats,
  };
}

function clusterInsights(
  rows: Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>,
  opts?: { minClusterSize?: number; allowSingletonTiers?: Set<string> }
): MarketIntelligencePatternV1[] {
  const minSize = opts?.minClusterSize ?? 2;
  const allowSingleton = opts?.allowSingletonTiers ?? new Set(["top_performer_deep", "top_performer_video", "top_performer_carousel"]);

  const buckets = new Map<string, Array<{ item: InsightReadModelItem; raw: SynthesisInsightRowInput }>>();
  for (const row of rows) {
    const key = clusterKey(row.item, row.raw);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(row);
  }

  const patterns: MarketIntelligencePatternV1[] = [];
  for (const [key, members] of buckets) {
    const count = new Set(members.flatMap((m) => m.item.supporting_evidence_ids)).size;
    const tier = members[0]!.raw.analysis_tier;
    const highScore = members.some((m) => (m.item.confidence ?? 0) >= 0.65);
    if (count < minSize) {
      if (!allowSingleton.has(tier) && !highScore) continue;
      if (members[0]!.item.type === "market_row_analysis") continue;
    }
    patterns.push(aggregateCluster(key, members));
  }

  return dedupePatterns(
    patterns.sort((a, b) => b.evidence_count - a.evidence_count || (b.confidence ?? 0) - (a.confidence ?? 0))
  );
}

function humanFormatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function humanLaneLabel(lane: string): string {
  if (lane === "carousel") return "Carousel";
  if (lane === "video") return "Video";
  if (lane === "image") return "Image";
  return lane;
}

function sanitizeCue(cue: string, max = 200): string | null {
  const t = cue.replace(/\s+/g, " ").trim();
  if (t.length < 8) return null;
  if (/^(create|design|use canva|batch|obtain copyright)/i.test(t)) return null;
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function synthesizeLaneOverview(
  lane: string,
  formatGroups: MediaLaneSynthesisV1["format_groups"],
  postCount: number
): string {
  if (!formatGroups.length) {
    return `Limited ${humanLaneLabel(lane).toLowerCase()} patterns in this brief.`;
  }
  const formatNames = formatGroups.slice(0, 3).map((g) => g.label.toLowerCase());
  const themes = formatGroups
    .flatMap((g) => g.takeaways)
    .slice(0, 3)
    .map((t) => truncate(t, 90));
  const formatPart =
    formatNames.length === 1
      ? `${formatNames[0]} ${humanLaneLabel(lane).toLowerCase()}s`
      : `${humanLaneLabel(lane).toLowerCase()} content (${formatNames.join(", ")})`;
  if (themes.length >= 2) {
    return `Across ${postCount} top ${formatPart}, winners combine ${themes[0]?.toLowerCase()} with ${themes[1]?.toLowerCase()}.`;
  }
  if (themes[0]) {
    return `Top ${formatPart} in this brief lean on ${themes[0].toLowerCase()}.`;
  }
  return `Clear ${formatPart} patterns emerged from your research window.`;
}

function synthesizeMediaLanes(derivedGlobals: Record<string, unknown> | null | undefined): MediaLaneSynthesisV1[] {
  const tpk = pickTopPerformerKnowledgeFromDerivedGlobals(derivedGlobals ?? {});
  if (!tpk) return [];
  const out: MediaLaneSynthesisV1[] = [];

  for (const lane of ["carousel", "video", "image"] as const) {
    const slice = tpk.media_lanes[lane];
    const formatGroups: MediaLaneSynthesisV1["format_groups"] = [];
    const seen = new Set<string>();

    for (const g of slice.content_format_groups ?? []) {
      const formatKey = String(g.content_format_key ?? g.content_format_pattern ?? "unknown");
      const takeaways: string[] = [];
      for (const c of g.cues ?? []) {
        const t = sanitizeCue(String(c));
        if (!t || seen.has(normalizeKey(t))) continue;
        seen.add(normalizeKey(t));
        takeaways.push(t);
        if (takeaways.length >= 4) break;
      }
      if (!takeaways.length) continue;
      formatGroups.push({
        format_key: formatKey,
        label: humanFormatKey(formatKey),
        takeaways,
      });
    }

    const laneCues = (slice.visual_guideline_cues ?? [])
      .map((c) => sanitizeCue(String(c)))
      .filter((x): x is string => !!x)
      .filter((c) => !seen.has(normalizeKey(c)))
      .slice(0, 2);

    if (!formatGroups.length && !laneCues.length) continue;

    const postCount = Math.max(
      1,
      formatGroups.reduce((n, g) => n + g.takeaways.length, 0)
    );
    const overview = synthesizeLaneOverview(lane, formatGroups, postCount);

    out.push({
      lane,
      label: humanLaneLabel(lane),
      overview,
      format_groups: formatGroups.slice(0, 6),
    });
  }

  return out;
}

function topicFromPattern(p: MarketIntelligencePatternV1): string {
  const t = `${p.title} ${p.summary}`.toLowerCase();
  if (/relationship|dating|crush|love/.test(t)) return "Relationships";
  if (/zodiac|astrology|horoscope|sign/.test(t)) return "Astrology & signs";
  if (/education|learn|tip|how to|educational/.test(t)) return "Education";
  if (/trend|viral|rising|meme/.test(t)) return "Trends & memes";
  if (/product|offer|promo|app\b/.test(t)) return "Product & offers";
  return "General themes";
}

function summaryGist(summary: string): string {
  return summary.replace(/\s*Seen across \d+ posts in this research brief\.?/i, "").trim();
}

function executiveLineFromPattern(p: MarketIntelligencePatternV1): string {
  const gist = summaryGist(p.summary);
  if (p.evidence_count >= 2) {
    return truncate(
      `Across ${p.evidence_count} posts, ${p.title.toLowerCase().startsWith("hook") ? "a recurring hook" : "a clear pattern"}: ${gist}`,
      220
    );
  }
  return truncate(gist || p.title, 220);
}

function looksLikeGenuineRisk(summary: string): boolean {
  const lower = summary.toLowerCase();
  if (/^(the video excels|captures attention|strong hook|visually striking|excels in|works well|high engagement)/i.test(lower)) {
    return false;
  }
  if (/\b(oversaturat|weak hook|misleading|brand safety|avoid|saturated|low engagement|poor)\b/i.test(lower)) {
    return true;
  }
  return summary.trim().length >= 12;
}

function prioritizeMultiPostPatterns(
  patterns: MarketIntelligencePatternV1[],
  limit: number
): MarketIntelligencePatternV1[] {
  const multi = patterns.filter((p) => p.evidence_count >= 2);
  const single = patterns.filter((p) => p.evidence_count < 2);
  if (multi.length >= 3) return multi.slice(0, limit);
  return [...multi, ...single].slice(0, limit);
}

function buildExecutiveSummary(patterns: MarketIntelligencePatternV1[], mediaLanes: MediaLaneSynthesisV1[]): string[] {
  const bullets: string[] = [];
  const ranked = [...patterns]
    .filter((p) => p.category !== "saturated_angle")
    .sort((a, b) => b.evidence_count - a.evidence_count || (b.confidence ?? 0) - (a.confidence ?? 0));

  for (const p of ranked) {
    if (bullets.length >= 4) break;
    if (p.evidence_count < 2 && (p.confidence ?? 0) < 0.55) continue;
    const line = executiveLineFromPattern(p);
    if (!line || bullets.some((b) => isNearDuplicate(b, line))) continue;
    bullets.push(line);
  }

  for (const lane of mediaLanes) {
    if (bullets.length >= 5) break;
    if (!lane.overview || bullets.some((b) => isNearDuplicate(b, lane.overview))) continue;
    bullets.push(truncate(`${lane.label} winners tend to ${lane.overview.replace(/^Across \d+ top [^.]+\.\s*/i, "").replace(/^Top [^.]+\.\s*/i, "")}`, 220));
  }

  return bullets.slice(0, 5);
}

function buildDeepDive(patterns: MarketIntelligencePatternV1[]): TopicDeepDiveV1[] {
  const byTopic = new Map<string, MarketIntelligencePatternV1[]>();
  for (const p of patterns) {
    const topic = topicFromPattern(p);
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic)!.push(p);
  }
  const entries = Array.from(byTopic.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([topic, items]) => ({ topic, items: items.slice(0, 5) }))
    .sort((a, b) => b.items.length - a.items.length);

  const specific = entries.filter((e) => e.topic !== "General themes");
  if (specific.length >= 2) return specific.slice(0, 6);
  return entries.slice(0, 6);
}

export function buildMarketIntelligenceV1(input: {
  insightRows: SynthesisInsightRowInput[];
  derivedGlobals?: Record<string, unknown> | null;
}): MarketIntelligenceV1 {
  const paired = input.insightRows.map((raw) => ({
    raw,
    item: buildInsightReadModelItem({
      project_slug: raw.project_slug,
      inputs_import_id: raw.inputs_import_id,
      signal_pack_id: raw.signal_pack_id ?? null,
      run_id: raw.run_id ?? null,
      evidence_post_format: raw.evidence_post_format ?? null,
      id: raw.id,
      insights_id: raw.insights_id,
      analysis_tier: raw.analysis_tier,
      source_evidence_row_id: raw.source_evidence_row_id,
      evidence_kind: raw.evidence_kind,
      pre_llm_score: raw.pre_llm_score,
      why_it_worked: raw.why_it_worked,
      primary_emotion: raw.primary_emotion,
      secondary_emotion: raw.secondary_emotion,
      hook_type: raw.hook_type,
      hook_text: raw.hook_text,
      hashtags: raw.hashtags,
      caption_style: raw.caption_style,
      cta_type: raw.cta_type,
      custom_label_1: raw.custom_label_1,
      custom_label_2: raw.custom_label_2,
      custom_label_3: raw.custom_label_3,
      aesthetic_analysis_json: raw.aesthetic_analysis_json,
      risk_flags_json: raw.risk_flags_json,
      created_at: raw.created_at,
    }),
  }));

  const riskRows = paired.filter((p) => p.item.type === "risk_or_warning");
  const hookRows = paired.filter((p) => p.item.type === "hook_pattern");
  const emotionRows = paired.filter((p) => p.item.type === "emotional_pattern");
  const tpRows = paired.filter((p) => p.item.type === "top_performer");
  const visualRows = paired.filter((p) => p.item.type === "visual_pattern");
  const oppRows = paired.filter((p) => p.item.type === "strategic_opportunity");

  const tpAndFormat = [...tpRows, ...paired.filter((p) => p.item.type === "format_pattern")];
  let winningPatternsRaw = clusterInsights(tpAndFormat, { minClusterSize: 2 });
  if (winningPatternsRaw.length < 3) {
    winningPatternsRaw = clusterInsights(tpAndFormat, { minClusterSize: 1 });
  }
  const winningPatterns = prioritizeMultiPostPatterns(winningPatternsRaw, 12);

  const hooks = prioritizeMultiPostPatterns(clusterInsights(hookRows, { minClusterSize: 2 }), 10);
  const emotions = prioritizeMultiPostPatterns(clusterInsights(emotionRows, { minClusterSize: 2 }), 10);
  const visualPatterns = prioritizeMultiPostPatterns(clusterInsights(visualRows, { minClusterSize: 2 }), 8);
  const opportunities = clusterInsights(oppRows, { minClusterSize: 1 }).slice(0, 6);
  const avoid = clusterInsights(riskRows, { minClusterSize: 1, allowSingletonTiers: new Set() })
    .filter((p) => looksLikeGenuineRisk(p.summary))
    .slice(0, 6);

  const media_lanes = synthesizeMediaLanes(input.derivedGlobals);

  const allPatterns = dedupePatterns([
    ...winningPatterns,
    ...hooks,
    ...emotions,
    ...visualPatterns,
    ...opportunities,
  ]);

  const executive_summary = buildExecutiveSummary(allPatterns, media_lanes);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    executive_summary,
    winning_patterns: winningPatterns,
    hooks,
    emotions,
    visual_patterns: visualPatterns,
    opportunities,
    avoid,
    media_lanes,
    deep_dive: buildDeepDive(allPatterns),
    total_patterns: allPatterns.length,
    rows_analyzed: input.insightRows.length,
  };
}
