import { pickInspectionMediaPreviewUrl } from "./inspection-media";
import {
  resolveFormatGroupExamples,
  type FormatGroupExample,
} from "./format-group-examples";
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
  formatGroups: Array<{
    formatKey: string;
    label: string;
    takeaways: string[];
    examples?: FormatGroupExample[];
  }>;
}

export type { FormatGroupExample };

export interface TopPerformerPreview {
  id: string;
  title: string;
  platform: string;
  format: string;
  thumbnailUrl: string | null;
  postUrl?: string | null;
  why: string;
  applyThis?: string | null;
}

export interface CustomLabelStatView {
  slot: 1 | 2 | 3;
  columnLabel: string;
  value: string;
  count: number;
  sharePct: number;
}

export interface ResearchStatsView {
  formats: Array<{ key: string; count: number; evidenceUrls?: string[]; sourceInsightIds?: string[] }>;
  hookTypes: Array<{ key: string; count: number; evidenceUrls?: string[]; sourceInsightIds?: string[] }>;
  emotions: Array<{ key: string; count: number; evidenceUrls?: string[]; sourceInsightIds?: string[] }>;
  platforms: Array<{ key: string; count: number; evidenceUrls?: string[]; sourceInsightIds?: string[] }>;
  themes: Array<{ key: string; count: number; evidenceUrls?: string[]; sourceInsightIds?: string[] }>;
  distinctCreators: number;
}

function parseStatBuckets(raw: unknown): ResearchStatsView["formats"] {
  return asArray(raw)
    .map((x) => asRecord(x))
    .filter((x): x is Record<string, unknown> => x != null)
    .map((f) => {
      const urls = asArray(f.evidence_urls).map((u) => str(u)).filter((u) => u.startsWith("http"));
      const ids = asArray(f.source_insight_ids).map((id) => str(id)).filter(Boolean);
      return {
        key: str(f.key),
        count: Number(f.count) || 0,
        evidenceUrls: urls.length ? urls : undefined,
        sourceInsightIds: ids.length ? ids : undefined,
      };
    })
    .filter((f) => f.key);
}

export interface HooksDigestView {
  hooks: string[];
  keyTakeaways: string[];
}

export interface LinkedInAttributedQuoteView {
  personName: string;
  roleOrHeadline?: string | null;
  company?: string | null;
  followers?: number | null;
  profileUrl?: string | null;
  postUrl?: string | null;
  quote: string;
  insightsId: string;
}

export interface LinkedInTopicView {
  id: string;
  title: string;
  summary: string;
  evidenceCount: number;
  sourceInsightIds: string[];
  quotes: LinkedInAttributedQuoteView[];
}

export interface LinkedInVoiceView {
  personName: string;
  roleOrHeadline?: string | null;
  company?: string | null;
  followers?: number | null;
  profileUrl?: string | null;
  postCount: number;
  avgPriority: number;
  sourceInsightIds: string[];
  sampleTopics: string[];
}

export interface LinkedInIntelligenceView {
  weeklyTopics: LinkedInTopicView[];
  relevantVoices: LinkedInVoiceView[];
  distinctPeople: number;
  distinctCompanies: number;
  geoSignals: Array<{ key: string; count: number }>;
}

export interface InsightColumnLabelsView {
  customLabel1: string;
  customLabel2: string;
  customLabel3: string;
}

export interface CompetitorBrandView {
  handle: string;
  platform: string;
  postCount: number;
  signatureMoves: string[];
  standoutExample?: string | null;
  /** Parsed from standout_example when it contains a post permalink. */
  examplePostUrl?: string | null;
}

export interface CompetitiveLandscapeView {
  overview: string;
  brands: CompetitorBrandView[];
}

export interface TopicDeepDive {
  topic: string;
  items: MarketInsight[];
}

export interface MarketIntelligenceView {
  summaryBullets: string[];
  /** LLM-generated brief title when available on pack synthesis. */
  researchBriefTitle?: string;
  marketOverview?: string;
  whatWorked?: string;
  actionPlaybook?: string[];
  competitiveLandscape?: CompetitiveLandscapeView;
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
  researchStats?: ResearchStatsView;
  customLabelStats?: CustomLabelStatView[];
  insightColumnLabels?: InsightColumnLabelsView;
  hooksDigest?: HooksDigestView;
  /** LinkedIn person-first intelligence when present on the brief. */
  linkedin?: LinkedInIntelligenceView;
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

function enrichMediaLanesWithExamples(
  pack: Record<string, unknown> | null,
  lanes: MediaLaneTakeaway[]
): MediaLaneTakeaway[] {
  return lanes.map((lane) => ({
    ...lane,
    formatGroups: lane.formatGroups.map((g) => ({
      ...g,
      examples:
        g.examples?.length
          ? g.examples
          : resolveFormatGroupExamples(pack, lane.lane, g.formatKey, undefined, 3),
    })),
  }));
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
      const exampleIds = asArray(g.example_insights_ids).map((id) => str(id)).filter(Boolean);
      formatGroups.push({
        formatKey,
        label: humanFormatKey(formatKey),
        takeaways,
        examples: resolveFormatGroupExamples(pack, lane, formatKey, exampleIds, 3),
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
      const exampleIds = asArray(g.example_insights_ids).map((id) => str(id)).filter(Boolean);
      carouselGroups.push({
        formatKey,
        label: humanFormatKey(formatKey),
        takeaways,
        examples: resolveFormatGroupExamples(
          pack,
          "carousel",
          formatKey,
          exampleIds.length ? exampleIds : undefined,
          3
        ),
      });
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

  return enrichMediaLanesWithExamples(pack, out);
}

function thumbnailByInsightsId(pack: Record<string, unknown> | null): Map<string, string | null> {
  const map = new Map<string, string | null>();
  const derived = asRecord(pack?.derived_globals_json);
  const vg = asRecord(derived?.visual_guidelines_pack_v1);
  for (const raw of asArray(vg?.entries)) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const insightsId = str(entry.insights_id);
    if (!insightsId || map.has(insightsId)) continue;
    const im = asRecord(entry.inspection_media);
    map.set(
      insightsId,
      pickInspectionMediaPreviewUrl(
        im
          ? {
              items: asArray(im.items)
                .map((it) => {
                  const o = asRecord(it);
                  return o
                    ? {
                        role: str(o.role),
                        public_url: str(o.public_url) || null,
                        vision_fetch_url: str(o.vision_fetch_url) || null,
                      }
                    : null;
                })
                .filter((x): x is NonNullable<typeof x> => x != null),
            }
          : null
      )
    );
  }
  return map;
}

function parseTopPerformerPreviewsFromV1(
  pack: Record<string, unknown> | null,
  v1Raw: Record<string, unknown>,
  limit = 6
): TopPerformerPreview[] {
  const highlights = asArray(v1Raw.top_performer_highlights)
    .map((x) => asRecord(x))
    .filter((x): x is Record<string, unknown> => x != null);
  if (!highlights.length) return parseTopPerformerPreviews(pack, limit);

  const thumbs = thumbnailByInsightsId(pack);
  const postUrls = postUrlByInsightsId(pack);
  return highlights.slice(0, limit).map((h) => {
    const insightsId = str(h.insights_id);
    const formatRaw = str(h.format);
    return {
      id: insightsId || str(h.id) || `tp_${Math.random().toString(36).slice(2, 8)}`,
      title: sanitizeMarketerText(str(h.title) || "Top performer", 80),
      platform: str(h.platform) || "Instagram",
      format: humanFormatKey((formatRaw.split("|")[0] ?? formatRaw) || "Reference"),
      thumbnailUrl: insightsId ? thumbs.get(insightsId) ?? null : null,
      postUrl: insightsId ? postUrls.get(insightsId) ?? null : null,
      why: sanitizeMarketerText(str(h.summary) || "High-performing reference from your research window.", 360),
      applyThis: sanitizeMarketerText(str(h.apply_this), 160) || null,
    };
  });
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
      postUrl: str(entry.evidence_post_url) || str(entry.post_url) || null,
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
  const evidenceUrls = asArray(p.evidence_urls)
    .map((u) => str(u))
    .filter((u) => u.startsWith("http"));
  const sourceInsightIds = asArray(p.source_insight_ids).map((id) => str(id)).filter(Boolean);
  return {
    id: str(p.id) || `pat_${Math.random().toString(36).slice(2, 8)}`,
    category: category || "winning_pattern",
    title: sanitizeMarketerText(str(p.title) || "Pattern", 120),
    summary: sanitizeMarketerText(str(p.summary), 360),
    evidenceCount: typeof p.evidence_count === "number" ? p.evidence_count : 1,
    confidence: typeof p.confidence === "number" ? p.confidence : null,
    evidenceUrls: evidenceUrls.length ? evidenceUrls : undefined,
    sourceInsightIds: sourceInsightIds.length ? sourceInsightIds : undefined,
    actionable: sanitizeMarketerText(str(p.actionable), 180) || null,
  };
}

function postUrlByInsightsId(pack: Record<string, unknown> | null): Map<string, string> {
  const map = new Map<string, string>();
  const derived = asRecord(pack?.derived_globals_json);
  const vg = asRecord(derived?.visual_guidelines_pack_v1);
  for (const raw of asArray(vg?.entries)) {
    const entry = asRecord(raw);
    if (!entry) continue;
    const insightsId = str(entry.insights_id);
    const url = str(entry.evidence_post_url) || str(entry.post_url);
    if (insightsId && url.startsWith("http")) map.set(insightsId, url);
  }
  return map;
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

  const mediaLanes: MediaLaneTakeaway[] = enrichMediaLanesWithExamples(
    pack,
    asArray(v1Raw.media_lanes)
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
      .filter((l) => l.summary || l.formatGroups.length > 0)
  );

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

  const statsRaw = asRecord(v1Raw.research_stats);
  const researchStats: ResearchStatsView | undefined = statsRaw
    ? {
        formats: parseStatBuckets(statsRaw.formats),
        hookTypes: parseStatBuckets(statsRaw.hook_types),
        emotions: parseStatBuckets(statsRaw.emotions),
        platforms: parseStatBuckets(statsRaw.platforms),
        themes: parseStatBuckets(statsRaw.themes),
        distinctCreators: Number(statsRaw.distinct_creators) || 0,
      }
    : undefined;

  const customLabelStats: CustomLabelStatView[] = asArray(v1Raw.custom_label_stats)
    .map((x) => asRecord(x))
    .filter((x): x is Record<string, unknown> => x != null)
    .map((s) => ({
      slot: (Number(s.slot) === 2 ? 2 : Number(s.slot) === 3 ? 3 : 1) as 1 | 2 | 3,
      columnLabel: str(s.column_label),
      value: str(s.value),
      count: Number(s.count) || 0,
      sharePct: Number(s.share_pct) || 0,
    }))
    .filter((s) => s.columnLabel && s.value);

  const labelsRaw = asRecord(v1Raw.insight_column_labels);
  const insightColumnLabels: InsightColumnLabelsView | undefined = labelsRaw
    ? {
        customLabel1: str(labelsRaw.custom_label_1),
        customLabel2: str(labelsRaw.custom_label_2),
        customLabel3: str(labelsRaw.custom_label_3),
      }
    : undefined;

  const hooksDigestRaw = asRecord(v1Raw.hooks_digest);
  const hooksDigest: HooksDigestView | undefined = hooksDigestRaw
    ? {
        hooks: asArray(hooksDigestRaw.hooks).map((h) => str(h)).filter(Boolean),
        keyTakeaways: asArray(hooksDigestRaw.key_takeaways).map((t) => sanitizeMarketerText(str(t), 220)).filter(Boolean),
      }
    : undefined;

  const themeTopics: MarketInsight[] = (researchStats?.themes ?? []).slice(0, 8).map((t, i) => ({
    id: `theme_${i}_${t.key.slice(0, 20)}`,
    category: "winning_pattern" as const,
    title: t.key,
    summary: `Appears in ${t.count} posts (${Math.round((t.count / ((v1Raw.rows_analyzed as number) || t.count)) * 100)}% of brief).`,
    evidenceCount: t.count,
    confidence: null,
    evidenceUrls: t.evidenceUrls,
    sourceInsightIds: t.sourceInsightIds,
    evidenceFilter: t.sourceInsightIds?.length ? undefined : { kind: "theme" as const, key: t.key },
  }));

  const competitiveRaw = asRecord(v1Raw.competitive_landscape);
  const competitiveLandscape: CompetitiveLandscapeView | undefined = competitiveRaw
    ? {
        overview: sanitizeMarketerText(str(competitiveRaw.overview), 900),
        brands: asArray(competitiveRaw.brands)
          .map((x) => asRecord(x))
          .filter((x): x is Record<string, unknown> => x != null)
          .map((b) => {
            const standoutRaw = str(b.standout_example);
            const examplePostUrl =
              (standoutRaw.match(/https?:\/\/[^\s<>"')]+/i) ?? [])[0]?.replace(/[.,);]+$/, "") ?? null;
            return {
            handle: sanitizeMarketerText(str(b.handle_or_name), 80),
            platform: str(b.platform) || "Social",
            postCount: typeof b.post_count === "number" ? b.post_count : 1,
            signatureMoves: asArray(b.signature_moves)
              .map((m) => sanitizeMarketerText(str(m), 200))
              .filter(Boolean),
            standoutExample: sanitizeMarketerText(standoutRaw, 280) || null,
            examplePostUrl: examplePostUrl?.startsWith("http") ? examplePostUrl : null,
          };
          })
          .filter((b) => b.handle && b.signatureMoves.length > 0),
      }
    : undefined;

  const linkedinRaw = asRecord(v1Raw.linkedin);
  const linkedin: LinkedInIntelligenceView | undefined = linkedinRaw
    ? {
        weeklyTopics: asArray(linkedinRaw.weekly_topics)
          .map((x) => asRecord(x))
          .filter((x): x is Record<string, unknown> => x != null)
          .map((t) => ({
            id: str(t.id) || `topic_${str(t.title).slice(0, 24)}`,
            title: sanitizeMarketerText(str(t.title), 100),
            summary: sanitizeMarketerText(str(t.summary), 320),
            evidenceCount: Number(t.evidence_count) || 0,
            sourceInsightIds: asArray(t.source_insight_ids).map((id) => str(id)).filter(Boolean),
            quotes: asArray(t.quotes)
              .map((q) => asRecord(q))
              .filter((q): q is Record<string, unknown> => q != null)
              .map((q) => ({
                personName: sanitizeMarketerText(str(q.person_name), 80),
                roleOrHeadline: sanitizeMarketerText(str(q.role_or_headline), 120) || null,
                company: sanitizeMarketerText(str(q.company), 80) || null,
                followers: typeof q.followers === "number" ? q.followers : null,
                profileUrl: str(q.profile_url) || null,
                postUrl: str(q.post_url) || null,
                quote: sanitizeMarketerText(str(q.quote), 280),
                insightsId: str(q.insights_id),
              }))
              .filter((q) => q.personName && q.quote),
          }))
          .filter((t) => t.title),
        relevantVoices: asArray(linkedinRaw.relevant_voices)
          .map((x) => asRecord(x))
          .filter((x): x is Record<string, unknown> => x != null)
          .map((v) => ({
            personName: sanitizeMarketerText(str(v.person_name), 80),
            roleOrHeadline: sanitizeMarketerText(str(v.role_or_headline), 120) || null,
            company: sanitizeMarketerText(str(v.company), 80) || null,
            followers: typeof v.followers === "number" ? v.followers : null,
            profileUrl: str(v.profile_url) || null,
            postCount: Number(v.post_count) || 0,
            avgPriority: Number(v.avg_priority) || 0,
            sourceInsightIds: asArray(v.source_insight_ids).map((id) => str(id)).filter(Boolean),
            sampleTopics: asArray(v.sample_topics).map((t) => sanitizeMarketerText(str(t), 80)).filter(Boolean),
          }))
          .filter((v) => v.personName),
        distinctPeople: Number(linkedinRaw.distinct_people) || 0,
        distinctCompanies: Number(linkedinRaw.distinct_companies) || 0,
        geoSignals: asArray(linkedinRaw.geo_signals)
          .map((x) => asRecord(x))
          .filter((x): x is Record<string, unknown> => x != null)
          .map((g) => ({ key: str(g.key), count: Number(g.count) || 0 }))
          .filter((g) => g.key),
      }
    : undefined;

  return {
    summaryBullets: summaryBullets.slice(0, 6),
    researchBriefTitle: str(v1Raw.research_brief_title) || undefined,
    marketOverview: sanitizeMarketerText(str(v1Raw.market_overview), 900) || undefined,
    whatWorked: sanitizeMarketerText(str(v1Raw.what_worked), 900) || undefined,
    actionPlaybook: asArray(v1Raw.action_playbook)
      .map((x) => sanitizeMarketerText(str(x), 220))
      .filter(Boolean)
      .slice(0, 6),
    competitiveLandscape:
      competitiveLandscape?.overview && competitiveLandscape.brands.length
        ? competitiveLandscape
        : undefined,
    mediaLanes,
    winningPatterns,
    hooks,
    emotions,
    topics: themeTopics.length ? themeTopics : emotions.slice(0, 6),
    visualPatterns,
    opportunities,
    avoid,
    hashtags,
    topPerformers: parseTopPerformerPreviewsFromV1(pack, v1Raw, 6),
    deepDive,
    researchStats,
    customLabelStats: customLabelStats.length ? customLabelStats : undefined,
    insightColumnLabels,
    hooksDigest,
    linkedin:
      linkedin && (linkedin.weeklyTopics.length > 0 || linkedin.relevantVoices.length > 0)
        ? linkedin
        : undefined,
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
