import { pickInspectionMediaPreviewUrl } from "./inspection-media";
import { parseHashtagsFromPack, parseTopPerformersFromPack } from "./idea-adapters";
import type { HashtagInsight, MarketInsight, MarketInsightCategory } from "./types";

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v != null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export type InsightReadType =
  | "top_performer"
  | "hook_pattern"
  | "emotional_pattern"
  | "visual_pattern"
  | "pacing_pattern"
  | "format_pattern"
  | "audience_signal"
  | "hashtag_cluster"
  | "strategic_opportunity"
  | "risk_or_warning"
  | "market_row_analysis";

export interface InsightReadItem {
  id: string;
  insights_id: string;
  type: InsightReadType;
  title: string;
  summary: string;
  confidence: number | null;
  platforms: string[];
  formats: string[];
  creative_implication: string | null;
}

export interface MediaLaneTakeaway {
  lane: "carousel" | "video" | "image";
  label: string;
  summary: string;
  formatGroups: Array<{ formatKey: string; label: string; takeaways: string[] }>;
}

export interface TopPerformerPreview {
  id: string;
  title: string;
  platform: string;
  format: string;
  thumbnailUrl: string | null;
  why: string;
}

export interface TopicDeepDive {
  topic: string;
  items: MarketInsight[];
}

export interface MarketIntelligenceView {
  summaryBullets: string[];
  mediaLanes: MediaLaneTakeaway[];
  winningPatterns: MarketInsight[];
  hooks: MarketInsight[];
  emotions: MarketInsight[];
  topics: MarketInsight[];
  visualPatterns: MarketInsight[];
  opportunities: MarketInsight[];
  avoid: MarketInsight[];
  hashtags: HashtagInsight[];
  topPerformers: TopPerformerPreview[];
  deepDive: TopicDeepDive[];
  /** Aggregated pattern count (synthesized view). */
  totalPatterns: number;
  /** @deprecated Raw row count — prefer totalPatterns when synthesized. */
  totalInsights: number;
  rowsAnalyzed?: number;
}

const ENGINEERING_RE =
  /engineering brief|task_id|src\/services\/|\.hbs\b|remediation|planner input|caf-global|^\s*#{1,3}\s/mi;

const TOOL_RE = /\b(canva|photoshop|figma|premiere|after effects)\b/i;

function sanitizeMarketerText(text: string, max = 280): string {
  let t = text
    .replace(/^#+\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`[^`]+`/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (TOOL_RE.test(t)) {
    t = t.replace(TOOL_RE, "").replace(/\s+/g, " ").trim();
  }
  if (t.length > max) t = `${t.slice(0, max - 1)}…`;
  return t;
}

function isOperatorLeak(text: string): boolean {
  return ENGINEERING_RE.test(text);
}

function readTypeToCategory(type: InsightReadType): MarketInsightCategory {
  switch (type) {
    case "hook_pattern":
      return "strong_hook";
    case "emotional_pattern":
      return "winning_pattern";
    case "format_pattern":
    case "top_performer":
      return "winning_format";
    case "visual_pattern":
      return "visual_pattern";
    case "hashtag_cluster":
      return "winning_pattern";
    case "strategic_opportunity":
      return "opportunity";
    case "risk_or_warning":
      return "saturated_angle";
    case "pacing_pattern":
      return "emerging_trend";
    default:
      return "winning_pattern";
  }
}

export function toInsightReadItem(row: Record<string, unknown>): InsightReadItem | null {
  const type = str(row.type) as InsightReadType;
  if (!type) return null;
  const title = sanitizeMarketerText(str(row.title) || "Insight", 120);
  const summary = sanitizeMarketerText(
    [str(row.summary), str(row.creative_implication)].filter(Boolean).join(" — "),
    320
  );
  if (!summary || isOperatorLeak(`${title} ${summary}`)) return null;
  if (/^(create|design|use|obtain|film|batch process)\b/i.test(summary) && summary.length > 80) {
    return null;
  }
  return {
    id: str(row.id) || str(row.insights_id) || `ins_${Math.random().toString(36).slice(2, 8)}`,
    insights_id: str(row.insights_id),
    type,
    title,
    summary,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    platforms: asArray(row.platforms).map((x) => str(x)).filter(Boolean),
    formats: asArray(row.formats).map((x) => str(x)).filter(Boolean),
    creative_implication: str(row.creative_implication) || null,
  };
}

function toMarketInsight(item: InsightReadItem): MarketInsight {
  return {
    id: item.id,
    category: readTypeToCategory(item.type),
    title: item.title,
    summary: item.summary,
    evidenceCount: item.platforms.length || 1,
    confidence: item.confidence,
  };
}

function humanLaneLabel(lane: string): string {
  if (lane === "carousel") return "Carousel";
  if (lane === "video") return "Video";
  if (lane === "image") return "Image";
  return lane;
}

function humanFormatKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function cueToTakeaway(cue: string): string | null {
  const t = sanitizeMarketerText(cue, 200);
  if (!t || isOperatorLeak(t)) return null;
  if (/^(create|design|use canva|batch|obtain copyright)/i.test(t)) return null;
  return t;
}

export function parseMediaLaneTakeaways(pack: Record<string, unknown> | null): MediaLaneTakeaway[] {
  const derived = asRecord(pack?.derived_globals_json);
  const tpk = asRecord(derived?.top_performer_knowledge_v1);
  const lanes = asRecord(tpk?.media_lanes);
  const out: MediaLaneTakeaway[] = [];

  for (const lane of ["carousel", "video", "image"] as const) {
    const slice = asRecord(lanes?.[lane]);
    if (!slice) continue;
    const formatGroups: MediaLaneTakeaway["formatGroups"] = [];
    for (const raw of asArray(slice.content_format_groups)) {
      const g = asRecord(raw);
      if (!g) continue;
      const takeaways = asArray(g.cues)
        .map((c) => cueToTakeaway(str(c)))
        .filter((x): x is string => !!x)
        .slice(0, 4);
      if (!takeaways.length) continue;
      const formatKey = str(g.content_format_key) || str(g.content_format_pattern) || "unknown";
      formatGroups.push({
        formatKey,
        label: humanFormatKey(formatKey),
        takeaways,
      });
    }
    const laneCues = asArray(slice.visual_guideline_cues)
      .map((c) => cueToTakeaway(str(c)))
      .filter((x): x is string => !!x)
      .slice(0, 3);

    if (!formatGroups.length && !laneCues.length) continue;

    const summary =
      laneCues[0] ||
      (formatGroups[0]?.takeaways[0] ?? `What works in ${humanLaneLabel(lane).toLowerCase()} content from your research.`);

    out.push({
      lane,
      label: humanLaneLabel(lane),
      summary,
      formatGroups,
    });
  }

  if (!out.length) {
    const vg = asRecord(derived?.visual_guidelines_pack_v1);
    const byFormat = asArray(vg?.visual_guideline_cues_by_format);
    const carouselGroups: MediaLaneTakeaway["formatGroups"] = [];
    for (const raw of byFormat) {
      const g = asRecord(raw);
      if (!g) continue;
      const takeaways = asArray(g.cues)
        .map((c) => cueToTakeaway(str(c)))
        .filter((x): x is string => !!x)
        .slice(0, 3);
      if (!takeaways.length) continue;
      const formatKey = str(g.format_key) || str(g.format_pattern) || "unknown";
      carouselGroups.push({ formatKey, label: humanFormatKey(formatKey), takeaways });
    }
    if (carouselGroups.length) {
      out.push({
        lane: "carousel",
        label: "Carousel",
        summary: carouselGroups[0]?.takeaways[0] ?? "Patterns from top carousel posts in your research.",
        formatGroups: carouselGroups.slice(0, 6),
      });
    }
  }

  return out;
}

export function parseTopPerformerPreviews(
  pack: Record<string, unknown> | null,
  limit = 6
): TopPerformerPreview[] {
  if (!pack) return [];
  const derived = asRecord(pack.derived_globals_json);
  const vg = asRecord(derived?.visual_guidelines_pack_v1);
  const entries = asArray(vg?.entries);
  const out: TopPerformerPreview[] = [];

  for (const raw of entries) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const tier = str(entry.analysis_tier);
    if (!tier.startsWith("top_performer")) continue;
    const insightsId = str(entry.insights_id);
    if (!insightsId) continue;

    const im = asRecord(entry.inspection_media);
    const thumbnailUrl = pickInspectionMediaPreviewUrl(
      im
        ? {
            items: asArray(im.items).map((it) => {
              const o = asRecord(it);
              return o
                ? {
                    role: str(o.role),
                    public_url: str(o.public_url) || null,
                    vision_fetch_url: str(o.vision_fetch_url) || null,
                  }
                : null;
            }).filter((x): x is NonNullable<typeof x> => x != null),
          }
        : null
    );

    const formatPattern = str(entry.format_pattern) || tier.replace(/_/g, " ");
    const why = sanitizeMarketerText(
      str(entry.why_it_worked) ||
        str(entry.deck_as_whole_summary) ||
        str(entry.strategic_summary) ||
        "High-performing reference from your research window.",
      200
    );

    out.push({
      id: insightsId,
      title:
        sanitizeMarketerText(str(entry.title) || str(entry.hook_snippet), 80) ||
        `Top ${humanFormatKey(formatPattern.split("|")[0] ?? formatPattern)}`,
      platform: str(entry.platform) || str(entry.evidence_platform) || "Instagram",
      format: humanFormatKey(formatPattern.split("|")[0] ?? formatPattern),
      thumbnailUrl,
      why,
    });
    if (out.length >= limit) break;
  }

  if (!out.length) {
    for (const tp of parseTopPerformersFromPack(pack).slice(0, limit)) {
      out.push({
        id: tp.id,
        title: tp.title,
        platform: tp.platform,
        format: tp.format,
        thumbnailUrl: null,
        why: tp.detail,
      });
    }
  }

  return out;
}

function topicFromTitle(title: string): string {
  const t = title.toLowerCase();
  if (/relationship|dating|crush|love/.test(t)) return "Relationships";
  if (/zodiac|astrology|horoscope|sign/.test(t)) return "Astrology & signs";
  if (/education|learn|tip|how to/.test(t)) return "Education";
  if (/trend|viral|rising/.test(t)) return "Trends";
  if (/product|offer|promo/.test(t)) return "Product & offers";
  return "General themes";
}

function patternV1ToMarketInsight(p: Record<string, unknown>): MarketInsight {
  const category = str(p.category) as MarketInsightCategory;
  return {
    id: str(p.id) || `pat_${Math.random().toString(36).slice(2, 8)}`,
    category: category || "winning_pattern",
    title: sanitizeMarketerText(str(p.title) || "Pattern", 120),
    summary: sanitizeMarketerText(str(p.summary), 360),
    evidenceCount: typeof p.evidence_count === "number" ? p.evidence_count : 1,
    confidence: typeof p.confidence === "number" ? p.confidence : null,
  };
}

export function buildMarketIntelligenceViewFromV1(
  pack: Record<string, unknown> | null,
  v1Raw: Record<string, unknown>
): MarketIntelligenceView {
  const mapList = (key: string) =>
    asArray(v1Raw[key])
      .map((x) => asRecord(x))
      .filter((x): x is Record<string, unknown> => x != null)
      .map(patternV1ToMarketInsight)
      .filter((p) => p.summary && !isOperatorLeak(`${p.title} ${p.summary}`));

  const mediaLanes: MediaLaneTakeaway[] = asArray(v1Raw.media_lanes)
    .map((raw) => asRecord(raw))
    .filter((x): x is Record<string, unknown> => x != null)
    .map((lane) => ({
      lane: (str(lane.lane) || "carousel") as MediaLaneTakeaway["lane"],
      label: str(lane.label) || humanLaneLabel(str(lane.lane)),
      summary: sanitizeMarketerText(str(lane.overview), 320),
      formatGroups: asArray(lane.format_groups)
        .map((g) => asRecord(g))
        .filter((x): x is Record<string, unknown> => x != null)
        .map((g) => ({
          formatKey: str(g.format_key) || "unknown",
          label: str(g.label) || humanFormatKey(str(g.format_key)),
          takeaways: asArray(g.takeaways).map((c) => sanitizeMarketerText(str(c), 200)).filter(Boolean),
        }))
        .filter((g) => g.takeaways.length > 0),
    }))
    .filter((l) => l.summary || l.formatGroups.length > 0);

  const deepDive: TopicDeepDive[] = asArray(v1Raw.deep_dive)
    .map((raw) => asRecord(raw))
    .filter((x): x is Record<string, unknown> => x != null)
    .map((d) => ({
      topic: str(d.topic) || "Themes",
      items: asArray(d.items)
        .map((x) => asRecord(x))
        .filter((x): x is Record<string, unknown> => x != null)
        .map(patternV1ToMarketInsight),
    }))
    .filter((d) => d.items.length > 0);

  const summaryBullets = asArray(v1Raw.executive_summary)
    .map((x) => sanitizeMarketerText(str(x), 240))
    .filter(Boolean);

  const hashtags = parseHashtagsFromPack(pack, 25);
  if (hashtags[0] && summaryBullets.length < 5) {
    const share =
      hashtags[0].sharePct != null ? `${hashtags[0].sharePct}% of tagged posts` : `${hashtags[0].count} uses`;
    summaryBullets.push(`${hashtags[0].hashtag} leads your research (${share}).`);
  }

  const winningPatterns = mapList("winning_patterns");
  const hooks = mapList("hooks");
  const emotions = mapList("emotions");
  const visualPatterns = mapList("visual_patterns");
  const opportunities = mapList("opportunities");
  const avoid = mapList("avoid");

  return {
    summaryBullets: summaryBullets.slice(0, 5),
    mediaLanes,
    winningPatterns,
    hooks,
    emotions,
    topics: emotions.slice(0, 6),
    visualPatterns,
    opportunities,
    avoid,
    hashtags,
    topPerformers: parseTopPerformerPreviews(pack, 6),
    deepDive,
    totalPatterns:
      typeof v1Raw.total_patterns === "number"
        ? v1Raw.total_patterns
        : winningPatterns.length + hooks.length + emotions.length,
    totalInsights:
      typeof v1Raw.rows_analyzed === "number" ? v1Raw.rows_analyzed : winningPatterns.length + hooks.length,
    rowsAnalyzed: typeof v1Raw.rows_analyzed === "number" ? v1Raw.rows_analyzed : undefined,
  };
}

export function buildMarketIntelligenceView(
  pack: Record<string, unknown> | null,
  insightRows: Record<string, unknown>[],
  synthesized?: Record<string, unknown> | null
): MarketIntelligenceView {
  const v1 =
    synthesized ??
    asRecord(asRecord(pack?.derived_globals_json)?.market_intelligence_v1);
  if (v1 && v1.schema_version === 1) {
    return buildMarketIntelligenceViewFromV1(pack, v1);
  }

  const items = insightRows
    .map(toInsightReadItem)
    .filter((x): x is InsightReadItem => x != null);

  const allInsights = items.map(toMarketInsight);

  const winningPatterns = allInsights.filter(
    (i) => i.category === "winning_format" || i.category === "winning_pattern"
  );
  const hooks = allInsights.filter((i) => i.category === "strong_hook");
  const emotions = items.filter((i) => i.type === "emotional_pattern").map(toMarketInsight);
  const topics = items.filter((i) => i.type === "hashtag_cluster").map(toMarketInsight);
  const visualPatterns = allInsights.filter((i) => i.category === "visual_pattern");
  const opportunities = allInsights.filter((i) => i.category === "opportunity");
  const avoid = allInsights.filter((i) => i.category === "saturated_angle");

  const hashtags = parseHashtagsFromPack(pack, 25);
  const mediaLanes = parseMediaLaneTakeaways(pack);
  const topPerformers = parseTopPerformerPreviews(pack, 6);

  const summaryBullets: string[] = [];
  const ranked = [...allInsights].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
  for (const ins of ranked.slice(0, 5)) {
    if (summaryBullets.length >= 5) break;
    const line = `${ins.title}: ${ins.summary}`.slice(0, 160);
    if (!isOperatorLeak(line)) summaryBullets.push(line);
  }
  if (!summaryBullets.length && mediaLanes[0]) {
    summaryBullets.push(
      `${mediaLanes[0].label} content shows clear patterns — see format breakdown below.`
    );
  }
  if (hashtags[0] && summaryBullets.length < 5) {
    summaryBullets.push(
      `${hashtags[0].hashtag} appears most often (${hashtags[0].count}×) in your research window.`
    );
  }

  const byTopic = new Map<string, MarketInsight[]>();
  for (const ins of allInsights) {
    const topic = topicFromTitle(ins.title);
    if (!byTopic.has(topic)) byTopic.set(topic, []);
    byTopic.get(topic)!.push(ins);
  }
  const deepDive: TopicDeepDive[] = Array.from(byTopic.entries())
    .filter(([, list]) => list.length >= 2)
    .map(([topic, list]) => ({ topic, items: list.slice(0, 5) }))
    .sort((a, b) => b.items.length - a.items.length)
    .slice(0, 6);

  return {
    summaryBullets,
    mediaLanes,
    winningPatterns: winningPatterns.slice(0, 12),
    hooks: hooks.slice(0, 10),
    emotions: emotions.slice(0, 10),
    topics: topics.slice(0, 10),
    visualPatterns: visualPatterns.slice(0, 8),
    opportunities: opportunities.slice(0, 6),
    avoid: avoid.slice(0, 6),
    hashtags,
    topPerformers,
    deepDive,
    totalPatterns: allInsights.length,
    totalInsights: allInsights.length,
  };
}
